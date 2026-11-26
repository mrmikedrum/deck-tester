"""Capture real engine -> browser protocol envelopes into a corpus, with no credentials.

Opens a four-seat Commander table on the table engine, the browser seat ("You") watched and driven here by a
scripted, seeded policy, the other three seats Forge's AI. Every snapshot is built by the bridge's own code
(`deckmaster.game.snapshot` and `envelope`, the same functions `Table.watch` and `/api/view` use), so what is saved
is what the browser would receive. Overrides set up what random play would not reach (see SCENARIOS).

    python3 -m tests.protocol_capture --out tests/fixtures/protocol

The corpus's README says what it holds. `features` and `shapes` here define its coverage tags and object shapes;
tests/test_protocol_corpus.py checks the live engine against them.
"""
import argparse
import contextlib
import io
import json
import pathlib
import random
import shutil
import socket
import tempfile
import threading
import time

from deckmaster import decklist, engine, game

ROOT = pathlib.Path(__file__).resolve().parent.parent
DECKS = ROOT / "tests" / "fixtures" / "decks"
SEATS = [("You", "marath-tokens"), ("Atraxa", "atraxa-artifacts"), ("Dack", "dack-artifacts"),
         ("Princess", "yue-moon")]
LOG_KEEP = 12          # log entries kept per saved envelope (the engine sends up to 60)
MAX_FILES = 80
STEP_LIMIT = 500       # answers the policy may send in a full capture
TIME_LIMIT = 420       # seconds

# What the engine leaves out when it has nothing to say: keys that may be absent. The corpus adds whatever else it
# sees missing in some object; this list covers keys the corpus might happen to always show.
KNOWN_OPTIONAL = {
    "card": {"faceDown", "cost", "power", "toughness", "sick", "loyalty", "tapped", "token", "commander", "copy",
             "attachedTo", "counters", "keywords", "text"},
    "player": {"poison", "monarch", "lost", "commanderDamage", "hand", "handCount"},
    "stack": {"source", "controller", "targets"},
    "view": {"active", "priority", "combat", "over"},
    "decision": {"details", "refs"},
    "log": {"card"},
    "attacker": {"defender", "blocked"},
    # the combat facts (its ordinal, the damage dealt in it) are newer than the checked-in envelopes
    "combat": {"ordinal", "damage"},
    "ref:play": {"mana"},
}

# ---- Scenarios: overrides that set up what the AI and random play would not reach --------------------------------

LANDS = ["Plains", "Swamp", "Mountain", "Mountain", "Forest", "Island"]
ME_HAND = ["Lightning Bolt", "Raise the Alarm", "Raise the Alarm", "Thorn of the Black Rose", "Rancor", "Fireball",
           "Soul Warden", "Willbender", "Brainstorm", "Boros Charm"]
ME_BOARD = ["Grizzly Bears", "Grizzly Bears", "Jace Beleren", "Soul Warden", "Soul's Attendant"]
GOAL = {"ref:attack-to-card", "combat:defender-card", "card:faceDown", "player:poison", "player:commanderDamage",
        "decision:order", "decision:mode", "stack:target-player", "stack:opponent-targets-me", "combat:blockers",
        "combat:they-attack", "decision:block", "player:monarch", "card:attachedTo", "card:token"}
# Created at the end of the arena turn, so they can act on the next one: planeswalkers to attack and more bears.
WALKERS = {"Atraxa": "Gideon Jura", "Dack": "Chandra Nalaar", "Princess": "Ajani Goldmane"}
FOES = {
    "Atraxa": {"board": ["Serra Angel", "Blighted Agent", "Blighted Agent"] + ["Swamp"] * 3 + ["Mountain"] * 3,
               "hand": ["Lightning Bolt", "Doom Blade"]},
    "Dack": {"board": ["Hill Giant", "Grizzly Bears"] + ["Swamp"] * 3 + ["Mountain"] * 3,
             "hand": ["Lightning Bolt", "Doom Blade"]},
    "Princess": {"board": ["Hill Giant", "Hill Giant", "Glistener Elf", "Blighted Agent"] + ["Swamp"] * 3 + ["Mountain"] * 3,
                 "hand": ["Lightning Bolt", "Doom Blade"]},
}
CAST_FIRST = ["Thorn of the Black Rose", "Raise the Alarm", "Rancor", "Soul Warden", "Boros Charm", "Lightning Bolt",
              "Willbender", "Fireball", "Brainstorm"]


def stage_two_overrides():
    # a planeswalker made by an override enters with no loyalty and would die at once: give it some
    return ([["create", name, "battlefield", foe] for foe, name in WALKERS.items()]
            + [["counter", name, "LOYALTY", "+4"] for name in WALKERS.values()]
            + [["create", "Grizzly Bears"], ["create", "Grizzly Bears"]])


