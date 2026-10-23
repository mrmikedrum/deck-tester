"""Command-line entry point. Output is written for agents: short, one fact per line, detail behind flags."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import batch, decklist, engine, records, render, report

ROOT = Path(__file__).resolve().parent.parent
CURRENT = engine.HOME / "current"
OFFSETS = engine.HOME / "offsets"


def _java_major():
    if not shutil.which("java"):
        return None
    try:
        out = subprocess.run(["java", "-version"], capture_output=True, text=True).stderr
    except OSError:
        return None
    match = re.search(r'version "(\d+)', out)
    return int(match.group(1)) if match else None


def doctor(_args) -> int:
    java = _java_major()
    checks = [
        ("python 3.9+", sys.version_info >= (3, 9), sys.version.split()[0]),
        ("java 17+", bool(java and java >= 17), f"found {java}" if java else "not found"),
        ("maven", bool(shutil.which("mvn")), "found" if shutil.which("mvn") else "not found"),
        ("forge", engine.RES.is_dir(), "vendor/forge (scripts/bootstrap-forge.sh)"),
    ]
    for name, ok, detail in checks:
        print(f"{'ok ' if ok else 'MISSING'} {name}: {detail}")
    return 0 if all(ok for _, ok, _ in checks) else 1


def deck_check(args) -> int:
    try:
        deck = decklist.load(args.path)
    except (OSError, decklist.DecklistError) as error:
        print(f"error: {error}")
        return 1
    print(f"commander: {' + '.join(deck.commanders) or 'none'}")
    print(f"cards: {deck.size}")
    problems = deck.problems()
    for problem in problems:
        print(f"problem: {problem}")
    return 1 if problems else 0


# ---- sessions ----

def _session(args) -> str:
    if args.session:
        return args.session
    if CURRENT.exists():
        return CURRENT.read_text().strip()
    raise engine.EngineError("no session; start one with: goldfish start DECK")


def _new_facts(reply: dict) -> list:
    """Facts recorded since this session's last output, and move the mark past them."""
    path = Path(reply["records"])
    if not path.exists():
        return []
    facts = records.load(path)
    OFFSETS.mkdir(parents=True, exist_ok=True)
    mark = OFFSETS / reply["session"]
    offset = int(mark.read_text()) if mark.exists() else 0
    mark.write_text(str(len(facts)))
    return facts[offset:]


def _show(reply: dict) -> None:
    line = records.happened(_new_facts(reply))
    if line:
        print(line)
    print(render.progress(reply))


def start(args) -> int:
    deck = decklist.load(args.deck)
    problems = deck.problems()
    if problems:
        print("deck problems: " + "; ".join(problems))
        return 1
    payload = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "stops": args.stops,
               "mana": args.mana, "opponents": args.opponents, "deck": Path(args.deck).stem, "hash": deck.revision()}
    if args.seed is not None:
        payload["seed"] = args.seed
    if args.turns is not None:
        payload["turns"] = args.turns
    if args.ask is not None:
        payload["ask"] = [] if args.ask == "none" else [kind.strip() for kind in args.ask.split(",") if kind.strip()]
        unknown = set(payload["ask"]) - set(batch.KINDS)
        if unknown:
            print(f"unknown kinds: {', '.join(sorted(unknown))}; kinds are {', '.join(batch.KINDS)}")
            return 1
    engine.refresh()
    reply = engine.request(payload)
    CURRENT.write_text(reply["session"])
    print(f"{reply['session']} seed {reply['seed']} · {Path(args.deck).stem}@{deck.revision()}")
    if reply.get("ai_avoids") and args.ask is not None:
        print("Forge's AI doesn't play: " + ", ".join(reply["ai_avoids"]))
    _show(reply)
    return 0


def _parse_answer(tokens) -> list:
    picks = []
    for token in tokens:
        if token.lower() in ("none", "-"):
            continue
        picks.extend(int(part) for part in token.split(",") if part)
    return picks


def answer(args) -> int:
    request = {"cmd": "answer", "session": _session(args)}
    if [token.lower() for token in args.answer] == ["ai"]:
        request["defer"] = True
    else:
        request["answer"] = _parse_answer(args.answer)
    _show(engine.request(request))
    return 0


