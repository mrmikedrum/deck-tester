"""Replay forks against copy forks where it matters: at the pilot's decisions, play every option out both ways
and compare what the decision model would read about each (its result line). Forge's AI plays the games.

    python3 bench/forks_compare.py DECK --seeds 301,302 --turns 6
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from goldfish import decklist, engine, model  # noqa: E402


def results(decider, reply, tries, state, now):
    lines, _ = decider.explore(reply, tries)
    return {name: model.after_line(state, line.facts, line.state, now) for name, line in lines.items()}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("deck")
    p.add_argument("--seeds", default="301,302")
    p.add_argument("--turns", type=int, default=6)
    p.add_argument("--against", choices=("copy", "replay"), default="copy", help="replay against replay measures the noise")
    a = p.parse_args()
    deck = decklist.load(a.deck)
    usage = model.Usage()
    replay, copy = model.Decider("", 3, usage), model.Decider("", 3, usage)
    replay.fork_via, copy.fork_via = "replay", a.against
    same = differ = 0
    for seed in [int(x) for x in a.seeds.split(",")]:
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": seed,
                                "turns": a.turns + 2, "ask": ["play"], "mana": "auto", "forks": "copy"})
        try:
            while reply.get("decision"):
                decision = reply["decision"]
                now = model.turn(decision)
                if now > a.turns:
                    break
                tries = model.lines_to_try(decision) if model.ours(decision) else {}
                if len(tries) >= 2:
                    state = engine.request({"cmd": "state", "session": reply["session"], "text": True})["state"]
                    one, two = results(replay, reply, tries, state, now), results(copy, reply, tries, state, now)
                    if one == two:
                        same += 1
                    else:
                        differ += 1
                        for name in sorted(set(one) | set(two)):
                            if one.get(name) != two.get(name):
                                print(f"seed {seed} {decision['turn']} {name}:\n  replay: {one.get(name)}\n  copy:   {two.get(name)}")
                reply = engine.request({"cmd": "answer", "session": reply["session"], "defer": True})
        finally:
            engine.request({"cmd": "end", "session": reply["session"]})
    print(f"{same} decisions read the same both ways, {differ} differ; replay {usage.fork_ms} ms of forks over {usage.played_out} lines in all")


if __name__ == "__main__":
    main()
