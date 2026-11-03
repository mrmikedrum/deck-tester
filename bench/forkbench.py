"""How much a fork costs, and how that scales when several replay at once.

Plays one game with Forge's AI to the given turn, parks it, then forks it over and over: N at a time,
each fork ended as soon as it is parked. Reports milliseconds per fork (replay only) and forks per second.

    python3 bench/forkbench.py --turn 8 --forks 40 --concurrency 1,2,4,8,16
"""

import argparse
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from goldfish import decklist, engine, model  # noqa: E402

DECK = Path(__file__).resolve().parent.parent / "examples" / "decks" / "eternities-living-worlds-iii.txt"


def park(seed: int, turn: int) -> dict:
    deck = decklist.load(DECK)
    reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": seed,
                            "turns": turn + 2, "ask": ["play"], "mana": "auto"})
    while reply.get("decision") and not (model.turn(reply["decision"]) >= turn and reply["decision"]["kind"] == "play"
                                         and model.ours(reply["decision"])):
        reply = engine.request({"cmd": "answer", "session": reply["session"], "defer": True})
    return reply


def one(session: str) -> dict:
    began = time.time()
    fork = engine.request({"cmd": "fork", "session": session})
    engine.request({"cmd": "end", "session": fork["session"]})
    return {"ms": fork["ms"], "wall": 1000 * (time.time() - began), "replayed": fork["replayed"]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--turn", type=int, default=8)
    parser.add_argument("--forks", type=int, default=40)
    parser.add_argument("--concurrency", default="1,2,4,8,16")
    args = parser.parse_args()
    reply = park(args.seed, args.turn)
    session = reply["session"]
    try:
        print(f"parked at {reply['decision']['turn']}")
        for n in [int(x) for x in args.concurrency.split(",")]:
            began = time.time()
            with ThreadPoolExecutor(max_workers=n) as pool:
                results = list(pool.map(lambda _: one(session), range(args.forks)))
            seconds = time.time() - began
            ms = [r["ms"] for r in results]
            print(f"{n:2d} at a time: {statistics.median(ms):5.0f} ms per fork (replay), {statistics.median(r['wall'] for r in results):5.0f} ms wall "
                  f"incl. end · {args.forks / seconds:5.1f} forks/s · {results[0]['replayed']} decisions replayed")
    finally:
        engine.request({"cmd": "end", "session": session})
    return 0


if __name__ == "__main__":
    sys.exit(main())