def arena_overrides():
    steps = [["create", name] for name in LANDS * 2]
    steps += [["create", name] for name in ME_BOARD]
    steps += [["counter", "Jace Beleren", "LOYALTY", "+3"], ["life", "300"]]   # a long game to watch, not a short one
    steps += [["counter", "Grizzly Bears", "+1/+1", "+2"], ["counter", "Grizzly Bears#2", "-1/-1", "+1"]]
    steps += [["create", name, "hand"] for name in ME_HAND]
    for foe, what in FOES.items():
        steps += [["create", name, "battlefield", foe] for name in what["board"]]
        steps += [["create", name, "hand", foe] for name in what["hand"]]
    return steps


# ---- Features and shapes: what a corpus is measured by -----------------------------------------------------------

def cards_of(view):
    for p in view.get("players", []):
        for zone in ("hand", "battlefield", "command", "graveyard", "exile"):
            for c in p.get(zone, []):
                yield zone, c


def features(env):
    """Coverage tags for one envelope: which decision kinds, ref shapes and view features it shows."""
    tags = {"state:" + env["state"]}
    if env.get("error"):
        tags.add("error:set")
    d, view = env.get("decision"), env.get("view") or {}
    if env["state"] in ("playing", "over") and not view:
        tags.add("view:empty")
    if env.get("over"):
        tags.add("over:message")
    if d:
        kind = d["kind"]
        tags.add("decision:" + kind)
        tags.add("decision:%s:%s" % (kind, "mine" if d["mine"] else "watching"))
        if d.get("details"):
            tags.add("decision:details:" + kind)
        if d.get("repeat"):
            tags.add("decision:repeat:" + kind)
        if not d["options"]:
            tags.add("decision:no-options")
        if kind == "choose" and "refs" not in d:
            tags.add("decision:choose:labels-only")   # asked by label only: a colour, a type, a yes or no
        for ref in d.get("refs") or []:
            if kind == "play":
                tags.add("ref:play-pass" if not ref else "ref:play-mana" if ref.get("mana") else
                         "ref:play-spell" if ref.get("spell") else "ref:play-ability")
            elif kind == "attack":
                tags.add("ref:attack-to-" + ("card" if isinstance(ref.get("to"), int) else "player"))
            elif kind in ("block", "pay"):
                tags.add("ref:" + kind)
            else:
                tags.add("ref:%s-%s" % (kind, next(iter(sorted(ref)), "empty")))
        if kind == "play" and any(" (commander)" in o for o in d["options"]):
            tags.add("play:cast-commander")
        if kind == "play" and any(o.endswith("(land)") for o in d["options"]):
            tags.add("play:land")
    if not view:
        return tags
    tags.add("phase:" + view["phase"])
    tags.add("players:%d" % len(view["players"]))
    if view["me"] not in [p["name"] for p in view["players"]]:
        tags.add("view:me-eliminated")   # the engine drops a player who lost, the viewer too: players[0] is no longer me
    if view.get("over"):
        tags.add("view:over")
    stack = view.get("stack", [])
    if stack:
        tags.add("stack:nonempty")
    for s in stack:
        tags.add("stack:spell" if s["spell"] else "stack:ability")
        if s.get("controller") not in (None, view["me"]):
            tags.add("stack:opponent-item")
        if "source" not in s:
            tags.add("stack:no-source")
        for t in s.get("targets") or []:
            mine = False
            if isinstance(t, str):
                tags.add("stack:target-player")
                mine = t == view["me"]
            else:
                tags.add("stack:target-card")
                mine = any(c["id"] == t and c["controller"] == view["me"] for _, c in cards_of(view))
            if mine and s.get("controller") not in (None, view["me"]):
                tags.add("stack:opponent-targets-me")
        if not s.get("targets"):
            tags.add("stack:no-targets")
    combat = view.get("combat")
    if combat:
        tags.add("combat:attackers")
        if combat["blockers"]:
            tags.add("combat:blockers")
        for a in combat["attackers"]:
            if "defender" not in a:
                tags.add("combat:defender-absent")
            else:
                tags.add("combat:defender-" + ("card" if isinstance(a["defender"], int) else "player"))
        mine = [a for a in combat["attackers"]
                if any(c["id"] == a["id"] and c["controller"] == view["me"] for _, c in cards_of(view))]
        tags.add("combat:i-attack" if mine else "combat:they-attack")
    else:
        tags.add("combat:absent")
    for i, p in enumerate(view["players"]):
        tags.add("player:hand" if "hand" in p else "player:handCount")
        if p["manaPool"]:
            tags.add("player:mana-pool")
        for key in ("poison", "monarch", "lost", "commanderDamage"):
            if key in p:
                tags.add("player:" + key)
        for zone in ("hand", "battlefield", "command", "graveyard", "exile"):
            if zone in p and not p[zone]:
                tags.add("zone:empty-" + zone)
            elif zone in p:
                tags.add("zone:nonempty-" + zone)
        if not p["library"]:
            tags.add("zone:empty-library")
    for zone, c in cards_of(view):
        for key in ("faceDown", "sick", "loyalty", "tapped", "token", "commander", "copy", "attachedTo", "text"):
            if key in c:
                tags.add("card:" + key)
        for name in c.get("counters", {}):
            tags.add("counter:" + name)
        for k in c.get("keywords", []):
            tags.add("keyword:" + k)
        if zone == "battlefield" and "loyalty" in c:
            tags.add("card:planeswalker-" + ("mine" if c["controller"] == view["me"] else "theirs"))
        if zone == "command":
            tags.add("zone:command-card")
        if "cost" not in c:
            tags.add("card:no-cost")
        if c["controller"] != c["owner"]:
            tags.add("card:controller-differs")
    if view.get("log"):
        tags.add("log:nonempty")
    return tags


