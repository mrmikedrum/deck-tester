"""Reports on a table game: a manifest written when the table ends (who sat where, with what), and a summary built
from the seats' records: the result, each player's life by round, and per agent seat who made its decisions, how
its lookahead went, and how it developed.
"""

import json
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

from . import engine, records

TABLES = engine.HOME / "tables"


def save(manifest: dict) -> Path:
    """Writes the manifest as the next t<N>.json; returns its path."""
    TABLES.mkdir(parents=True, exist_ok=True)
    numbers = [int(p.stem[1:]) for p in TABLES.glob("t*.json") if p.stem[1:].isdigit()]
    manifest["id"] = f"t{max(numbers, default=0) + 1}"
    path = TABLES / f"{manifest['id']}.json"
    path.write_text(json.dumps(manifest, indent=1) + "\n")
    return path


def load(table_id: Optional[str] = None) -> dict:
    """A table's manifest by id (t3), or the last one."""
    if table_id:
        return json.loads((TABLES / f"{table_id}.json").read_text())
    paths = sorted(TABLES.glob("t*.json"), key=lambda p: int(p.stem[1:]) if p.stem[1:].isdigit() else 0)
    if not paths:
        raise FileNotFoundError("no tables yet")
    return json.loads(paths[-1].read_text())


def _facts(session: str) -> List[dict]:
    path = engine.HOME / "runs" / f"{session}.jsonl"
    return records.load(str(path)) if path.exists() else []


def seat_summary(facts: List[dict]) -> Dict[str, object]:
    """One agent seat's game, from its record."""
    by = Counter(f.get("by") for f in facts if f["t"] == "decision")
    forks = [f for f in facts if f["t"] == "fork" and not f.get("refused")]
    eots = {f["turn"]: f for f in facts if f["t"] == "eot"}
    turns = max((f.get("turn", 0) for f in facts), default=0)
    start = next((f for f in facts if f["t"] == "start"), {})
    commanders = set((start.get("commander") or "").split(" + "))
    cmdr = next((f["turn"] for f in facts if f["t"] == "cast" and f.get("card") in commanders and not f.get("failed")), None)
    return {"deck": start.get("deck"), "commander": start.get("commander"), "turns": turns,
            "decisions": sum(by.values()), "by": dict(by), "forks": len(forks),
            "forks_failed": sum(1 for f in forks if f.get("failed")),
            "forks_refused": sum(1 for f in facts if f["t"] == "fork" and f.get("refused")),
            "spells": sum(1 for f in facts if f["t"] == "cast" and not f.get("failed")),
            "eot": eots, "commander_turn": cmdr,
            "end": next((f.get("reason") for f in reversed(facts) if f["t"] == "end"), None)}


def life_by_round(facts: List[dict], players: List[str]) -> Dict[int, Dict[str, int]]:
    """Each player's life at the end of each of this seat's turns (40 until a change is recorded)."""
    life = {p: 40 for p in players}
    rounds: Dict[int, Dict[str, int]] = {}
    for f in facts:
        if f["t"] == "life" and f.get("player") in life:
            life[f["player"]] = f["life"]
        if f["t"] in ("eot", "end"):
            rounds[f.get("turn", 0)] = dict(life)
    return rounds


def build(manifest: dict) -> List[str]:
    seats = manifest["seats"]
    agents = [s for s in seats if s.get("session")]
    summaries = {s["name"]: seat_summary(_facts(s["session"])) for s in agents}
    players = [s["name"] for s in seats]
    lines = [f"{manifest['id']} · {len(seats)} players ({len(agents)} agents) · {manifest.get('result', '?')} · "
             f"{manifest.get('seconds', 0):.0f}s" + (f" · model {manifest['model']}" if manifest.get("model") else "")]
    if agents:
        rounds = life_by_round(_facts(agents[0]["session"]), players)
        if rounds:
            lines.append("life at the end of each round (" + agents[0]["name"] + "'s turns):")
            lines.append("  " + "  ".join(f"{n[:18]:>18}" for n in players))
            for turn in sorted(rounds):
                if turn:
                    lines.append(f"T{turn:<2}" + "  ".join(f"{rounds[turn].get(n, 40):>18}" for n in players))
    for seat in agents:
        s = summaries[seat["name"]]
        shares = ", ".join(f"{k} {v}" for k, v in sorted(s["by"].items(), key=lambda kv: -kv[1]))
        lines.append(f"{seat['name']}: {s['commander']} · {s['turns']} turns · {s['decisions']} decisions ({shares})"
                     f" · {s['forks']} forks" + (f", {s['forks_failed']} failed" if s["forks_failed"] else "")
                     + (f" ({s['forks_refused']} refused after others acted)" if s["forks_refused"] else "")
                     + f" · {s['spells']} spells" + (f" · commander T{s['commander_turn']}" if s["commander_turn"] else ""))
        last = s["eot"].get(max(s["eot"])) if s["eot"] else None
        if last:
            lines.append(f"  at T{last['turn']}: {last['lands']} lands, {last['mana']} mana, {last['creatures']} creatures"
                         f" ({last.get('power', 0)} power), {last['permanents']} other permanents, {last['hand']} cards in hand")
    for seat in seats:
        if not seat.get("session"):
            lines.append(f"{seat['name']}: a person")
    return lines


def manifest(table_reply: dict, seats: list, people: List[str], began: float, result: str, usage) -> dict:
    """What a finished table records about itself; people are named as they joined."""
    entries = [{"name": s.name, "deck": s.slug, "revision": s.revision, "plan": bool(s.plan), "pilot": s.pilot,
                "session": table_reply["seats"][s.name]} for s in seats]
    entries += [{"name": name} for name in people]
    return {"port": table_reply["port"], "seats": entries, "result": result,
            "seconds": round(time.time() - began, 1),
            "model": f"{usage.calls} calls, ${usage.cost:.2f}" if usage and usage.calls else None}
