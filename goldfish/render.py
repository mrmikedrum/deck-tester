"""Terse text for agents: one line per decision, a few lines of state. Detail only when asked for."""

from collections import OrderedDict
from typing import List

from .records import names


def _options(options: List[str]) -> str:
    """Numbered options, with runs of the same label collapsed: '3-5 Forest'."""
    parts = []
    i = 0
    while i < len(options):
        j = i
        while j + 1 < len(options) and options[j + 1] == options[i]:
            j += 1
        number = str(i + 1) if i == j else f"{i + 1}-{j + 1}"
        parts.append(f"{number} {options[i]}")
        i = j + 1
    return " · ".join(parts)


def decision(d: dict) -> str:
    head = f"{d['turn']} {d['kind']}"
    if d.get("prompt"):
        head += f" ({d['prompt']})"
    if not d["options"]:
        return f"{head}: number {d['min']}-{d['max']}"
    if not (d["min"] == d["max"] == 1):
        head += f" [pick {d['min']}" if d["min"] == d["max"] else f" [pick {d['min']}-{d['max']}"
        head += ", repeats allowed]" if d.get("repeat") else "]"
    return f"{head}: {_options(d['options'])}"


def details(d: dict) -> List[str]:
    """Each option's full text, for when the short label isn't enough to decide."""
    full = d.get("details") or d["options"]
    return [f"{i}. {text}" for i, text in enumerate(full, 1)]


def progress(reply: dict) -> str:
    if reply.get("decision"):
        return decision(reply["decision"])
    if reply.get("over"):
        return f"over: {reply['over']}"
    return "still running; check again with: goldfish decision"


def _permanent(p: dict) -> str:
    text = p["name"]
    if p.get("pt"):
        text += f" {p['pt']}"
    if p.get("counters"):
        text += " [" + ", ".join(f"{k} {v}" for k, v in p["counters"].items()) + "]"
    flags = [flag for flag in ("tapped", "sick", "token") if p.get(flag)]
    if flags:
        text += f" ({', '.join(flags)})"
    return text


def state(s: dict, full: bool = False) -> List[str]:
    board: "OrderedDict[str, int]" = OrderedDict()
    for permanent in s["battlefield"]:
        label = _permanent(permanent)
        board[label] = board.get(label, 0) + 1
    lines = [
        f"{s['turn']} · life {s['life']} · mana {s['mana']} · library {s['library']}",
        f"hand: {names(s['hand']) or '-'}",
        "board: " + (", ".join(k if n == 1 else f"{k} x{n}" for k, n in board.items()) or "-"),
    ]
    if s["command"]:
        lines.append(f"command: {names(s['command'])}")
    if full:
        lines.append(f"graveyard: {names(s['graveyard']) or '-'}")
        lines.append(f"exile: {names(s['exile']) or '-'}")
        if s["stack"]:
            lines.append("stack: " + " | ".join(s["stack"]))
        lines.append("opponents: " + ", ".join(
            f"{o['name']} life {o['life']} lands {o['lands']}" + (f" other {o['other']}" if o["other"] else "")
            for o in s["opponents"]))
    else:
        if s["graveyard"]:
            lines.append(f"graveyard {len(s['graveyard'])}" + (f" · exile {len(s['exile'])}" if s["exile"] else ""))
        if s["stack"]:
            lines.append("stack: " + " | ".join(s["stack"]))
    return lines