def shapes(envelopes):
    """Per object type, the keys every object shows (required) and the keys only some do (optional)."""
    seen = {}

    def add(kind, obj):
        seen.setdefault(kind, []).append(set(obj))
    for e in envelopes:
        add("envelope", e)
        d, view = e.get("decision"), e.get("view") or {}
        if d:
            add("decision", d)
            for ref in d.get("refs") or []:
                add("ref:" + d["kind"], ref)
        if view:
            add("view", view)
            for p in view["players"]:
                add("player", p)
            for _, c in cards_of(view):
                add("card", c)
            for s in view["stack"]:
                add("stack", s)
            for entry in view["log"]:
                add("log", entry)
            if view.get("combat"):
                add("combat", view["combat"])
                for a in view["combat"]["attackers"]:
                    add("attacker", a)
                for b in view["combat"]["blockers"]:
                    add("blocker", b)
    result = {}
    for kind, sets in seen.items():
        union, common = set.union(*sets), set.intersection(*sets)
        optional = (union - common) | (union & KNOWN_OPTIONAL.get(kind, set()))
        result[kind] = {"required": sorted(union - optional), "optional": sorted(optional)}
    return result


def check_shapes(envelopes, expected):
    """Problems where live envelopes' key sets leave the corpus's shapes (an empty list when they match)."""
    problems = []
    for kind, live in shapes(envelopes).items():
        if kind not in expected:
            continue  # a type or ref kind the corpus has no sample of
        allowed = set(expected[kind]["required"]) | set(expected[kind]["optional"])
        union = set(live["required"]) | set(live["optional"])
        if union - allowed:
            problems.append("%s: new keys %s" % (kind, sorted(union - allowed)))
        if set(expected[kind]["required"]) - union:
            problems.append("%s: keys gone %s" % (kind, sorted(set(expected[kind]["required"]) - union)))
        missing = set(expected[kind]["required"]) - set(live["required"])
        if missing - (set(expected[kind]["required"]) - union):
            problems.append("%s: required keys missing in some object %s" % (kind, sorted(missing)))
    return problems


# ---- The table and the policy ---------------------------------------------------------------------------------------

@contextlib.contextmanager
def table_engine():
    """A private table engine (its own home, socket and log) for the duration; restores the engine module after."""
    saved = {k: getattr(engine, k) for k in ("HOME", "FORGE_BUILD", "SOCKET", "LOG", "MODE")}
    with tempfile.TemporaryDirectory(prefix="protocol-capture-") as home:
        try:
            engine.HOME = pathlib.Path(home)
            engine.use_table()   # the private socket first: whatever fails below, the stop reaches only this engine
            try:
                engine.FORGE_BUILD = engine.HOME / "forge-build"
                shutil.copy2(saved["FORGE_BUILD"], engine.FORGE_BUILD)
                yield
            finally:
                engine.stop()
        finally:
            for k, v in saved.items():
                setattr(engine, k, v)


def seat_requests(seed):
    seats = []
    for i, (name, deck) in enumerate(SEATS):
        listed = decklist.load(str(DECKS / (deck + ".txt")))
        seat = {"name": name, "commanders": listed.commanders, "main": listed.main, "seed": seed + i}
        seat.update({"watch": True, "mana": "always"} if i == 0 else {"ask": []})
        seats.append(seat)
    return seats


