"""Read a game record (JSON lines of facts from the engine) and boil it down for an agent."""

import json
from collections import OrderedDict
from typing import Dict, Iterable, List, Tuple

# Looks that count as seeing a card. A library search shows many cards without drawing them, so it doesn't.
SEEING = ("scry", "surveil", "revealed")


def load(path) -> List[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def timeline(facts: Iterable[dict]) -> List[dict]:
    """The facts of the line actually played: anything between a snapshot and a restore to it is dropped."""
    kept: List[dict] = []
    marks: Dict[str, int] = {}
    for fact in facts:
        if fact["t"] == "snapshot":
            marks[fact["name"]] = len(kept) + 1
        elif fact["t"] == "restore" and fact["name"] in marks:
            del kept[marks[fact["name"]]:]
        kept.append(fact)
    return kept


def names(cards: List[str]) -> str:
    counts: "OrderedDict[str, int]" = OrderedDict()
    for card in cards:
        counts[card] = counts.get(card, 0) + 1
    return ", ".join(name if n == 1 else f"{name} x{n}" for name, n in counts.items())


def happened(facts: Iterable[dict]) -> str:
    """One line of what changed, in order, grouping runs of the same kind of fact."""
    parts: List[str] = []
    group: Tuple[str, List[str]] = ("", [])

    def flush():
        label, cards = group
        if cards:
            parts.append(f"{label} {names(cards)}")

    for fact in facts:
        kind = fact["t"]
        if kind in ("draw", "land", "cast", "activate", "move"):
            if kind == "move":
                label = ("+" if fact.get("token") and fact.get("from") is None else
                         f"{fact.get('from') or 'new'}→{fact.get('to')}")
            else:
                label = {"draw": "drew", "land": "land", "cast": "cast", "activate": "used"}[kind]
                if fact.get("failed"):
                    label = "couldn't " + {"cast": "cast", "activate": "use"}[kind]
            card = fact["card"] + (f" X={fact['x']}" if fact.get("x") is not None else "")
            if group[0] != label:
                flush()
                group = (label, [])
            group[1].append(card)
            continue
        flush()
        group = ("", [])
        if kind == "turn":
            parts.append(f"T{fact['turn']}")
        elif kind == "life":
            parts.append(f"{fact['player']} {fact['life']}")
        elif kind == "override":
            parts.append(f"override: {fact['result']}")
        elif kind == "restore":
            parts.append(f"restored {fact['name']}")
        elif kind == "end":
            parts.append(f"over: {fact.get('reason')}")
    flush()
    return " · ".join(parts)


def header(facts: List[dict]) -> str:
    """The deck, revision and seed a game tested."""
    start = next((f for f in facts if f["t"] == "start"), None)
    if not start:
        return ""
    deck = start.get("deck") or start.get("commander", "")
    revision = f"@{start['hash']}" if start.get("hash") else ""
    return f"{deck}{revision} seed {start.get('seed')}"


def by_turn(facts: Iterable[dict]) -> "OrderedDict[int, List[dict]]":
    turns: "OrderedDict[int, List[dict]]" = OrderedDict()
    for fact in facts:
        turns.setdefault(fact.get("turn", 0), []).append(fact)
    return turns


def digest(facts: List[dict], decisions: bool = False) -> List[str]:
    """One line per turn of the agent's: draws, land, spells, abilities, and life totals that moved."""
    lines = []
    for turn, group in by_turn(facts).items():
        drew = [f["card"] for f in group if f["t"] == "draw"]
        lands = [f["card"] for f in group if f["t"] == "land"]
        cast = [f["card"] for f in group if f["t"] == "cast" and not f.get("failed")]
        used = [f["card"] for f in group if f["t"] == "activate" and not f.get("failed")]
        life = OrderedDict((f["player"], f["life"]) for f in group if f["t"] == "life")
        fixes = sum(1 for f in group if f["t"] == "override")
        parts = [f"drew {names(drew)}" if drew else "", f"land {names(lands)}" if lands else "",
                 f"cast {names(cast)}" if cast else "", f"used {names(used)}" if used else "",
                 " ".join(f"{p} {v}" for p, v in life.items()), f"{fixes} override(s)" if fixes else ""]
        if any(f["t"] == "end" for f in group):
            parts.append("over: " + next(f.get("reason") for f in group if f["t"] == "end"))
        lines.append(f"T{turn} " + " · ".join(p for p in parts if p))
        if decisions:
            for f in group:
                if f["t"] == "decision" and f.get("by") != "forced":
                    lines.append(f"   {'(ai) ' if f.get('by') == 'ai' else ''}{f['kind']}{' (' + f['prompt'] + ')' if f.get('prompt') else ''}: "
                                 f"{', '.join(map(str, f['answer'])) or 'none'}")
    return lines


def cards(facts: Iterable[dict]) -> Tuple[List[str], List[str]]:
    """Cards seen (drawn, or looked at by scry, surveil or reveal) and cards played (lands and spells), by name.

    A physical card counts as seen once, however often it comes back (a mulligan, a scry then a draw).
    """
    seen: List[str] = []
    seen_ids = set()
    played: List[str] = []

    def see(name, card_id):
        if card_id is None or card_id not in seen_ids:
            seen_ids.add(card_id)
            seen.append(name)

    for fact in facts:
        if fact["t"] == "draw":
            see(fact["card"], fact.get("id"))
        elif fact["t"] == "look" and fact.get("why", "").split(" ")[0] in SEEING:
            for name, card_id in zip(fact["cards"], fact.get("ids") or [None] * len(fact["cards"])):
                see(name, card_id)
        elif fact["t"] == "land" or (fact["t"] == "cast" and not fact.get("failed")):
            played.append(fact["card"])
    return seen, played
