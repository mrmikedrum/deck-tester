"""Automated games: a batch of seeded games played in parallel. A pilot file answers first, then the decision
model when the batch has a deck plan (see model.py), and Forge's AI answers whatever is left.

A pilot is a Python file defining functions named after decision kinds (mulligan, play, targets, mode,
number, confirm, order, choose, attack, pay). Each gets the decision as a dict (kind, turn, prompt, options,
details, min, max, repeat) and returns option numbers (a list, or one int), or None to let Forge's AI decide.
Kinds the pilot doesn't define never leave the engine. While casting a spell the pilot chose, its targets,
modes, X and payment come back to the pilot too; a missing function there means Forge's AI decides.

A pilot may also define advise(state, decision, this_turn) -> str or None: a line of guidance for the
decision model about this position (a mana engine it should use, say), which it reads with the plan. The
state is the engine's view with card text, and this_turn the facts recorded so far this turn.
"""

import importlib.util
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, List, Optional

from . import engine, model

KINDS = ("mulligan", "play", "targets", "mode", "number", "confirm", "order", "choose", "attack", "block", "pay")
BATCHES = engine.HOME / "batches"
MAX_DECISIONS = 100  # decisions in one turn before the loop guard hands the rest of it to Forge's AI


def load_pilot(path: str) -> Dict[str, Callable]:
    spec = importlib.util.spec_from_file_location("goldfish_pilot", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handlers = {kind: getattr(module, kind) for kind in KINDS + ("advise",) if callable(getattr(module, kind, None))}
    if not handlers:
        raise ValueError(f"{path} defines none of: {', '.join(KINDS)}, advise")
    return handlers


def _answer(handler: Optional[Callable], decision: dict) -> Optional[List[int]]:
    if handler is None:
        return None
    picked = handler(decision)
    if picked is None:
        return None
    return [picked] if isinstance(picked, int) else list(picked)


def respond(reply: dict, handlers: Dict[str, Callable], decider: Optional[model.Decider], asked: Dict[int, int],
            guarded: dict) -> dict:
    """Answer the waiting decision: the pilot first, then the decision model, then Forge's AI; returns the
    engine's next reply. Counts decisions per turn in asked, and notes in guarded where the loop guard took over."""
    decision = reply["decision"]
    turn = model.turn(decision)
    asked[turn] = asked.get(turn, 0) + 1
    picks = _answer(handlers.get(decision["kind"]), decision)
    send = model.Decider.send
    if asked[turn] > MAX_DECISIONS:
        # A pilot or model can repeat itself forever (an ability it can activate again and again, a search it
        # keeps declining) and hang the batch; Forge's AI finishes the turn, and the report flags the game.
        guarded.setdefault("loop", turn)
        return send(reply, {"defer": True})
    if picks is not None:
        return send(reply, {"answer": picks, "by": "pilot"})
    if decider:
        return decider.step(reply)
    return send(reply, {"defer": True})


def _play(start: dict, handlers: Dict[str, Callable], decider: Optional[model.Decider], avoids: List[str],
          turns: int = 0, guarded: Optional[dict] = None) -> dict:
    """Play one game to the end, or past the given turn; returns the engine's final reply. Notes in guarded the
    turn where the loop guard took over, if it did."""
    guarded = {} if guarded is None else guarded
    reply = engine.request(start)
    session = reply["session"]
    avoids[:] = reply.get("ai_avoids", [])
    asked: Dict[int, int] = {}
    try:
        while reply.get("decision") and not (turns and model.turn(reply["decision"]) > turns):
            reply = respond(reply, handlers, decider, asked, guarded)
    finally:
        end = {"cmd": "end", "session": session}
        if turns and reply.get("decision") and model.turn(reply["decision"]) > turns:
            end["over"] = "turn limit"
        reply = engine.request(end)
    return reply


def run(deck, deck_name: str, games: int, seed: int, turns: int, opponents: int,
        pilot: Optional[str], workers: int, ai: str = "default", guide: Optional[str] = None,
        hybrid: str = "outcomes", fast: bool = False, forks: str = "copy") -> dict:
    """Play a batch and write its manifest; returns the manifest. A guide (the deck plan) brings in the model,
    working with Forge's AI as the hybrid names (see model.Decider)."""
    handlers = load_pilot(pilot) if pilot else {}
    if not guide and "play" not in handlers:
        raise ValueError("Real-deck runs require a Jev --guide or a manual --pilot with play decisions; "
                         "stock Forge AI is only for passive goldfish opponents")
    usage = model.Usage()
    if guide:
        model.key()  # fail before the first game, not in every worker
    asks = (set(handlers) - {"advise"}) | (set(model.KINDS) if guide else set())
    base = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "deck": deck_name,
            "hash": deck.revision(), "opponents": opponents, "ask": sorted(asks),
            "mana": "creatures" if "pay" in handlers else "auto", "ai": ai, "forks": forks}
    # Playing options out runs forks into the next turn, so the engine's limit sits past the batch's and the
    # batch stops each game at its own limit.
    exploring = bool(guide) and hybrid != "plain"
    if turns:
        base["turns"] = turns + 2 if exploring else turns
    engine.refresh()
    engine.request({"cmd": "sessions"})  # start the engine once, before the workers race to
    began = time.time()

    avoids: List[str] = []

    def one(index: int) -> dict:
        decider = model.Decider(guide, opponents, usage, hybrid, fast=fast, advise=handlers.get("advise")) if guide else None
        guarded: dict = {}
        reply = _play(dict(base, seed=seed + index), handlers, decider, avoids, turns if exploring else 0, guarded)
        game = {"session": reply["session"], "seed": seed + index, "records": reply["records"], "over": reply.get("over")}
        if guarded:
            game["loop_guard"] = guarded["loop"]
        return game

    with ThreadPoolExecutor(max_workers=workers) as pool:
        played = list(pool.map(one, range(games)))
    manifest = {"deck": deck_name, "hash": deck.revision(), "commander": " + ".join(deck.commanders),
                "pilot": pilot, "ai": ai, "turns": turns, "seconds": round(time.time() - began, 1), "ai_avoids": avoids,
                "games": played}
    if guide:
        manifest["guide"] = guide
        manifest["hybrid"] = hybrid
        manifest["fast"] = fast
        manifest["model"] = usage.summary()
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