class Capture:
    """One captured game: `observed` is a list of {env, answer, note} in the order the browser would have seen."""

    def __init__(self, seed=100, steps=STEP_LIMIT, arena_turn=2, finish=True, seconds=TIME_LIMIT, verbose=False,
                 goal=None):
        self.verbose, self.goal = verbose, goal
        self.until = None   # a decision that ends the capture once answered
        self.seed, self.steps, self.arena_turn, self.finish, self.seconds = seed, steps, arena_turn, finish, seconds
        self.rng = random.Random(seed)
        self.observed = []
        self.notes = []
        self.seen = set()
        self.bridge = game.Table()
        self.arena_done = self.stage_two_done = False
        self.tried = {}
        self.done_turns = {}
        self.mana_taps = 0
        self.mulliganed = False
        self.explicit_pay = self.player_targets = 0
        self.stopped = threading.Event()
        self.t0 = time.time()

    # -- the bridge: build the envelope the way the server does
    def observe(self, answer=None, note=None):
        for attempt in range(50):   # a read while Forge moves cards can fail: Table.watch reads again, so do we
            try:
                reply = engine.request({"cmd": "view", "session": self.sid})
                break
            except engine.EngineError:
                if attempt == 49:
                    raise
                time.sleep(0.1)
        self.bridge.show(game.snapshot(reply, self.bridge.generation, self.bridge.pilots), self.bridge.generation,
                         self.sid)
        env = json.loads(json.dumps(game.envelope(self.bridge.snapshot, self.bridge.version, self.bridge.error)))
        self.observed.append({"env": env, "answer": answer, "note": note})
        self.seen |= features(env)
        return reply

    def request(self, **req):
        return engine.request(dict(req, session=self.sid))

    def run(self):
        with table_engine():
            with socket.socket() as s:
                s.bind(("127.0.0.1", 0))
                port = s.getsockname()[1]
            opened = engine.request({"cmd": "table", "people": 0, "port": port, "seats": seat_requests(self.seed)})
            self.sid = opened["seats"]["You"]
            self.bridge.generation = 1
            self.bridge.mine = self.sid
            self.bridge.pilots = {name: "human" if name == "You" else "forge ai" for name, _ in SEATS}
            workers = [threading.Thread(target=self.ai, args=(sid,), daemon=True)
                       for name, sid in opened["seats"].items() if name != "You"]
            try:
                self.bridge.publish({"state": "starting", "gen": 1})  # (kept for symmetry; the bridge's real open does)
                for w in workers:
                    w.start()
                for _ in range(200):   # the game may not exist yet: the engine answers with an empty view
                    if self.observe()["view"].get("players"):
                        break
                    time.sleep(0.05)
                self.play()
            finally:
                self.stopped.set()
                with contextlib.suppress(Exception):
                    engine.request({"cmd": "table_end"})
                for w in workers:
                    w.join(timeout=10)
        return self

    def ai(self, sid):
        while not self.stopped.is_set():
            try:
                r = engine.request({"cmd": "decision", "session": sid})
                if "over" in r:
                    return
                if r.get("decision") and not self.stopped.is_set():
                    engine.request({"cmd": "answer", "session": sid, "defer": True})
            except (engine.EngineError, OSError) as error:
                self.notes.append("ai seat %s: %s" % (sid, error))
                time.sleep(0.5)   # a seat that gave up would stall the table: keep asking until the game is over

    def next(self):
        deadline = time.time() + 90
        while time.time() < deadline:
            r = self.request(cmd="decision")
            if r.get("decision") or "over" in r:
                return r
        raise TimeoutError("no decision in 90 s")

    def play(self):
        r = self.next()
        n = 0
        while True:
            if "over" in r:
                self.observe(note="game over")
                return
            goal = self.goal and self.goal <= self.seen and n > 40
            if n >= self.steps or time.time() - self.t0 > self.seconds or goal:
                self.notes.append("stopped at %d answers%s" % (n, " (goal tags seen)" if goal else ""))
                if self.finish:
                    self.wind_up(r)
                return
            reply = self.observe()
            d = reply.get("decision")
            if d is None:      # the decision passed between the two calls: look again
                r = self.next()
                continue
            fresh = self.scenario(reply)
            if fresh:
                r = fresh
                continue
            picks = self.pick(d, reply["view"])
            if self.verbose:
                print(n, d["kind"], d["turn"], d["prompt"][:50], picks, flush=True)
            body = {"key": game.key(d), "id": d["id"], "answer": picks}   # what the new client sends
            self.observed[-1]["answer"] = body
            if self.until and self.until(d):
                self.request(cmd="answer", id=d["id"], answer=picks)
                self.notes.append("stopped at the decision looked for")
                return
            try:
                r = self.request(cmd="answer", id=d["id"], answer=picks)
            except engine.EngineError as error:
                self.notes.append("refused %s %s: %s" % (d["kind"], picks, error))
                fallback = list(range(1, d["min"] + 1)) if d["options"] else [d["min"]]
                body["refused"] = str(error)
                body["answer"] = fallback
                r = self.request(cmd="answer", id=d["id"], answer=fallback)
            n += 1
            if r.get("decision") is None and "over" not in r:
                r = self.next()

    # -- scenarios
    def override(self, args):
        try:
            return self.request(cmd="override", args=args)
        except engine.EngineError as error:
            self.notes.append("override %s refused: %s" % (args, error))
            return None

    def scenario(self, reply):
        d, view = reply["decision"], reply["view"]
        turn = view["turn"]
        if (self.arena_done and not self.stage_two_done and d["kind"] == "play" and d["mine"] and not view["stack"]
                and view["phase"] == "MAIN2"):
            self.stage_two_done = True
            r = None
            for args in stage_two_overrides():
                r = self.override(args) or r
            return r
        mine_main = (d["kind"] == "play" and d["mine"] and not view["stack"] and view["phase"] == "MAIN1")
        if mine_main and not self.arena_done and turn >= self.arena_turn:
            self.arena_done = True
            r = None
            for args in arena_overrides():
                r = self.override(args) or r
            return r
        return None

    def wind_up(self, r):
        """End the game with life changes: one player loses (the `lost` flag), then the rest, so the game is over."""
        for name in ("Atraxa", "Dack", "Princess"):
            r = self.override(["life", "0", name]) or r
            time.sleep(0.5)
            reply = self.observe(note="after %s's life set to 0" % name)
            if "over" in reply:
                return
            if reply.get("decision") is not None:
                try:
                    r = self.request(cmd="answer", answer=[1])
                except engine.EngineError:
                    pass
        for _ in range(20):
            reply = self.observe(note="wind up")
            if "over" in reply:
                return
            d = reply.get("decision")
            if d:
                self.request(cmd="answer", answer=[1] if d["options"] else [d["min"]])
            time.sleep(0.5)

    # -- the policy: deterministic given the seed (the AI seats are seeded too)
    def pick(self, d, view):
        kind = d["kind"]
        options, refs = d["options"], d.get("refs") or [{}] * len(d["options"])
        rng = self.rng
        if kind == "mulligan":
            if not self.mulliganed:
                self.mulliganed = True
                return [2]
            return [1]
        if kind == "play":
            return [self.play_pick(d, view)]
        if kind == "pay":
            if self.explicit_pay < 2:
                self.explicit_pay += 1
                need = sum(int(t) if t.isdigit() else 1 for t in
                           [x.strip("{}") for x in d["prompt"].split(" for ")[0].replace("}{", " ").split()
                            if x.startswith("{")])
                return list(range(1, min(len(options), max(need, 1)) + 1))
            return []
        if kind == "targets":
            foes = [i for i, r in enumerate(refs) if r.get("player") not in (None, view["me"])]
            if foes and self.player_targets < 2:   # aim at a player at least twice: a spell on the stack with a player target
                self.player_targets += 1
                return [rng.choice(foes) + 1]
            own = any(w in d["prompt"] for w in ("Rancor", "Enchant", "+1/+1 counter", "gets +"))
            ranked = [i for i, o in enumerate(options) if o.endswith("(You)") == own]
            ranked = ranked or list(range(len(options)))
            return [rng.choice(ranked) + 1]
        if kind == "confirm":
            return [2] if d["prompt"].startswith("Cancel") or rng.random() < 0.3 else [1]
        if kind == "order":
            n = len(options)
            return list(range(n, 0, -1)) if rng.random() < 0.5 else list(range(1, n + 1))
        if kind == "mode":
            k = min(d["max"], max(d["min"], 1))
            return sorted(rng.sample(range(1, len(options) + 1), k)) if not d["repeat"] else [1] * k
        if kind == "attack":
            return self.attack_pick(d, view)
        if kind == "block":
            return self.block_pick(d, view)
        if not options:   # number
            return [d["min"] + rng.randint(0, min(d["max"] - d["min"], 3))]
        k = max(d["min"], 1 if d["max"] else 0)
        k = min(k, d["max"], len(options))
        return sorted(rng.sample(range(1, len(options) + 1), k))

    def play_pick(self, d, view):
        options, refs = d["options"], d["refs"]
        if d["mine"] is False or view["stack"]:
            return 1
        turn = d["turn"]
        done = self.done_turns.setdefault(turn, 0)
        if done >= 30:
            return 1
        best, best_score = 1, 0
        for i, (o, ref) in enumerate(zip(options, refs)):
            if i == 0:
                continue
            tries = self.tried.get((turn, o, i), 0)
            if tries >= 2:
                continue
            name = o.split(":")[0].replace(" (land)", "").replace(" (commander)", "")
            alt = 0.5 if o in options[:i] else 0   # an alternative cast of the same card (morph) reads the same
            if ref.get("mana"):
                score = 5 if self.mana_taps < 2 and any(r.get("spell") for r in refs) else 0
            elif ref.get("spell") and o.endswith("(land)"):
                score = 100
            elif ref.get("spell"):
                score = (90 - CAST_FIRST.index(name) if name in CAST_FIRST else 40 + self.rng.random()) + alt
            else:
                score = 8 if tries == 0 else 0
            if score > best_score:
                best, best_score = i + 1, score
        if best > 1:
            o = options[best - 1]
            self.tried[(turn, o, best - 1)] = self.tried.get((turn, o, best - 1), 0) + 1
            self.done_turns[turn] = done + 1
            if refs[best - 1].get("mana"):
                self.mana_taps += 1
        return best

    def attack_pick(self, d, view):
        refs = d["refs"]
        by_card = {}
        for i, ref in enumerate(refs):
            by_card.setdefault(ref["card"], []).append((i + 1, ref["to"]))
        picks = []
        for j, (card, targets) in enumerate(sorted(by_card.items())):
            if j % 3 == 2 and len(by_card) > 2:
                continue   # one in three stays home
            walkers = [i for i, to in targets if isinstance(to, int)]
            picks.append(walkers[0] if walkers else self.rng.choice(targets)[0])
        return sorted(picks)

    def block_pick(self, d, view):
        refs = d["refs"]
        picks, used = [], set()
        for i, ref in enumerate(refs):
            if ref["card"] in used or self.rng.random() < 0.3:
                continue
            used.add(ref["card"])
            picks.append(i + 1)
        return picks


