"""Automated games: a batch of seeded games played in parallel, Forge's AI deciding except where a pilot does.

A pilot is a Python file defining functions named after decision kinds (mulligan, play, targets, mode,
number, confirm, order, choose, attack, pay). Each gets the decision as a dict (kind, turn, prompt, options,
details, min, max, repeat) and returns option numbers (a list, or one int), or None to let Forge's AI decide.
Kinds the pilot doesn't define never leave the engine. While casting a spell the pilot chose, its targets,
modes, X and payment come back to the pilot too; a missing function there means Forge's AI decides.
"""

import importlib.util
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, List, Optional

from . import engine

KINDS = ("mulligan", "play", "targets", "mode", "number", "confirm", "order", "choose", "attack", "pay")
BATCHES = engine.HOME / "batches"


def load_pilot(path: str) -> Dict[str, Callable]:
    spec = importlib.util.spec_from_file_location("goldfish_pilot", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handlers = {kind: getattr(module, kind) for kind in KINDS if callable(getattr(module, kind, None))}
    if not handlers:
        raise ValueError(f"{path} defines none of: {', '.join(KINDS)}")
    return handlers


def _answer(handler: Optional[Callable], decision: dict) -> Optional[List[int]]:
    if handler is None:
        return None
    picked = handler(decision)
    if picked is None:
        return None
    return [picked] if isinstance(picked, int) else list(picked)


def _play(start: dict, handlers: Dict[str, Callable], avoids: List[str]) -> dict:
    """Play one game to the end; returns the engine's final reply."""
    reply = engine.request(start)
    session = reply["session"]
    avoids[:] = reply.get("ai_avoids", [])
    try:
        while reply.get("decision"):
            decision = reply["decision"]
            picks = _answer(handlers.get(decision["kind"]), decision)
            request = {"cmd": "answer", "session": session}
            request.update({"defer": True} if picks is None else {"answer": picks})
            reply = engine.request(request)
    finally:
        reply = engine.request({"cmd": "end", "session": session})
    return reply


def run(deck, deck_name: str, games: int, seed: int, turns: int, opponents: int,
        pilot: Optional[str], workers: int, ai: str = "default") -> dict:
    """Play a batch and write its manifest; returns the manifest."""
    handlers = load_pilot(pilot) if pilot else {}
    base = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "deck": deck_name,
            "hash": deck.revision(), "opponents": opponents, "ask": sorted(handlers),
            "mana": "creatures" if "pay" in handlers else "auto", "ai": ai}
    if turns:
        base["turns"] = turns
    engine.refresh()
    engine.request({"cmd": "sessions"})  # start the engine once, before the workers race to
    began = time.time()

    avoids: List[str] = []

    def one(index: int) -> dict:
        reply = _play(dict(base, seed=seed + index), handlers, avoids)
        return {"session": reply["session"], "seed": seed + index, "records": reply["records"], "over": reply.get("over")}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        played = list(pool.map(one, range(games)))
    manifest = {"deck": deck_name, "hash": deck.revision(), "commander": " + ".join(deck.commanders),
                "pilot": pilot, "ai": ai, "turns": turns, "seconds": round(time.time() - began, 1), "ai_avoids": avoids,
                "games": played}
    BATCHES.mkdir(parents=True, exist_ok=True)
    batch_id = f"b{len(list(BATCHES.glob('b*.json'))) + 1}"
    manifest["id"] = batch_id
    (BATCHES / f"{batch_id}.json").write_text(json.dumps(manifest, indent=1))
    return manifest


def load(batch_id: str) -> dict:
    path = BATCHES / f"{batch_id}.json"
    if not path.exists():
        raise ValueError(f"no batch {batch_id}")
    return json.loads(path.read_text())


def latest() -> Optional[str]:
    batches = sorted(BATCHES.glob("b*.json"), key=lambda p: int(p.stem[1:])) if BATCHES.exists() else []
    return batches[-1].stem if batches else None
