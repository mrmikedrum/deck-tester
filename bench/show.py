"""Summarize captured situations: the board, the options, and where each line leads by next turn."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from goldfish import records, render  # noqa: E402

SITUATIONS = Path(__file__).resolve().parent / "situations"


def brief(line: dict) -> str:
    s = line["state"]
    if s is None:
        return "game ended"
    life = sum(o["life"] for o in s["opponents"])
    board = ", ".join(p["name"] + (f" {p['pt']}" if p.get("pt") else "") for p in s["battlefield"])
    return f"{records.happened(line['facts'])} || mana {s['mana']} · hand {len(s['hand'])} · opp life {life} · board: {board}"


def main() -> int:
    paths = sorted(SITUATIONS.glob("*.json")) if len(sys.argv) < 2 else [SITUATIONS / f"{a}.json" for a in sys.argv[1:]]
    for path in paths:
        x = json.loads(path.read_text())
        d = x["decision"]
        print(f"## {x['id']}  {d['turn']} {d['kind']} {d.get('prompt') or ''}  expected={x.get('expected')}")
        print("   " + " | ".join(render.state(x["state"])))
        for name, line in x["lines"].items():
            print(f"   - {name}: {brief(line)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
