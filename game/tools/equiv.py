"""Compare two recordings of the same clips (node tools/reel.js), to show a change left the client as it was.

    python3 game/tools/equiv.py BEFORE AFTER

Per clip: which frames' telemetry differs (every object's place, size, opacity and texture, from track.json) and by
how much, and the lowest PSNR over every frame and still (needs ffmpeg). Two runs of unchanged code differ by a
fraction of a pixel on a frame or two, and a CSS animation can start a frame apart (PSNR near 27 dB on one frame),
so judge differences against that, and re-record to see whether they move.
"""
import json
import re
import subprocess
import sys
from pathlib import Path


def psnr(a, b):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(a), "-i", str(b), "-lavfi", "psnr", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    m = re.search(r"average:(inf|[\d.]+)", out)
    return float("inf") if not m or m.group(1) == "inf" else float(m.group(1))


def telemetry(a, b):
    """Frames whose objects differ, and the largest numeric difference, ignoring texture ids (random per run)."""
    frames, worst = set(), 0.0

    def walk(x, y, i, key=""):
        nonlocal worst
        if isinstance(x, dict) and isinstance(y, dict):
            for k in set(x) | set(y):
                if k not in x or k not in y:
                    frames.add(i)
                elif k != "tex":
                    walk(x[k], y[k], i, k)
        elif isinstance(x, list) and isinstance(y, list) and len(x) == len(y):
            for u, v in zip(x, y):
                walk(u, v, i, key)
        elif x != y:
            frames.add(i)
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                worst = max(worst, abs(x - y))
            else:
                worst = float("inf")

    fa, fb = a.get("frames", []), b.get("frames", [])
    for i, (x, y) in enumerate(zip(fa, fb)):
        walk(x, y, i)
    if len(fa) != len(fb):
        frames.add(min(len(fa), len(fb)))
        worst = float("inf")
    return sorted(frames), worst


def main():
    before, after = Path(sys.argv[1]), Path(sys.argv[2])
    for clip in sorted(p.name for p in before.iterdir() if p.is_dir()):
        a, b = before / clip, after / clip
        if not (b / "track.json").exists():
            print(f"{clip:10} missing from {after}")
            continue
        frames, worst = telemetry(json.loads((a / "track.json").read_text()), json.loads((b / "track.json").read_text()))
        imgs = sorted(p.relative_to(a) for p in a.rglob("*") if p.suffix in (".jpg", ".png"))
        missing = [i for i in imgs if not (b / i).exists()]
        low = min((psnr(a / i, b / i) for i in imgs if (b / i).exists()), default=float("inf"))
        moved = f"frames {', '.join(map(str, frames[:8]))}{' …' if len(frames) > 8 else ''} by up to {worst:g}" if frames else "identical"
        print(f"{clip:10} telemetry {moved}; {len(imgs)} images, {len(missing)} missing, lowest PSNR {low:.1f} dB")


if __name__ == "__main__":
    main()
