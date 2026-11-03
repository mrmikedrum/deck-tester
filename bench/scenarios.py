"""Hand-built situations with one right answer that depends on sequencing, for designing what the decision
model reads. Each is set up with overrides in a real game (the Marath deck, so the plan applies), then
every option is played out in forks like the decider does, and the situation is saved next to the captured
ones with its expected answer fixed here, before any test.

    python3 bench/scenarios.py            # build them all into bench/situations/scenario-*.json
    python3 bench/scenarios.py sol-ring-first
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from goldfish import decklist, engine, model, records  # noqa: E402

SITUATIONS = Path(__file__).resolve().parent / "situations"
DECK = Path(__file__).resolve().parent.parent / "examples" / "decks" / "eternities-living-worlds-iii.txt"
PLAN = Path(__file__).resolve().parent.parent / "examples" / "plans" / "living-worlds.txt"

# turn: the agent's turn to set up in (at its first main phase); hand and battlefield replace what the game
# dealt; first: answers to give before the decision to capture (labels); expected: right answers by label.
SCENARIOS = {
    "sol-ring-first": {
        "note": "Turn 1 with one land: Sol Ring makes two mana at once, so it comes before the colourless one-drop, which it then pays for.",
        "turn": 1, "hand": ["Forest", "Plains", "Sol Ring", "Hope of Ghirapur", "Cultivate", "Beast Within"],
        "first": ["Forest (land)"], "expected": ["Sol Ring"]},
    "sol-ring-then-rock": {
        "note": "Two lands: Sol Ring first leaves three mana for Mind Stone or Cultivate too; Mind Stone first leaves nothing.",
        "turn": 2, "battlefield": ["Forest", "Plains"], "hand": ["Sol Ring", "Mind Stone", "Cultivate", "Beast Within"],
        "expected": ["Sol Ring"]},
    "land-before-spells": {
        "note": "The land drop first: it makes the two-mana ramp spell castable this turn.",
        "turn": 2, "battlefield": ["Forest"], "hand": ["Forest", "Llanowar Elves", "Rampant Growth", "Beast Within"],
        "expected": ["Forest (land)"]},
    "use-all-mana": {
        "note": "Two mana after the land drop: Rampant Growth spends both and adds a land; Elves leaves one unspent.",
        "turn": 2, "battlefield": ["Forest"], "hand": ["Forest", "Llanowar Elves", "Rampant Growth", "Beast Within"],
        "first": ["Forest (land)"], "expected": ["Rampant Growth"]},
    "untapped-land-first": {
        "note": "Plains enters untapped and lets Rampant Growth be cast now; the tapped land would waste the turn.",
        "turn": 2, "battlefield": ["Forest"], "hand": ["Plains", "Thornwood Falls", "Rampant Growth", "Beast Within"],
        "expected": ["Plains (land)"]},
    "commander-on-curve": {
        "note": "Four lands on turn 3 and the plan wants Marath early: cast the commander, not the removal the plan says to hold.",
        "turn": 3, "battlefield": ["Forest", "Plains", "Mountain"], "hand": ["Forest", "Beast Within", "Chaos Warp"],
        "first": ["Forest (land)"], "expected": ["Marath, Will of the Wild (commander)"]},
    "x-max": {
        "note": "Walking Ballista with four mana: X is two; less throws mana away.",
        "turn": 3, "battlefield": ["Forest", "Plains", "Mountain", "Sol Ring"], "hand": ["Walking Ballista", "Beast Within"],
        "first": ["Walking Ballista"], "expected": ["X = 2"]},
    "doubler-token": {
        "note": "Doubling Season and Marath with counters: the X/X token comes out doubled, so Marath's token beats casting a creature of that size.",
        "turn": 4, "battlefield": ["Forest", "Plains", "Mountain", "Doubling Season"], "hand": ["Beast Within"],
        "setup": [["move", "Marath, Will of the Wild", "battlefield"], ["counter", "Marath, Will of the Wild", "+1/+1", "+3"]],
        "expected": ["Marath, Will of the Wild: {X}, Remove any number of +1/+1 counters from Mar…"]},
    "moon-copy": {
        "note": "The Blue Moon line: a clone of Princess Yue died to the legend rule and returns as the land Moon copying a creature. "
                "Copying Tui and La puts her tap and untap triggers on a land that Deserted Temple and Minamo untap; copying Yue again only scries.",
        "deck": "blue-moon-combat-revision", "plan": "blue-moon", "turn": 5,
        "battlefield": ["Island", "Island", "Island", "Island", "Minamo, School at Water's Edge", "Deserted Temple", "Matoya, Archon Elder",
                        "Tui and La, Moon and Ocean", "Wake Thrasher"],
        "hand": ["Phyrexian Metamorph", "Island"], "setup": [["move", "Princess Yue", "battlefield"]],
        "first": ["Island (land)", "Phyrexian Metamorph", "Princess Yue 3/2", "Princess Yue 3/2", "pass"],
        "expected": ["Tui and La, Moon and Ocean 3/3"]},
    "mulligan-no-lands": {
        "note": "Seven spells and no land: mulligan.",
        "mulligan": True, "hand": ["Cultivate", "Beast Within", "Rampant Growth", "Llanowar Elves", "Mind Stone", "Sol Ring", "Eternal Witness"],
        "expected": ["mulligan"]},
    "mulligan-keep": {
        "note": "Three lands, Sol Ring and ramp: keep.",
        "mulligan": True, "hand": ["Forest", "Plains", "Mountain", "Sol Ring", "Rampant Growth", "Llanowar Elves", "Beast Within"],
        "expected": ["keep"]},
}


def override(session: str, *args) -> dict:
    return engine.request({"cmd": "override", "session": session, "args": list(args)})


def set_up(reply: dict, scenario: dict) -> dict:
    """Replace the hand (and battlefield) with the scenario's; returns the reply with the decision asked again."""
    session = reply["session"]
    state = engine.request({"cmd": "state", "session": session})["state"]
    for card in state["hand"]:
        reply = override(session, "move", card, "library")
    for card in scenario.get("hand", []):
        reply = override(session, "create", card, "hand")
    for card in scenario.get("battlefield", []):
        reply = override(session, "create", card, "battlefield")
    for args in scenario.get("setup", []):
        reply = override(session, *args)
    return reply


