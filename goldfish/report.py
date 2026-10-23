"""A batch's report: per-turn averages, the commander, and per-game and per-card detail on request."""

import statistics
from collections import Counter, defaultdict
from typing import Dict, List

from . import records

STARTING_LIFE = 40


def game_summary(facts: List[dict], commanders: List[str]) -> dict:
    """The numbers one game contributes: per-turn end states, land drops, spells, commander turn."""
    turns: Dict[int, dict] = {}
    lands_played = Counter()
    spells = Counter()
    commander_turn = None
    mulligans = 0
    opponents = 3
    for fact in facts:
        kind, turn = fact["t"], fact.get("turn", 0)
        if kind == "start":
            opponents = fact.get("opponents", 3)
        elif kind == "eot":
            turns[turn] = fact
        elif kind == "land":
            lands_played[turn] += 1
        elif kind == "cast" and not fact.get("failed"):
            spells[turn] += 1
            if commander_turn is None and fact["card"] in commanders:
                commander_turn = turn
        elif kind == "decision" and fact.get("kind") == "mulligan" and fact.get("answer") == ["mulligan"]:
            mulligans += 1
    last = max(turns) if turns else 0
    return {"turns": turns, "last": last, "missed": [t for t in range(1, last + 1) if not lands_played[t]],
            "spells": spells, "commander": commander_turn, "mulligans": mulligans,
            "damage": {t: STARTING_LIFE * opponents - turns[t]["opponents_life"] for t in turns}}


def _average(values: List[float]) -> str:
    return f"{statistics.mean(values):.1f}".replace("-0.0", "0.0") if values else "-"


def summary(manifest: dict, summaries: List[dict]) -> List[str]:
    games = manifest["games"]
    seeds = [g["seed"] for g in games]
    ai = "Forge AI" + ("" if manifest.get("ai", "default") == "default" else f" ({manifest['ai']})")
    pilot = f"{manifest['pilot']} + {ai}" if manifest.get("pilot") else ai
    cap = f"to turn {manifest['turns']}" if manifest.get("turns") else "uncapped"
    lines = [f"{manifest['id']} · {manifest['deck']}@{manifest['hash']} · {len(games)} games · seeds "
             f"{min(seeds)}-{max(seeds)} · {pilot} · {cap} · {manifest['seconds']}s"]
    if manifest.get("ai_avoids"):
        lines.append("Forge's AI doesn't play: " + ", ".join(manifest["ai_avoids"]) + " (a pilot or manual play can)")
    last = max((s["last"] for s in summaries), default=0)
    turns = range(1, last + 1)
    rows = {"lands": [], "mana": [], "unspent": [], "missed %": [], "spells": [], "damage": []}
    for t in turns:
        reached = [s for s in summaries if t in s["turns"]]
        rows["lands"].append(_average([s["turns"][t]["lands"] for s in reached]))
        rows["mana"].append(_average([s["turns"][t]["mana"] for s in reached]))
        rows["unspent"].append(_average([s["turns"][t]["unspent"] for s in reached]))
        missed = sum(1 for s in reached if t in s["missed"])
        rows["missed %"].append(f"{100 * missed // len(reached)}" if reached else "-")
        rows["spells"].append(_average([sum(n for turn, n in s["spells"].items() if 1 <= turn <= t) for s in reached]))
        rows["damage"].append(_average([s["damage"][t] for s in reached]))
    width = max(5, *(len(v) for values in rows.values() for v in values)) if last else 5
    lines.append("turn".ljust(9) + "".join(str(t).rjust(width + 1) for t in turns))
    for name, values in rows.items():
        lines.append(name.ljust(9) + "".join(v.rjust(width + 1) for v in values))
    cast = sorted(s["commander"] for s in summaries if s["commander"] is not None)
    if cast:
        lines.append(f"commander cast in {len(cast)}/{len(summaries)} · median T{statistics.median(cast):g} · T{cast[0]}-T{cast[-1]}")
    else:
        lines.append(f"commander never cast in {len(summaries)} games")
    mulligans = Counter(s["mulligans"] for s in summaries)
    if set(mulligans) != {0}:
        lines.append("mulligans: " + ", ".join(f"{n} in {count}" for n, count in sorted(mulligans.items())))
    return lines


def per_game(manifest: dict, summaries: List[dict]) -> List[str]:
    lines = []
    for game, s in zip(manifest["games"], summaries):
        last = s["last"]
        parts = [f"{game['session']} seed {game['seed']}"]
        if s["mulligans"]:
            parts.append(f"mull {s['mulligans']}")
        parts.append(f"cmdr T{s['commander']}" if s["commander"] is not None else "no cmdr")
        if last:
            parts.append(f"T{last} lands {s['turns'][last]['lands']} mana {s['turns'][last]['mana']} dmg {s['damage'][last]}")
        if s["missed"]:
            parts.append("missed drop " + ",".join(f"T{t}" for t in s["missed"]))
        if game.get("over") not in (None, "turn limit"):
            parts.append(f"over: {game['over']}")
        lines.append(" · ".join(parts))
    return lines


def cards(game_facts: List[List[dict]]) -> List[str]:
    """Per card: in how many games it was seen and played, most often seen first."""
    seen_in, played_in = Counter(), Counter()
    for facts in game_facts:
        seen, played = records.cards(facts)
        seen_in.update(set(seen))
        played_in.update(set(played))
    total = len(game_facts)
    names = sorted(set(seen_in) | set(played_in), key=lambda n: (-seen_in[n], -played_in[n], n))
    return [f"{name}: seen {seen_in[name]}/{total} · played {played_in[name]}" for name in names]


def build(manifest: dict, show_games: bool = False, show_cards: bool = False) -> List[str]:
    commanders = manifest.get("commander", "").split(" + ")
    game_facts = [records.load(game["records"]) for game in manifest["games"]]
    summaries = [game_summary(facts, commanders) for facts in game_facts]
    lines = summary(manifest, summaries)
    if show_games:
        lines += per_game(manifest, summaries)
    if show_cards:
        lines += cards(game_facts)
    return lines
