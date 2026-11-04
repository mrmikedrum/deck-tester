"""Copy forks at a table: four seats, each forked at every play decision and then answered by Forge's AI; counts
the forks that land in the same game. The table counterpart of fidelity.py, where other players act too.

    python3 bench/table_fidelity.py DECK DECK DECK DECK --turns 8
"""

import argparse
import collections
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from goldfish import decklist, engine, model  # noqa: E402


def seat(session, turns, results):
    reply = engine.request({"cmd": "decision", "session": session})
    while True:
        decision = reply.get("decision")
        if decision is None:
            if "over" in reply:
                return
            reply = engine.request({"cmd": "decision", "session": session})
            continue
        if model.turn(decision) > turns:
            engine.request({"cmd": "table_end"})  # every seat stops here; a seat that stopped answering holds the table
            return
        if decision["kind"] == "play":
            began = time.time()
            try:
                fork = engine.request({"cmd": "fork", "session": session})
                engine.request({"cmd": "end", "session": fork["session"]})
                results["ok"].append(int(1000 * (time.time() - began)))
            except engine.EngineError as error:
                results["drift"].append(f"{decision['turn']}: {error}")
        reply = engine.request({"cmd": "answer", "session": session, "defer": True})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("decks", nargs=4)
    p.add_argument("--turns", type=int, default=8)
    a = p.parse_args()
    engine.use_table()
    seats = []
    for i, path in enumerate(a.decks):
        d = decklist.load(path)
        seats.append({"name": f"Seat {i + 1}", "commanders": d.commanders, "main": d.main, "deck": Path(path).stem,
                      "hash": d.revision(), "ask": ["play"], "mana": "auto"})
    reply = engine.request({"cmd": "table", "seats": seats, "people": 0})
    results = collections.defaultdict(list)
    threads = [threading.Thread(target=seat, args=(sid, a.turns, results), daemon=True) for sid in reply["seats"].values()]
    began = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    engine.request({"cmd": "table_end"})
    ok = results["ok"]
    print(f"{len(ok)} copy forks landed in the same game, {len(results['drift'])} drifted, {time.time() - began:.0f}s; "
          f"median {sorted(ok)[len(ok) // 2] if ok else 0} ms")
    for line in results["drift"]:
        print("  drift:", line[:400])


if __name__ == "__main__":
    main()
