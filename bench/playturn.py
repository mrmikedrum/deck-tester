"""Set up a position in a real game and let the decision model play the rest of the turn, with forks and an
advisor, then show what it did. For engines and combos that take several decisions, where one scenario
pick isn't the test.

    python3 bench/playturn.py DECK PLAN --turn 5 --board "Island;Island;Minamo, School at Water's Edge" \\
        --hand "Tui and La, Moon and Ocean" --setup "move:Princess Yue:battlefield|destroy:Princess Yue" --advisor FILE
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bench import scenarios  # noqa: E402
from goldfish import batch, decklist, engine, model, records  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck")
    parser.add_argument("plan")
    parser.add_argument("--turn", type=int, default=4)
    parser.add_argument("--board", default="", help="cards to create on the battlefield, separated by ;")
    parser.add_argument("--hand", default="", help="cards to put in hand, separated by ; (replaces the hand)")
    parser.add_argument("--setup", default="", help='further overrides, "op:arg:arg" separated by |')
    parser.add_argument("--advisor", help="a pilot file with advise()")
    parser.add_argument("--turns", type=int, default=1, help="turns of the agent's to let the model play")
    parser.add_argument("--seed", type=int, default=101)
    args = parser.parse_args()
    deck = decklist.load(args.deck)
    advise = batch.load_pilot(args.advisor).get("advise") if args.advisor else None
    decider = model.Decider(Path(args.plan).read_text(), 3, model.Usage(), "outcomes", advise=advise)
    scenario = {"turn": args.turn, "battlefield": [c for c in args.board.split(";") if c], "hand": [c for c in args.hand.split(";") if c],
                "setup": [op.split(":") for op in args.setup.split("|") if op]}
    engine.refresh()
    reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": args.seed,
                            "turns": args.turn + args.turns + 2, "ask": list(model.KINDS), "mana": "auto"})
    session = reply["session"]
    try:
        reply = scenarios.answer(reply, "keep")
        target = f"T{args.turn} main1"
        while reply.get("decision") and reply["decision"]["turn"] != target:
            d = reply["decision"]
            reply = engine.request(dict({"answer": [1]} if d["kind"] == "play" else {"defer": True}, cmd="answer", session=session))
        reply = scenarios.set_up(reply, scenario)
        last = args.turn + args.turns - 1
        while reply.get("decision") and model.turn(reply["decision"]) <= last:
            reply = decider.step(reply)
    finally:
        reply = engine.request({"cmd": "end", "session": session})
    facts = [f for f in records.timeline(records.load(reply["records"])) if args.turn <= f.get("turn", 0) <= last and f["t"] != "override"]
    for line in records.digest(facts, decisions=True):
        print(line)
    print(f"model: {decider.usage.calls} calls, {decider.usage.played_out} lines played out, {decider.usage.drifted} drifted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