# ---- One decision on its own: a choice Forge asks with labels only ---------------------------------------------------

class LabelOnlyChoice(Capture):
    """Plays a Thriving land on my first main phase: Forge asks its colour through `chooseColor`, a `choose` with
    labels and no refs (Gson leaves the null list out). The capture ends once that choice is answered."""
    LAND = "Thriving Grove"

    def __init__(self, seed=100):
        super().__init__(seed=seed, steps=60, seconds=240, finish=False)
        self.made = False
        self.until = lambda d: d["kind"] == "choose" and "refs" not in d

    def scenario(self, reply):
        d, view = reply["decision"], reply["view"]
        if not self.made and d["kind"] == "play" and d["mine"] and not view["stack"] and view["phase"] == "MAIN1":
            self.made = True
            return self.override(["create", self.LAND, "hand"])
        return None

    def pick(self, d, view):
        if d["kind"] == "play":
            return [next((i + 1 for i, o in enumerate(d["options"]) if o.startswith(self.LAND)), 1)]
        if d["kind"] == "mulligan":
            return [1]
        return super().pick(d, view)


def add(out, observed):
    """Add envelopes to the corpus in `out` as new files after its last, updating its index (tags, coverage, shapes).
    For a sample one capture cannot reach; regenerating the corpus replaces them."""
    out = pathlib.Path(out)
    index = json.loads((out / "index.json").read_text())
    envs = [json.loads((out / name).read_text()) for name in index["files"]]
    seen = set().union(*(features(e) for e in envs))
    number = max(int(name.split("-")[0]) for name in index["files"])
    added = []
    for obs in observed:
        env = trim(obs["env"])
        tags = features(env)
        number += 1
        name = "%03d-%s.json" % (number, describe(env, tags, sorted(tags - seen, key=lambda t: (rank(t), t))))
        if (out / name).exists():
            raise FileExistsError(name)
        (out / name).write_text(json.dumps(env, indent=1, ensure_ascii=False) + "\n")
        index["files"][name] = {"tags": sorted(tags), "answer": obs["answer"], "note": obs["note"]}
        for tag in tags:
            index["coverage"].setdefault(tag, []).append(name)
        seen |= tags
        envs.append(env)
        added.append(name)
    index["coverage"] = dict(sorted(index["coverage"].items()))
    index["shapes"] = shapes(envs)
    (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    return added


# ---- Startup envelopes: the bridge before and between games ---------------------------------------------------------

def startup_envelopes():
    """The states with no engine behind them: no game yet, starting, and a failed start (the bridge's own code)."""
    out = []
    bridge = game.Table()
    out.append(("no game", game.envelope(bridge.snapshot, bridge.version, bridge.error)))
    bridge.publish({"state": "starting", "gen": 1})   # the literal Table.open publishes before it seats anyone
    out.append(("starting", game.envelope(bridge.snapshot, bridge.version, bridge.error)))
    failed, saved = game.Table(), game.TABLE
    try:
        game.TABLE = failed
        with contextlib.redirect_stderr(io.StringIO()):   # safe_open prints the traceback
            game.safe_open("no-such-deck", [], None, "creatures")   # the real failure path of /api/new
    finally:
        game.TABLE = saved
    out.append(("start failed", game.envelope(failed.snapshot, failed.version, failed.error)))
    return [(name, json.loads(json.dumps(env))) for name, env in out]


def with_bridge_error(env):
    """A playing envelope while the bridge holds an error (Table.watch sets one when reads keep failing)."""
    return dict(env, error="engine closed the connection")


# ---- Selection and saving ------------------------------------------------------------------------------------------

PRIORITY = ["state:", "view:empty", "error:", "over:", "player:lost", "decision:", "stack:opponent-targets-me",
            "stack:target-player", "stack:target-card", "combat:defender-card", "combat:blockers", "combat:they-attack",
            "combat:i-attack", "player:monarch", "player:poison", "player:commanderDamage", "player:mana-pool",
            "card:faceDown", "card:attachedTo", "card:planeswalker", "card:token", "counter:", "ref:", "play:",
            "card:", "zone:", "keyword:", "stack:", "combat:", "phase:", "player:", "log:"]


def rank(tag):
    return next((i for i, p in enumerate(PRIORITY) if tag.startswith(p)), len(PRIORITY))


def trim(env):
    env = json.loads(json.dumps(env))
    if env.get("view") and len(env["view"].get("log", [])) > LOG_KEEP:
        env["view"]["log"] = env["view"]["log"][-LOG_KEEP:]
    return env


def select(observed, limit=MAX_FILES):
    """Greedy: keep an envelope when it shows a tag nothing kept before showed, in the order the game saw them."""
    seen, kept = set(), []
    for obs in observed:
        tags = features(obs["env"])
        new = tags - seen
        if not new or len(kept) >= limit:
            continue
        seen |= tags
        kept.append((obs, tags, sorted(new, key=lambda t: (rank(t), t))))
    return kept


def slugify(text):
    return "".join(ch if ch.isalnum() else "-" for ch in text.lower()).strip("-").replace("--", "-")


NAMES = [("decision:choose:labels-only", "labels-only"), ("view:empty", "view-empty"), ("error:set", "error"), ("stack:opponent-targets-me", "opponent-spell-targets-me"),
         ("stack:target-player", "stack-targets-player"), ("stack:target-card", "stack-targets-card"),
         ("combat:defender-card", "attack-on-planeswalker"), ("combat:blockers", "blocked"),
         ("combat:they-attack", "they-attack"), ("combat:i-attack", "i-attack"), ("player:commanderDamage", "commander-damage"),
         ("player:poison", "poison"), ("player:monarch", "monarch"), ("player:mana-pool", "mana-pool"),
         ("card:faceDown", "face-down"), ("card:attachedTo", "attachment"), ("card:planeswalker-theirs", "their-planeswalker"),
         ("card:planeswalker-mine", "my-planeswalker"), ("card:token", "tokens"), ("play:cast-commander", "commander"),
         ("view:me-eliminated", "i-lost"), ("players:3", "three-players"), ("players:2", "two-players"), ("players:1", "one-player"),
         ("stack:nonempty", "stack"), ("zone:empty-hand", "empty-hand"), ("zone:command-card", "commander-zone"),
         ("decision:watching", "watching"), ("view:over", "over"), ("over:message", "over")]


def describe(env, tags, new):
    """A file name stem: the decision kind (or state) and up to two features this envelope is kept for."""
    if env.get("decision"):
        base = env["decision"]["kind"]
        tags = tags | {"decision:watching"} if not env["decision"]["mine"] else tags
        new = set(new) | ({"decision:watching"} if not env["decision"]["mine"] else set())
    else:
        base = env["state"].replace(" ", "-")
    words = [w for t, w in NAMES if t in new][:2] or [w for t, w in NAMES if t in tags][:1]
    return "-".join([base] + [w for w in words if w != base])


def save(out, capture, extras):
    """Write the corpus: one JSON file per kept envelope plus index.json. `extras` are (name, env) startup envelopes.
    The new corpus is written to a staging directory first; only then are the files the last index listed (and the
    index) replaced. Anything else in `out` stays, and a new file never overwrites one the last index did not list."""
    out = pathlib.Path(out)
    out.mkdir(parents=True, exist_ok=True)
    staging = pathlib.Path(tempfile.mkdtemp(prefix="." + out.name + ".staging-", dir=str(out.parent)))
    try:
        index = write_corpus(staging, capture, extras)
        listed = set(json.loads((out / "index.json").read_text())["files"]) if (out / "index.json").exists() else set()
        listed = {name for name in listed if name == pathlib.Path(name).name}   # a file in out, never a path
        clash = sorted(p.name for p in staging.iterdir() if p.name != "index.json" and p.name not in listed
                       and (out / p.name).exists())
        if clash:
            raise FileExistsError("not replacing files the last corpus did not list: " + ", ".join(clash))
        for name in sorted(listed):
            (out / name).unlink(missing_ok=True)
        for f in sorted(staging.iterdir()):
            f.replace(out / f.name)
        return index
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def write_corpus(out, capture, extras):
    files, coverage, envs = {}, {}, []
    sequence = [({"env": env, "answer": None, "note": name}, features(env), [name]) for name, env in extras]
    sequence += select(capture.observed, MAX_FILES - len(extras))
    for number, (obs, tags, new) in enumerate(sequence, 1):
        env = trim(obs["env"])
        name = "%03d-%s.json" % (number, describe(env, tags, new) if number > len(extras) else slugify(obs["note"]))
        (out / name).write_text(json.dumps(env, indent=1, ensure_ascii=False) + "\n")
        files[name] = {"tags": sorted(tags), "answer": obs["answer"], "note": obs["note"]}
        for tag in tags:
            coverage.setdefault(tag, []).append(name)
        envs.append(env)
    index = {"about": "Real engine to browser envelopes (what GET /api/view returns), each with the POST /api/answer "
                      "body the policy sent for it. See README.md.",
             "seed": capture.seed, "seats": [name for name, _ in SEATS], "decks": [d for _, d in SEATS],
             "logKept": LOG_KEEP, "shapes": shapes(envs), "coverage": dict(sorted(coverage.items())),
             "files": files}
    (out / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False) + "\n")
    return index


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=str(ROOT / "tests" / "fixtures" / "protocol"))
    ap.add_argument("--seed", type=int, default=100)
    ap.add_argument("--steps", type=int, default=STEP_LIMIT)
    ap.add_argument("--games", type=int, default=1, help="games to play before the short ending game")
    ap.add_argument("--from-dump", nargs="+", help="build the corpus from these --dump files instead of playing")
    ap.add_argument("--dump", help="also write every observed envelope here (a JSON list), for debugging")
    ap.add_argument("--add-label-only-choice", action="store_true",
                    help="only add a `choose` without refs (a Thriving land's colour) to the corpus in --out")
    args = ap.parse_args(argv)
    if args.add_label_only_choice:
        found = LabelOnlyChoice(seed=args.seed).run()
        wanted = [o for o in found.observed if o["answer"] and found.until(o["env"]["decision"])]
        if not wanted:
            raise SystemExit("no label-only choice was asked: " + "; ".join(found.notes))
        print("added", ", ".join(add(args.out, wanted[-1:])))
        return
    capture = Capture(seed=args.seed)
    if args.from_dump:   # rebuild from earlier runs' dumps instead of playing
        for path in args.from_dump:
            capture.observed += json.loads(pathlib.Path(path).read_text())
    else:
        for game_number in range(args.games):
            first = Capture(seed=args.seed + 2 * game_number, steps=args.steps, verbose=True, goal=GOAL, finish=False)
            try:
                first.run()
            except Exception as error:   # keep what was captured: a stalled game still teaches
                first.notes.append("capture ended early: %r" % error)
            capture.observed += first.observed
            capture.notes += first.notes
        # a short game that ends: eliminations (players leave the view one by one) and the game-over envelope
        ending = Capture(seed=args.seed + 1, steps=14, arena_turn=1, verbose=True)
        ending.run()
        capture.observed += ending.observed
        capture.notes += ending.notes
    if args.dump:
        pathlib.Path(args.dump).write_text(json.dumps(capture.observed))
    extras = startup_envelopes()
    playing = next(o["env"] for o in capture.observed if o["env"]["state"] == "playing" and o["env"]["decision"])
    extras.append(("bridge error on a playing envelope", with_bridge_error(playing)))
    index = save(args.out, capture, extras)
    print("%d files; %d tags" % (len(index["files"]), len(index["coverage"])))
    for note in capture.notes:
        print("note:", note)


if __name__ == "__main__":
    main()