def decision(args) -> int:
    reply = engine.request({"cmd": "decision", "session": _session(args)})
    _show(reply)
    if args.full and reply.get("decision"):
        for line in render.details(reply["decision"]):
            print(line)
    return 0


def state(args) -> int:
    reply = engine.request({"cmd": "state", "session": _session(args)})
    for line in render.state(reply["state"], full=args.full):
        print(line)
    return 0


def snapshot(args) -> int:
    payload = {"cmd": "snapshot", "session": _session(args)}
    if args.name:
        payload["name"] = args.name
    print(engine.request(payload)["result"])
    return 0


def restore(args) -> int:
    _show(engine.request({"cmd": "restore", "session": _session(args), "name": args.name}))
    return 0


def override(args) -> int:
    reply = engine.request({"cmd": "override", "session": _session(args), "args": args.args})
    _new_facts(reply)  # the result line below says it; don't repeat it on the next command
    print(reply["result"])
    print(render.progress(reply))
    return 0


def end(args) -> int:
    session = _session(args)
    reply = engine.request({"cmd": "end", "session": session})
    _new_facts(reply)
    if CURRENT.exists() and CURRENT.read_text().strip() == session:
        CURRENT.unlink()
    print(f"{session} over: {reply.get('over')}")
    return 0


def _facts(args) -> list:
    path = engine.HOME / "runs" / f"{_session(args)}.jsonl"
    if not path.exists():
        raise engine.EngineError(f"no record for {_session(args)}")
    facts = records.load(path)
    return facts if getattr(args, "all", False) else records.timeline(facts)


def log(args) -> int:
    facts = _facts(args)
    if args.turn is not None:
        for fact in records.by_turn(facts).get(args.turn, []):
            print(" ".join(f"{k}={v}" for k, v in fact.items() if k != "turn"))
        return 0
    header = records.header(facts)
    if header:
        print(header)
    for line in records.digest(facts, decisions=args.decisions):
        print(line)
    return 0


def cards(args) -> int:
    facts = _facts(args)
    if args.by_turn:
        for turn, group in records.by_turn(facts).items():
            seen, played = records.cards(group)
            print(f"T{turn} seen {records.names(seen) or '-'} · played {records.names(played) or '-'}")
        return 0
    seen, played = records.cards(facts)
    print(f"seen {len(seen)}: {records.names(seen)}")
    print(f"played {len(played)}: {records.names(played)}")
    return 0


def run(args) -> int:
    deck = decklist.load(args.deck)
    problems = deck.problems()
    if problems:
        print("deck problems: " + "; ".join(problems))
        return 1
    seed = args.seed if args.seed is not None else int.from_bytes(__import__("os").urandom(2), "big") * 100
    manifest = batch.run(deck, Path(args.deck).stem, args.games, seed, args.turns, args.opponents, args.pilot, args.workers)
    for line in report.build(manifest, show_games=args.per_game, show_cards=args.cards):
        print(line)
    return 0


def report_cmd(args) -> int:
    batch_id = args.batch or batch.latest()
    if not batch_id:
        raise engine.EngineError("no batches yet; run one with: goldfish run DECK")
    for line in report.build(batch.load(batch_id), show_games=args.per_game, show_cards=args.cards):
        print(line)
    return 0


