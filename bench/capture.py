"""Capture real decision situations for designing what the decision model reads.

Plays a game with Forge's AI deciding. At each decision of the agent's own turn that has a real choice, it
plays out Forge's pick and every option in forks to the start of the next turn, then saves the situation:
the board, the decision, this turn's facts, each line's facts and end state, and which line is Forge's
default. Nothing here calls the model.

    python3 bench/capture.py DECK PLAN --seed 3001 --turns 6 --limit 12
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from goldfish import batch, decklist, engine, model, records  # noqa: E402

SITUATIONS = Path(__file__).resolve().parent / "situations"


class Capture(model.Decider):
    def __init__(self, name: str, plan: str, limit: int, start: int = 1):
        super().__init__(plan, 3, model.Usage(), "outcomes")
        self.name, self.plan, self.limit, self.start, self.saved = name, plan, limit, start, 0

    def step(self, reply: dict) -> dict:
        decision, session = reply["decision"], reply["session"]
        tries = model.lines_to_try(decision) if decision["kind"] in model.KINDS and not decision.get("repeat") else {}
        if (self.saved >= self.limit or len(tries) < 2 or not model.ours(decision)
                or model.turn(decision) < self.start or (decision["kind"] == "play" and decision["options"] == ["pass"])):
            return self.send(reply, {"defer": True})
        state = engine.request({"cmd": "state", "session": session, "text": True})["state"]
        now = model.turn(decision)
        so_far = [f for f in records.timeline(records.load(reply["records"])) if f.get("turn") == now]
        try:
            lines, default = self.explore(reply, tries)
        except engine.EngineError as error:
            print(f"skipped a situation: {error}")
            return self.send(reply, {"defer": True})
        self.saved += 1
        situation = {"id": f"{self.name}-T{now}-{self.saved}", "plan": self.plan, "state": state,
                     "decision": decision, "so_far": so_far, "default": default,
                     "lines": {name: {"facts": line.facts, "state": line.state} for name, line in lines.items()},
                     "expected": None, "note": ""}
        SITUATIONS.mkdir(exist_ok=True)
        (SITUATIONS / f"{situation['id']}.json").write_text(json.dumps(situation, indent=1, ensure_ascii=False))
        print(f"saved {situation['id']}: {decision['kind']} {decision.get('prompt') or ''} · {', '.join(lines)} · default {default}")
        return self.send(reply, {"defer": True})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("deck")
    parser.add_argument("plan")
    parser.add_argument("--seed", type=int, default=3001)
    parser.add_argument("--turns", type=int, default=6)
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--from", dest="start", type=int, default=1, help="first turn to capture from")
    args = parser.parse_args()
    deck = decklist.load(args.deck)
    name = f"{Path(args.deck).stem}-{args.seed}"
    capture = Capture(name, Path(args.plan).read_text(), args.limit, args.start)
    start = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": args.seed,
             "turns": args.turns + 2, "ask": list(model.KINDS), "mana": "auto"}
    engine.refresh()
    batch._play(start, {}, capture, [], args.turns)
    print(f"{capture.saved} situations from {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
