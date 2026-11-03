"""Fork fidelity: play games, fork at given turns, count forks that replay into the same game, time them.

    python3 bench/fidelity.py MODE DECK... --seeds 1,2,3 --turns 3,5,8

MODE: ai (Forge's AI answers every parked decision), explicit (first non-pass option at single picks, the AI
elsewhere), all (every kind parked and handed to the AI), scripted (every kind parked and answered by a fixed
rule, so Forge's AI never weighs anything and games repeat exactly).
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from goldfish import decklist, engine, model  # noqa: E402


def play(deck, seed, mode, fork_turns, last):
    asks = ["play"] if mode in ("ai", "explicit") else list(model.KINDS) + ["order", "pay"]
    r = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": seed,
                        "turns": last + 1, "ask": asks, "mana": "auto"})
    s = r["session"]
    results = []
    answered = {}
    forked = set()
    unlisted = 0
    try:
        while r.get("decision"):
            d = r["decision"]
            turn = model.turn(d)
            if turn > last:
                break
            if turn in fork_turns and turn not in forked and d["kind"] == "play" and model.ours(d):
                forked.add(turn)
                began = time.time()
                try:
                    f = engine.request({"cmd": "fork", "session": s})
                    results.append((turn, "ok", f["ms"], f["replayed"]))
                    engine.request({"cmd": "end", "session": f["session"]})
                except engine.EngineError as e:
                    results.append((turn, f"parent {s}: " + str(e)[:400], int(1000 * (time.time() - began)), None))
            answered[turn] = answered.get(turn, 0) + 1
            if mode in ("explicit", "scripted") and d["options"] and d["max"] == 1:
                real = [o for o in d["options"] if o != "pass"]
                if d["kind"] == "play" and answered[turn] > 40:
                    real = []  # a repeatable activation would never end the turn
                a = {"answer": [d["options"].index(real[0]) + 1]} if real else ({"defer": True} if mode == "explicit" else {"answer": [1]})
            elif mode == "scripted":
                if not d["options"]:
                    a = {"answer": [d["min"]]}
                elif d["kind"] == "pay":
                    a = {"answer": []}
                elif d.get("repeat") or d["min"] > len(d["options"]):
                    a = {"answer": [1] * d["min"]}  # repeats allowed (a die, a split of counters)
                else:
                    a = {"answer": list(range(1, d["min"] + 1))}
            else:
                a = {"defer": True}
            r = engine.request(dict(a, cmd="answer", session=s))
    finally:
        r = engine.request({"cmd": "end", "session": s})
    with open(r["records"]) as h:
        for line in h:
            f = json.loads(line)
            if f.get("t") == "decision" and "(unlisted)" in (f.get("answer") or []):
                unlisted += 1
    return results, unlisted


def main():
    p = argparse.ArgumentParser()
    p.add_argument("mode")
    p.add_argument("decks", nargs="+")
    p.add_argument("--seeds", default="1,2,3")
    p.add_argument("--turns", default="3,5,8")
    p.add_argument("--workers", type=int, default=4)
    a = p.parse_args()
    seeds = [int(x) for x in a.seeds.split(",")]
    turns = [int(x) for x in a.turns.split(",")]
    engine.refresh()
    engine.request({"cmd": "sessions"})
    jobs = [(deck, seed) for deck in a.decks for seed in seeds]
    began = time.time()

    def one(job):
        deck, seed = job
        return deck, seed, play(decklist.load(deck), seed, a.mode, set(turns), max(turns))

    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        outs = list(pool.map(one, jobs))
    ok, bad, unlisted_total = 0, [], 0
    ms_by_turn = {}
    for deck, seed, (results, unlisted) in outs:
        unlisted_total += unlisted
        for turn, status, ms, replayed in results:
            if status == "ok":
                ok += 1
                ms_by_turn.setdefault(turn, []).append((ms, replayed))
            else:
                bad.append((os.path.basename(deck), seed, turn, status))
    print(f"{a.mode}: {ok} forks replayed exactly, {len(bad)} drifted, {unlisted_total} unlisted AI plays, {time.time() - began:.0f}s")
    for turn in sorted(ms_by_turn):
        xs = ms_by_turn[turn]
        print(f"  T{turn}: median {sorted(m for m, _ in xs)[len(xs) // 2]} ms, max {max(m for m, _ in xs)} ms, "
              f"median {sorted(n for _, n in xs)[len(xs) // 2]} decisions replayed")
    for b in bad:
        print("  drift:", *b)


if __name__ == "__main__":
    main()
