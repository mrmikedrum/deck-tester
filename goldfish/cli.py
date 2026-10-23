"""Command-line entry point. Output is written for agents: short, one fact per line."""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from . import decklist

ROOT = Path(__file__).resolve().parent.parent


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
        ("forge", (ROOT / "vendor" / "forge").is_dir(), "vendor/forge (scripts/bootstrap-forge.sh)"),
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
    print("forge support: not checked (engine arrives in M0)")
    return 1 if problems else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="goldfish", description="Commander goldfishing for agents.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="check the toolchain and Forge build").set_defaults(run=doctor)
    deck = commands.add_parser("deck", help="decklist commands").add_subparsers(dest="deck_command", required=True)
    check = deck.add_parser("check", help="parse a decklist and report construction problems")
    check.add_argument("path")
    check.set_defaults(run=deck_check)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