def answer(reply: dict, label: str) -> dict:
    decision = reply["decision"]
    full = next(o for o in decision["options"] if o == label or o.startswith(label))
    return engine.request({"cmd": "answer", "session": reply["session"], "answer": model._numbers(decision, [full])})


def build(name: str, scenario: dict, decider: model.Decider) -> dict:
    root = Path(__file__).resolve().parent.parent
    deck = decklist.load(root / "examples" / "decks" / (scenario["deck"] + ".txt")) if "deck" in scenario else decklist.load(DECK)
    plan = (root / "examples" / "plans" / (scenario["plan"] + ".txt")).read_text() if "plan" in scenario else PLAN.read_text()
    reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 101,
                            "turns": 6, "ask": list(model.KINDS), "mana": "auto"})
    session = reply["session"]
    try:
        if scenario.get("mulligan"):
            reply = set_up(reply, scenario)
        else:
            reply = answer(reply, "keep")
            target = f"T{scenario['turn']} main1"
            while reply.get("decision") and reply["decision"]["turn"] != target:
                decision = reply["decision"]
                request = {"cmd": "answer", "session": session}
                request.update({"answer": [1]} if decision["kind"] == "play" else {"defer": True})
                reply = engine.request(request)
            assert reply.get("decision"), f"{name}: never reached {target}"
            reply = set_up(reply, scenario)
            for label in scenario.get("first", []):
                # Reach the next decision that offers this label: pass priority while something is on the stack,
                # and let Forge's AI take any other decision on the way (a payment, a confirmation).
                for _ in range(40):
                    decision = reply["decision"]
                    if any(o == label or o.startswith(label) for o in decision["options"]):
                        break
                    stacked = decision["kind"] == "play" and engine.request({"cmd": "state", "session": session})["state"]["stack"]
                    reply = engine.request({"cmd": "answer", "session": session, **({"answer": [1]} if stacked else {"defer": True})})
                else:
                    raise AssertionError(f"{name}: never offered {label!r}")
                reply = answer(reply, label)
        decision = reply["decision"]
        state = engine.request({"cmd": "state", "session": session, "text": True})["state"]
        tries = model.lines_to_try(decision)
        lines, default = decider.explore(reply, tries)
        if decision["kind"] == "mulligan":
            # Mulligans are never played out (the line would show the next hand): both answers, plain.
            lines = {label: model.Line([label], [], state, None, 0) for label in decision["options"]}
        now = model.turn(decision)
        so_far = [] if scenario.get("mulligan") else [
            f for f in records.timeline(records.load(reply["records"])) if f.get("turn") == now and f["t"] != "override"]
        for expected in scenario["expected"]:
            assert expected in lines, f"{name}: expected {expected!r} isn't among {list(lines)}"
        return {"id": f"scenario-{name}", "plan": plan, "state": state, "decision": decision, "so_far": so_far,
                "default": default, "lines": {n: {"facts": l.facts, "state": l.state} for n, l in lines.items()},
                "expected": scenario["expected"], "note": scenario["note"]}
    finally:
        engine.request({"cmd": "end", "session": session})


def main() -> int:
    names = sys.argv[1:] or list(SCENARIOS)
    decider = model.Decider(PLAN.read_text(), 3, model.Usage(), "outcomes")
    engine.refresh()
    SITUATIONS.mkdir(exist_ok=True)
    for name in names:
        situation = build(name, SCENARIOS[name], decider)
        (SITUATIONS / f"{situation['id']}.json").write_text(json.dumps(situation, indent=1, ensure_ascii=False))
        print(f"{situation['id']}: {situation['decision']['kind']} · options {list(situation['lines'])} · default {situation['default']}"
              f" · expected {situation['expected']}")
    print(f"forks: {decider.usage.played_out}, drifted {decider.usage.drifted}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