def engine_cmd(args) -> int:
    if args.action == "stop":
        engine.stop()
        print("engine stopped")
    else:
        try:
            live = engine.request({"cmd": "sessions"}, start=False)["sessions"]
            print("engine running; sessions: " + (", ".join(live) or "none"))
        except engine.EngineError:
            print("engine not running")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="goldfish", description="Commander goldfishing for agents.")
    parser.add_argument("--session", help="session id (default: the last one started)")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("doctor", help="check the toolchain and Forge build").set_defaults(run=doctor)
    deck = commands.add_parser("deck", help="decklist commands").add_subparsers(dest="deck_command", required=True)
    check = deck.add_parser("check", help="parse a decklist and report construction problems")
    check.add_argument("path")
    check.set_defaults(run=deck_check)

    begin = commands.add_parser("start", help="start a manual game and show the first decision")
    begin.add_argument("deck")
    begin.add_argument("--seed", type=int)
    begin.add_argument("--turns", type=int, help="end the game after this many of your turns (default: no limit)")
    begin.add_argument("--stops", choices=("main", "all"), default="main",
                       help="main: priority on your main phases and with something on the stack; all: every time")
    begin.add_argument("--mana", choices=("creatures", "always", "auto"), default="creatures",
                       help="when you pick which sources pay: when a creature could pay, always, or never")
    begin.add_argument("--ask", help="decision kinds you answer, comma-separated, or 'none' (default: all); "
                       "Forge's AI answers the rest. Kinds: " + ", ".join(batch.KINDS))
    begin.add_argument("--opponents", type=int, default=3)
    begin.set_defaults(run=start)

    play = commands.add_parser("run", help="play a batch of games automatically and report")
    play.add_argument("deck")
    play.add_argument("--games", type=int, default=20)
    play.add_argument("--seed", type=int, help="first seed; game N uses seed+N (default: random)")
    play.add_argument("--turns", type=int, default=8, help="end each game after this many of your turns (0: no limit)")
    play.add_argument("--pilot", help="Python file answering some decision kinds; Forge's AI answers the rest")
    play.add_argument("--opponents", type=int, default=3)
    play.add_argument("--workers", type=int, default=8, help="games played at once")
    play.add_argument("--per-game", action="store_true", help="add a line per game")
    play.add_argument("--cards", action="store_true", help="add how often each card was seen and played")
    play.set_defaults(run=run)

    summary = commands.add_parser("report", help="report on a batch again (default: the last one)")
    summary.add_argument("batch", nargs="?")
    summary.add_argument("--per-game", action="store_true", help="add a line per game")
    summary.add_argument("--cards", action="store_true", help="add how often each card was seen and played")
    summary.set_defaults(run=report_cmd)

    reply = commands.add_parser("a", aliases=["answer"], help="answer with option numbers, 'none', or 'ai' to let Forge's AI decide")
    reply.add_argument("answer", nargs="*")
    reply.set_defaults(run=answer)
    pending = commands.add_parser("decision", help="show the pending decision")
    pending.add_argument("--full", action="store_true", help="also each option's full text")
    pending.set_defaults(run=decision)

    show = commands.add_parser("state", help="your hand, board and mana")
    show.add_argument("--full", action="store_true", help="also graveyard, exile and opponents")
    show.set_defaults(run=state)

    snap = commands.add_parser("snapshot", help="save the game at this play decision")
    snap.add_argument("name", nargs="?")
    snap.set_defaults(run=snapshot)
    back = commands.add_parser("restore", help="go back to a snapshot")
    back.add_argument("name")
    back.set_defaults(run=restore)
    fix = commands.add_parser("override", help="correct the game by hand: move, create, life, counter, tap, untap")
    fix.add_argument("args", nargs="+")
    fix.set_defaults(run=override)
    commands.add_parser("end", help="end the game").set_defaults(run=end)

    history = commands.add_parser("log", help="one line per turn of yours")
    history.add_argument("--turn", type=int, help="every fact of one turn")
    history.add_argument("--decisions", action="store_true", help="add your decisions under each turn")
    history.add_argument("--all", action="store_true", help="include lines abandoned by restoring a snapshot")
    history.set_defaults(run=log)
    seen = commands.add_parser("cards", help="cards seen and played, by name")
    seen.add_argument("--by-turn", action="store_true")
    seen.add_argument("--all", action="store_true", help="include lines abandoned by restoring a snapshot")
    seen.set_defaults(run=cards)

    process = commands.add_parser("engine", help="engine process status or stop")
    process.add_argument("action", choices=("status", "stop"))
    process.set_defaults(run=engine_cmd)

    args = parser.parse_args(argv)
    try:
        return args.run(args)
    except (engine.EngineError, decklist.DecklistError, OSError, ValueError) as error:
        print(f"error: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
