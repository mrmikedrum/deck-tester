"""The game server: serves the game client and relays one live Forge table to it over HTTP (long polling).

You sit in seat one, answering every decision from the browser; Jev and the deck advisors pilot the other seats on the
table engine. Card art comes from Scryfall, cached in .deckmaster/cache/cards/ and served from here, so the board's
canvases stay same-origin.

    bin/deckmaster game [--port 8765]     then open http://<this machine>:<port>/live.html

The rebuilt client (game/client/src, TypeScript) is served from its build at /next/, rebuilt on start when stale. The
protocol both clients read is in docs/architecture.md ("The game's protocol").
"""
import collections
import hashlib
import json
import mimetypes
import os
import queue
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import decks, engine, model, table

ROOT = Path(__file__).resolve().parent.parent
GAME = ROOT / "game"
CLIENT = GAME / "client"
DIST = CLIENT / "dist"   # the new client's build, served at /next/
CACHE = engine.HOME / "cache" / "cards"
CLIENTLOG = engine.HOME / "clientlog.jsonl"
BENCH = engine.HOME / "bench"   # the workbench's timing results (game/client/src/scene/workbench/bench.ts)
UA = {"User-Agent": "deckmaster-game/0.1", "Accept": "application/json"}
ARGS = None

# ---- The table -----------------------------------------------------------------------------------------------------


class Table:
    def __init__(self):
        self.lock = threading.Condition()
        self.start_lock = threading.Lock()
        self.version = 0
        self.snapshot = {"state": "no game", "answer": None}
        self.status = None   # the last forwarded answer: {key, id, attempt, state: working|applied|refused, error?}
        self.answers = 0     # numbers each forwarded answer (its `attempt`), so a late reply never overwrites a newer
                             # status; a new game bumps it too, so an attempt never repeats while the bridge runs
        self.mine = None     # my seat's engine session in the newest game (opened before its first view arrives)
        self.session = None  # the engine session whose view the snapshot shows: where its decision is answered
        self.seats = {}
        self.generation = 0
        self.error = None
        self.log = []
        self.pilots = {}
        self.usage = None
        self.outcomes = {}

    def show(self, snap, gen, session):
        """A view `session` sent for game `gen`, unless a newer game has begun since it was asked for. Whether shown."""
        with self.lock:
            if gen != self.generation:
                return False
            self.session = session
            self._store(dict(snap, answer=self.status))
            return True

    def begin(self):
        """A new game: its gen, published as starting; whatever the last game's answer and watcher do now is ignored."""
        with self.lock:
            self.generation += 1
            self.answers += 1
            self.status = None
            self.session = None
            self.error = None
            self._store({"state": "starting", "gen": self.generation, "answer": None})
            return self.generation

    def fail_start(self, gen, error):
        with self.lock:
            if gen == self.generation and self.snapshot["state"] == "starting":
                self.error = str(error)
                self.session = None
                self._store({"state": "error", "gen": gen, "error": self.error, "answer": None})

    def _store(self, snap):
        """Hold the lock. A changed snapshot is a new version, and wakes the long polls."""
        if snap != self.snapshot:
            self.snapshot = snap
            self.version += 1
            self.lock.notify_all()

    def _answered(self, serial, status):
        """The answer status, unless a newer answer or a new game has replaced the answer it is about."""
        with self.lock:
            if serial == self.answers:
                self.status = status
                self._store(dict(self.snapshot, answer=status))

    def wait(self, since, timeout=20):
        with self.lock:
            if 0 <= self.version < since:  # a client from before a bridge restart: answer at once
                return self.version, self.snapshot
            if self.version <= since:
                self.lock.wait(timeout)
            return self.version, self.snapshot

    def open(self, gen, me, others, seed=None, mana="creatures"):
        # Resolve every real-deck opponent before replacing any existing game. Never silently
        # fall back to stock Forge-AI mode when a deck lacks a configured Jev plan/advisor.
        mine = decks.get(me[:-4] if me.endswith(".txt") else me)
        agents = [configured_seat(slug) for slug in others]
        model.key()  # check configured Jev access; never expose the key in a response or log
        try:
            engine.request({"cmd": "table_end"}, start=False)
        except engine.EngineError:
            pass
        seats = []
        self.usage, self.outcomes, self.pilots = model.Usage(), {}, {"You": "human"}
        names = {"You"}
        for i, deck in enumerate([mine.list] + [agent.deck for agent in agents]):
            base_name = short(deck.commanders[0]) if i else "You"
            name = base_name
            suffix = 2
            while i and name in names:
                name = f"{base_name} {suffix}"
                suffix += 1
            names.add(name)
            seat = {"name": name, "commanders": deck.commanders, "main": deck.main,
                    "deck": mine.slug if i == 0 else agents[i - 1].slug,
                    "hash": deck.revision(), "mana": mana if i == 0 else "auto"}
            if seed is not None:
                seat["seed"] = seed + i
            if i:
                agent = agents[i - 1]
                agent.name = name
                seat.update(agent.request())
                self.pilots[name] = "jev + advisor"
            else:
                seat["watch"] = True  # stop on what the others put on the stack, so you see it
            seats.append(seat)
        # Forge's lobby can hold the last table's port for a while after it ends: each table takes the next one.
        reply = engine.request({"cmd": "table", "seats": seats, "people": 0, "port": ARGS.table_port + gen % 20})
        self.seats = reply["seats"]
        self.mine = self.seats["You"]
        for agent in agents:
            sid = self.seats[agent.name]
            threading.Thread(target=self.jev_seat, args=(agent, sid, gen, len(seats)), daemon=True).start()
        threading.Thread(target=self.watch, args=(gen, self.mine), daemon=True).start()
        return reply

    def jev_seat(self, seat, sid, gen, players):
        try:
            table.play(seat, sid, players, self.usage, self.outcomes)
        except Exception as error:
            if gen == self.generation:
                self.error = f"{seat.name}'s Jev pilot stopped: {error}"
                print(self.error, flush=True)

    def watch(self, gen, session):
        """Game `gen`'s watcher: polls its own seat's view until a newer game begins. A view that comes back after that
        is dropped (`show` checks the gen under the lock), so it never overwrites the newer game's snapshot."""
        last_ok = time.time()
        while gen == self.generation:
            try:
                reply = engine.request({"cmd": "view", "session": session}, start=False)
                if self.snapshot["state"] == "starting":
                    if (reply.get("over") or "").startswith("error:"):
                        self.fail_start(gen, reply["over"])
                        return
                    if not (reply.get("view") or reply.get("decision") or reply.get("over")):
                        if time.time() - last_ok > 60:
                            self.fail_start(gen, "engine did not send an opening view")
                            return
                        time.sleep(0.25)
                        continue
                if not self.show(snapshot(reply, gen, self.pilots), gen, session):
                    return
                last_ok = time.time()
                time.sleep(0.12 if reply.get("decision") else 0.25)
            except Exception as error:  # a read while Forge moves cards can fail: read again
                if time.time() - last_ok > 10:
                    with self.lock:
                        if gen != self.generation:
                            return
                        if self.snapshot["state"] == "starting":
                            self.fail_start(gen, error)
                            return
                        self.error = str(error)
                time.sleep(0.1)

    def answer(self, body):
        """Forward an answer to the pending decision. The reply is the engine's refusal if it comes at once, else
        {ok: true} after 0.6 s (the old client reads only this), with the answer's `attempt` once it is forwarded; the snapshot's `answer` status follows it to the end:
        working while the engine plays on to the next decision, then applied or refused. The decision is named by the
        engine's `id` when it has one (the new client sends it; the old client's key is checked, then the pending
        decision's id goes to the engine), so the engine answers only that decision, never the one after it. Ids restart
        with each engine session, so the new client also names the game (`gen`): an answer meant for the last game is
        refused even when the next game asks the same question under the same id. The session is the one whose view
        showed the decision, taken under the same lock as the checks."""
        with self.lock:
            pending, session = self.snapshot.get("decision"), self.session
            if not pending or session is None:
                return {"ok": False, "error": "nothing to answer"}
            k, did = key(pending), pending.get("id")
            if (body.get("key") and body["key"] != k or "id" in body and body["id"] != did
                    or "gen" in body and body["gen"] != self.snapshot.get("gen")):
                return {"ok": False, "error": "that decision has passed"}
            if self.status and self.status["state"] == "working" and same(self.status, k, did):
                return {"ok": False, "error": "an answer is already being worked on"}
            self.answers += 1
            serial = self.answers
            self.status = {"key": k, "id": did, "attempt": serial, "state": "working"}
            self._store(dict(self.snapshot, answer=self.status))
        req = {"cmd": "answer", "session": session}
        if did is not None:
            req["id"] = did
        if body.get("defer"):
            req.update(defer=True, by="ai")
        else:
            req["answer"] = body.get("answer", [])
        result = {}

        def send():
            try:
                engine.request(req)
                result["ok"] = True
                self._answered(serial, {"key": k, "id": did, "attempt": serial, "state": "applied"})
            except Exception as error:
                result["error"] = str(error)
                self._answered(serial, {"key": k, "id": did, "attempt": serial, "state": "refused",
                                        "error": str(error)})
        t = threading.Thread(target=send, daemon=True)
        t.start()
        t.join(0.6)  # a refused answer comes back at once; an accepted one waits for the next decision
        if "error" in result:
            return {"ok": False, "error": result["error"], "attempt": serial}
        return {"ok": True, "attempt": serial}

    def override(self, args):
        try:
            reply = engine.request({"cmd": "override", "session": self.mine, "args": args})
            return {"ok": True, "result": reply.get("result")}
        except Exception as error:
            return {"ok": False, "error": str(error)}


def snapshot(reply, gen, pilots):
    """The snapshot the browser polls for, from the engine's `view` reply."""
    return {"state": "over" if "over" in reply else "playing", "gen": gen, "view": reply.get("view"),
            "decision": reply.get("decision"), "over": reply.get("over"), "pilots": pilots}


def envelope(snap, version, error, build=None):
    """What /api/view sends: the snapshot (with its answer status) plus its version, the bridge's last error and the
    client build served at /next/."""
    out = {"answer": None}
    out.update(snap)
    out.update(v=version, error=snap.get("error", error), build=build)
    return out


def key(decision):
    """A decision's identity: the client sends it with each answer, and an answer whose key is not the pending
    decision's is refused. game/client/src/protocol/key.ts computes the same."""
    return "|".join([decision["kind"], decision["turn"], decision.get("prompt", ""), str(len(decision.get("options", [])))] + decision.get("options", [])[:6])


def same(status, k, did):
    """Whether an answer status is about this decision: by the engine's id when there is one, else by key."""
    return status["id"] == did if did is not None else status["key"] == k


def short(commander):
    name = commander.split(",")[0].split(" the ")[0]
    return name.split(" ")[0] if len(name) > 10 else name


def configured_seat(slug):
    """A Jev seat for a deck in the deck database: it must bring its plan and advisor (stock AI mode is disabled)."""
    deck = decks.get(slug[:-4] if slug.endswith(".txt") else slug)   # a client may remember a deck by its old file name
    if not deck.plan or not deck.advisor:
        raise ValueError(f"{deck.slug} has no Jev plan and advisor; stock AI mode is disabled")
    return table.Seat("pending", deck)


TABLE = Table()

# ---- Card art and data from Scryfall -------------------------------------------------------------------------------

CARDS_FILE = CACHE / "cards.json"
PRINT_DIR = "card-large"
LEGACY_PRINT = "cache/card/"
CARD_LOCK = threading.Lock()
CARD_MISS_LOCK = threading.Lock()
SCRYFALL_LOCK = threading.Lock()
PRINT_WORKERS = 3
PRINT_QUEUE = queue.Queue()
PRINT_WORKERS_STARTED = 0
PRINT_COOLDOWN = 60
PRINT_RETRY_AT = {}  # A running job has no finite retry time.
CARDS = {}


def slug(name):
    return re.sub(r"-+", "-", "".join(ch.lower() if ch.isalnum() else "-" for ch in name)).strip("-")


def get(url, raw=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    return data if raw else json.loads(data)


def scryfall(names):
    found = {}
    for i in range(0, len(names), 70):
        body = json.dumps({"identifiers": [{"name": n} for n in names[i:i + 70]]}).encode()
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=body,
                                     headers=dict(UA, **{"Content-Type": "application/json"}), method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.load(r)
        for c in res["data"]:
            found[c["name"]] = c
            for f in c.get("card_faces", []):
                found.setdefault(f["name"], c)
        time.sleep(0.1)
    for n in names:  # tokens and other extras aren't in the collection endpoint
        if n in found:
            continue
        base = n[:-6] if n.endswith(" Token") else n  # Forge names tokens "Treasure Token"
        q = urllib.parse.quote(f'!"{base}" include:extras')
        try:
            res = get(f"https://api.scryfall.com/cards/search?q={q}&unique=prints&order=released&dir=desc")
            tokens = [c for c in res["data"] if "Token" in c.get("type_line", "")] or res["data"]
            found[n] = tokens[0]
        except Exception:
            pass
        time.sleep(0.1)
    return found


def fetch_image(url, path, replace=False):
    if path.exists() and not replace:
        return
    write_cache_file(path, get(url, raw=True))


def write_cache_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as output:
        tmp = Path(output.name)
        try:
            output.write(data)
            output.close()
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)


def large_print_path(img):
    return f"{PRINT_DIR}/" + img[len(LEGACY_PRINT):]


def card_face(name, c):
    faces = c.get("card_faces") if "card_faces" in c and "image_uris" not in c else None
    base = name[:-6] if name.endswith(" Token") else name
    face = next((f for f in (c.get("card_faces") or []) if f["name"] == base), None) or c
    uris = (face.get("image_uris") if faces else None) or c.get("image_uris") or {}
    return face, uris


def entry(name, c):
    face, uris = card_face(name, c)
    s = slug(name)
    art = img = None
    pending = {}
    if uris:
        try:
            fetch_image(uris["art_crop"], CACHE / "art" / (s + ".jpg"))
            art = "cache/art/" + s + ".jpg"
        except Exception:
            pass
        try:
            fetch_image(uris["large"], CACHE / PRINT_DIR / (s + ".jpg"))
            img = f"cache/{PRINT_DIR}/{s}.jpg"
        except Exception:
            if uris.get("large"):
                pending["printPending"] = uris["large"]
            if (CACHE / "card" / (s + ".jpg")).is_file():
                img = LEGACY_PRINT + s + ".jpg"
    return {"name": name, "faces": [{
        "name": name, "cost": face.get("mana_cost", ""), "type": face.get("type_line", c.get("type_line", "")),
        "text": face.get("oracle_text", c.get("oracle_text", "")), "power": face.get("power"),
        "toughness": face.get("toughness"), "loyalty": face.get("loyalty"), "colors": face.get("colors", c.get("colors", [])),
        "art": art, "img": img, "keywords": c.get("keywords", []), **pending}],
        "produces": c.get("produced_mana", []), "identity": c.get("color_identity", []), "layout": c.get("layout", "normal")}


def needs_print(face):
    img = face.get("img") or ""
    return bool(face.get("printPending") or img.startswith(LEGACY_PRINT) or (not img and face.get("art")))


def print_path(face):
    img = face.get("img") or ""
    return large_print_path(img) if img.startswith(LEGACY_PRINT) else f"{PRINT_DIR}/{slug(face['name'])}.jpg"


def lookup_cards(names):
    if not names:
        return {}
    with SCRYFALL_LOCK:  # Preserve spacing between API requests without tying up cached lookups.
        try:
            return scryfall(names)
        except Exception:
            traceback.print_exc()
            time.sleep(0.1)
            return {}


def save_cards():
    """Persist a complete catalog while holding CARD_LOCK."""
    write_cache_file(CARDS_FILE, json.dumps(CARDS).encode())


def upgrade_print(name, card):
    found = {}
    if any(needs_print(f) and not f.get("printPending") and not (CACHE / print_path(f)).is_file()
           for f in card["faces"]):
        found = lookup_cards([name])

    faces = []
    for face in card["faces"]:
        if needs_print(face):
            rel = print_path(face)
            path = CACHE / rel
            try:
                if not path.is_file():
                    _, uris = card_face(face["name"], found.get(name, {}))
                    fetch_image(face.get("printPending") or uris["large"], path)
                face = dict(face, img="cache/" + rel)
                face.pop("printPending", None)
            except Exception:
                pass
        faces.append(face)
    return dict(card, faces=faces)


def print_worker(jobs):
    while True:
        name = jobs.get()
        retry = True
        try:
            with CARD_LOCK:
                original = CARDS[name]
            card = upgrade_print(name, original)
            with CARD_LOCK:
                if card != original:
                    CARDS[name] = card
                    save_cards()
            retry = any(needs_print(f) for f in card["faces"])
        except BaseException:
            # A failed job must leave this fixed worker available for the next one.
            traceback.print_exc()
        finally:
            with CARD_LOCK:
                if retry:
                    PRINT_RETRY_AT[name] = time.monotonic() + PRINT_COOLDOWN
                else:
                    PRINT_RETRY_AT.pop(name, None)
            jobs.task_done()


def queue_prints(names):
    """Claim upgrades and start the fixed daemon workers with CARD_LOCK held."""
    global PRINT_WORKERS_STARTED
    if not names:
        return
    while PRINT_WORKERS_STARTED < PRINT_WORKERS:
        try:
            threading.Thread(target=print_worker, args=(PRINT_QUEUE,), daemon=True).start()
        except RuntimeError:
            traceback.print_exc()
            break
        PRINT_WORKERS_STARTED += 1
    if PRINT_WORKERS_STARTED:
        for name in names:
            PRINT_QUEUE.put_nowait(name)
            PRINT_RETRY_AT[name] = float("inf")


def cards(names):
    names = list(dict.fromkeys(n for n in names if n))
    with CARD_LOCK:
        missing = [n for n in names if n not in CARDS]
        now = time.monotonic()
        queue_prints([n for n in names if n in CARDS
                      and PRINT_RETRY_AT.get(n, 0) <= now
                      and any(needs_print(f) for f in CARDS[n]["faces"])])
        cached = {n: CARDS[n] for n in names if n in CARDS}
    if not missing:
        return cached

    with CARD_MISS_LOCK:
        with CARD_LOCK:
            missing = [n for n in missing if n not in CARDS]
        found = lookup_cards(missing)
        with ThreadPoolExecutor(8) as pool:
            made = list(pool.map(lambda n: entry(n, found[n]) if n in found else None, missing))
        with CARD_LOCK:
            for n, card in zip(missing, made):
                CARDS[n] = card or {"name": n, "faces": [{"name": n, "art": None, "img": None, "keywords": []}], "produces": [], "identity": [], "layout": "normal"}
                if card and any(needs_print(f) for f in card["faces"]):
                    PRINT_RETRY_AT[n] = time.monotonic() + PRINT_COOLDOWN
            if missing:
                save_cards()
            return {n: CARDS[n] for n in names}


# ---- The new client: its build, its log ----------------------------------------------------------------------------

# Relative to game/, with `node --version`: what a build depends on. The same list as vite.config.mts's BUILD_INPUTS,
# the workbench's bundled inputs (its import.meta.glob of the protocol corpus, a test catalog and the design pass's boards)
# included.
STAMP_INPUTS = ("client/src", "client/index.html", "client/workbench.html", "client/public", "package-lock.json",
                "vite.config.mts", "../tests/fixtures/protocol", "client/test/model/catalog.json",
                "../tests/fixtures/boards")


def client_stamp(node_version):
    """The build's stamp: a hash of the client's sources, the lockfile, the Vite config, the workbench's fixtures and
    the Node version."""
    files = []
    for rel in STAMP_INPUTS:
        p = GAME / rel
        if p.is_dir():
            files += [f for f in p.rglob("*") if f.is_file()
                      and not any(part.startswith(".") for part in f.relative_to(p).parts)]
        elif p.is_file():
            files.append(p)

    def name(f):   # as vite.config.mts names it: relative to game/, "../" for the corpus
        return os.path.relpath(f, GAME).replace(os.sep, "/")
    h = hashlib.sha256(node_version.strip().encode() + b"\0")
    for f in sorted(files, key=name):
        data = f.read_bytes()
        h.update(f"{name(f)}\0{len(data)}\0".encode() + data)
    return h.hexdigest()


def ensure_client(run=subprocess.run, which=shutil.which, say=lambda line: print(line, flush=True)):
    """Build the new client into game/client/dist when its stamp is stale: into a staging directory, published only
    when the build succeeds. Without Node, or when the build fails, what is there is served. Returns what happened:
    "current", "built", "no node" or "failed"."""
    node, npm = which("node"), which("npm")
    if not node or not npm:
        say("The new client (/next/) can't be rebuilt: Node isn't installed. " +
            ("Serving its last build." if (DIST / "index.html").exists() else "It has no build to serve."))
        return "no node"
    version = run([node, "--version"], capture_output=True, text=True).stdout
    stamp = client_stamp(version)
    old = DIST / ".stamp"
    if (DIST / "index.html").exists() and old.exists() and old.read_text().strip() == stamp:
        return "current"
    staging, retired = DIST.with_name("dist.staging"), DIST.with_name("dist.old")
    shutil.rmtree(staging, ignore_errors=True)
    say("Building the new client for /next/ ...")
    built = run([npm, "run", "build", "--", "--outDir", str(staging)], cwd=str(GAME), capture_output=True, text=True)
    if built.returncode != 0 or not (staging / "index.html").is_file():
        shutil.rmtree(staging, ignore_errors=True)
        tail = "\n".join((built.stdout + built.stderr).strip().splitlines()[-15:])
        say(f"The new client's build failed (is `npm ci` done in game/?); /next/ serves "
            f"{'its last build' if (DIST / 'index.html').exists() else 'nothing'}.\n{tail}")
        return "failed"
    (staging / ".stamp").write_text(stamp + "\n")
    shutil.rmtree(retired, ignore_errors=True)
    if DIST.exists():
        DIST.rename(retired)
    staging.rename(DIST)
    shutil.rmtree(retired, ignore_errors=True)
    say("The new client is built.")
    return "built"


_BUILD = {"mtime": None, "build": None}


def client_build():
    """The build id of the client served at /next/ (dist/build.json, written by the Vite build), or None."""
    f = DIST / "build.json"
    try:
        mtime = f.stat().st_mtime_ns
    except OSError:
        return None
    if mtime != _BUILD["mtime"]:
        try:
            build = json.loads(f.read_text()).get("build")
        except (OSError, ValueError, AttributeError):
            build = None
        _BUILD.update(mtime=mtime, build=build if isinstance(build, str) else None)
    return _BUILD["build"]


class ClientLog:
    """POST /api/clientlog: the client's structured reports, appended to a JSON-lines file that rotates at 1 MB
    (one old file kept). At most 50 entries a request and 50 a minute overall; messages at most 2 KB."""
    LEVELS = ("debug", "info", "warn", "error")
    FIELDS = {"level", "code", "build", "rev", "stop", "message"}
    MESSAGE_BYTES, CODE_LENGTH, BUILD_LENGTH, PER_REQUEST, PER_MINUTE = 2048, 64, 64, 50, 50
    CODE = re.compile(r"^[A-Za-z0-9._-]+$")

    def __init__(self, path, limit=1 << 20, clock=time.time):
        self.path, self.limit, self.clock = Path(path), limit, clock
        self.lock = threading.Lock()
        self.recent = collections.deque()

    @classmethod
    def entries(cls, body):
        """The entries of a request body, normalised; ValueError naming the first problem."""
        if not isinstance(body, dict) or set(body) != {"entries"} or not isinstance(body["entries"], list):
            raise ValueError("expected {entries: [...]}")
        entries = body["entries"]
        if not entries or len(entries) > cls.PER_REQUEST:
            raise ValueError(f"send 1 to {cls.PER_REQUEST} entries")
        out = []
        for n, e in enumerate(entries):
            where = f"entries[{n}]"
            if not isinstance(e, dict) or not set(e) <= cls.FIELDS or not {"level", "code", "message"} <= set(e):
                raise ValueError(f"{where}: expected {{level, code, message, build?, rev?, stop?}}")
            level, code, message = e["level"], e["code"], e["message"]
            build, rev, stop = e.get("build"), e.get("rev"), e.get("stop")
            if level not in cls.LEVELS:
                raise ValueError(f"{where}.level: one of {', '.join(cls.LEVELS)}")
            if not isinstance(code, str) or not cls.CODE.match(code) or len(code) > cls.CODE_LENGTH:
                raise ValueError(f"{where}.code: up to {cls.CODE_LENGTH} letters, digits, '.', '_' or '-'")
            if not isinstance(message, str) or len(message.encode()) > cls.MESSAGE_BYTES:
                raise ValueError(f"{where}.message: text of at most {cls.MESSAGE_BYTES} bytes")
            if build is not None and (not isinstance(build, str) or len(build) > cls.BUILD_LENGTH):
                raise ValueError(f"{where}.build: null or a short string")
            for name, value in (("rev", rev), ("stop", stop)):
                if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                    raise ValueError(f"{where}.{name}: null or a whole number")
            out.append({"level": level, "code": code, "build": build, "rev": rev, "stop": stop, "message": message})
        return out

    def add(self, body):
        """(HTTP status, reply) for a request body."""
        try:
            entries = self.entries(body)
        except ValueError as error:
            return 400, {"ok": False, "error": str(error)}
        with self.lock:
            now = self.clock()
            while self.recent and self.recent[0] <= now - 60:
                self.recent.popleft()
            room = self.PER_MINUTE - len(self.recent)
            if room <= 0:
                return 429, {"ok": False, "error": f"more than {self.PER_MINUTE} entries a minute; try later"}
            kept = entries[:room]
            self.recent.extend([now] * len(kept))
            lines = "".join(json.dumps(dict(at=round(now, 3), **e)) + "\n" for e in kept).encode()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.exists() and self.path.stat().st_size + len(lines) > self.limit:
                os.replace(self.path, self.path.with_name(self.path.name + ".1"))
            with open(self.path, "ab") as f:
                f.write(lines)
        return 200, {"ok": True, "kept": len(kept), "dropped": len(entries) - len(kept)}


CLIENT_LOG = ClientLog(CLIENTLOG)


class BenchResults:
    """POST /api/bench: a workbench timing run (an iPad on the LAN has no clipboard over plain http), each kept as a
    compact JSON file under .deckmaster/bench/, the newest 20. The server listens on every interface, so the endpoint
    keeps only the bench page's fields, within the request cap, under a name of its own, and answers every request."""
    KEEP = 20
    CAP = 256 * 1024
    ROWS = 64
    # planTable's bench and the render bench (`bench: "render"`, its table and frames per moment) share the endpoint.
    FIELDS = ("bench", "table", "framesPerMoment", "userAgent", "screen", "viewport", "clockResolutionMs", "plansPerInput", "budgetMs", "rows")

    def __init__(self, folder, clock=time.time):
        self.folder, self.clock = Path(folder), clock
        self.lock = threading.Lock()

    def add(self, body):
        """(HTTP status, reply) for a request body: {rows: [...], ...}."""
        rows = body.get("rows") if isinstance(body, dict) else None
        if not isinstance(rows, list) or len(rows) > self.ROWS or not all(isinstance(r, dict) for r in rows):
            return 400, {"ok": False, "error": f"expected the bench page's results: {{rows: [...] (at most {self.ROWS}), ...}}"}
        try:
            text = json.dumps({k: body[k] for k in self.FIELDS if k in body}, separators=(",", ":")) + "\n"
        except (ValueError, RecursionError):
            return 400, {"ok": False, "error": "not a bench run"}
        data = text.encode()
        if len(data) > self.CAP:
            return 413, {"ok": False, "error": "too large"}
        try:
            with self.lock:
                self.folder.mkdir(parents=True, exist_ok=True)
                stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(self.clock()))
                name, n = f"bench-{stamp}.json", 2
                while True:
                    try:
                        with open(self.folder / name, "xb") as f:   # never over another run
                            f.write(data)
                        break
                    except FileExistsError:
                        name, n = f"bench-{stamp}-{n}.json", n + 1
                self.prune()
        except OSError as error:
            return 500, {"ok": False, "error": f"not kept: {error.strerror or error}"}
        return 200, {"ok": True, "file": f".deckmaster/bench/{name}"}

    def prune(self):
        """The runs past the newest KEEP go; one that went meanwhile, or will not go, does not fail the run kept."""
        def age(p):
            try:
                return p.stat().st_mtime
            except OSError:
                return -1
        for old in sorted(self.folder.glob("bench-*.json"), key=age)[:-self.KEEP]:
            try:
                old.unlink()
            except OSError:
                pass


BENCH_RESULTS = BenchResults(BENCH)

# ---- HTTP ----------------------------------------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json", cache=None, headers=()):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache or ("no-store" if ctype == "application/json" or ctype.startswith("text/") or "javascript" in ctype else "max-age=86400"))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def file(self, root, rel, cache=None):
        base = root.resolve()
        f = (base / rel).resolve()
        if base not in f.parents or not f.is_file():
            return self.send(404, {"error": "not found"})
        return self.send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or "application/octet-stream", cache)

    def next_client(self, rel):
        """/next/...: the new client's build. Its hashed assets never change, so they may be cached for good."""
        if not (DIST / "index.html").is_file():
            return self.send(404, b"The new client isn't built: run bin/deckmaster game with Node installed, or "
                                  b"(cd game && npm ci && npm run build).\n", "text/plain; charset=utf-8")
        return self.file(DIST, rel or "index.html",
                         "public, max-age=31536000, immutable" if rel.startswith("assets/") else None)

    def length(self):
        """The request's Content-Length: 0 when absent, ValueError unless it is a whole number of bytes."""
        raw = self.headers.get("Content-Length")
        if raw is None:
            return 0
        raw = raw.strip()
        if not raw.isdigit() or not raw.isascii():
            raise ValueError(f"bad Content-Length {raw!r}")
        return int(raw)

    def body(self, n):
        """Exactly `n` bytes of JSON ({} when empty); ValueError when they are not JSON (or nest past what parses)."""
        data = self.rfile.read(n) if n else b""
        try:
            return json.loads(data or b"{}")
        except RecursionError:
            raise ValueError("nested too deep") from None

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/next":
            return self.send(301, b"", "text/plain", headers=[("Location", "/next/")])
        if url.path.startswith("/next/"):
            rel = url.path[len("/next/"):]
            if not rel.startswith(("api/", "cache/")):   # the new client's relative api/ and cache/ reach the same server
                return self.next_client(rel)
            url = url._replace(path="/" + rel)
        if url.path == "/api/view":
            v, snap = TABLE.wait(int(q.get("v", ["0"])[0]))
            return self.send(200, envelope(snap, v, TABLE.error, client_build()))
        if url.path == "/api/diagnostics":
            return self.send(200, {"pilots": TABLE.pilots,
                                   "usage": TABLE.usage.summary() if TABLE.usage else None,
                                   "outcomes": TABLE.outcomes, "error": TABLE.error})
        if url.path == "/api/cards":
            names = [n for n in q.get("n", []) if n]
            return self.send(200, cards(names))
        if url.path == "/api/decks":
            return self.send(200, [d.slug for d in decks.all_decks()])
        path = url.path.lstrip("/") or "live.html"
        if path.startswith(LEGACY_PRINT):
            large = large_print_path(path)
            if (CACHE / large).is_file():
                return self.file(CACHE, large)
        root, rel = (CACHE, path[len("cache/"):]) if path.startswith("cache/") else (CLIENT, path)
        return self.file(root, rel)

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        if url.path.startswith("/next/api/"):
            url = url._replace(path=url.path[len("/next"):])
        try:
            n = self.length()
        except ValueError as error:
            self.close_connection = True   # the body stays unread: its end is unknown
            return self.send(400, {"ok": False, "error": str(error)})
        if n > 256 * 1024:
            self.close_connection = True   # the body stays unread
            return self.send(413, {"ok": False, "error": "too large"})
        if url.path == "/api/clientlog":
            try:
                body = self.body(n)
            except ValueError:
                return self.send(400, {"ok": False, "error": "not JSON"})
            return self.send(*CLIENT_LOG.add(body))
        if url.path == "/api/bench":
            try:
                body = self.body(n)
            except ValueError:
                return self.send(400, {"ok": False, "error": "not JSON"})
            return self.send(*BENCH_RESULTS.add(body))
        try:
            b = self.body(n)
            if url.path == "/api/answer":
                return self.send(200, TABLE.answer(b))
            if url.path == "/api/override":
                return self.send(200, TABLE.override(b["args"]))
            if url.path == "/api/new":
                me = b.get("deck", ARGS.deck)
                others = b.get("opponents", ARGS.opponents.split(","))
                threading.Thread(target=lambda: safe_open(me, others, b.get("seed"), b.get("mana", "creatures")), daemon=True).start()
                return self.send(200, {"ok": True})
        except Exception as error:
            traceback.print_exc()
            return self.send(500, {"ok": False, "error": str(error)})
        return self.send(404, {"error": "not found"})


def safe_open(me, others, seed, mana):
    gen = TABLE.begin()
    with TABLE.start_lock:
        if gen != TABLE.generation:
            return
        try:
            TABLE.open(gen, me, others, seed, mana)
        except Exception as error:
            traceback.print_exc()
            TABLE.fail_start(gen, error)


def fixture_faces():
    """The card faces the client's offline boards use (data.js), with the cache files their images are read from."""
    line = next(l for l in (CLIENT / "data.js").read_text().splitlines() if l.startswith("window.CARDS = "))
    cards = json.loads(line[len("window.CARDS = "):].rstrip(";"))
    return [f for c in cards.values() for f in c["faces"] if f.get("img")]


# Same name, different tokens in the fixture catalog.
FIXTURE_PRINTINGS = {
    "cache/card/elemental-marath.jpg": "c5ad13b4-bbf5-4c98-868f-4d105eaf8833",
    "cache/card/elemental-waves.jpg": "f0e68ed9-d863-4822-b281-e184f3d62faa",
}


def fill_cache():
    """Fill the fixture cache using exact printings wherever names are ambiguous."""
    paths_by_name = collections.defaultdict(set)
    faces = fixture_faces()
    for face in faces:
        paths_by_name[face["name"]].add(face["img"])
    missing, lost = [], []
    for face in faces:
        name, img = face["name"], face["img"]
        printing = FIXTURE_PRINTINGS.get(img)
        path = CACHE / large_print_path(img)
        art = CACHE / face["art"][len("cache/"):]
        if len(paths_by_name[name]) > 1 and not printing:
            if not ((CACHE / img[len("cache/"):]).is_file() and art.is_file()):
                lost.append(img)
            continue
        stamp = path.with_suffix(".printing")
        # Replace images cached before these tokens were resolved by printing ID.
        replace = bool(printing and (not stamp.is_file() or stamp.read_text() != printing))
        if replace or not path.is_file() or not art.is_file():
            missing.append((face, printing, path, art, stamp, replace))

    names = sorted({face["name"] for face, printing, *_ in missing if not printing})
    found = scryfall(names) if names else {}
    fetched = 0
    for face, printing, path, art, stamp, replace in missing:
        if printing:
            try:
                c = get(f"https://api.scryfall.com/cards/{printing}")
            finally:
                time.sleep(0.1)
        else:
            c = found.get(face["name"], {})
        _, uris = card_face(face["name"], c)
        if "large" not in uris:
            lost.append(face["img"])
            continue
        fetch_image(uris["large"], path, replace=replace)
        fetch_image(uris["art_crop"], art, replace=replace)
        if printing:
            write_cache_file(stamp, printing.encode())
        fetched += 1
    print(f"{fetched} fixture card images fetched into {CACHE}" + (f"; not found: {', '.join(lost)}" if lost else ""))
    return 1 if lost else 0


def load_cards():
    if CARDS_FILE.exists():
        CARDS.update(json.loads(CARDS_FILE.read_text()))
    repairs = CACHE / "art-repairs.json"
    if repairs.exists():
        CARDS.update(json.loads(repairs.read_text()))


def lan_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "localhost"


def serve(args):
    global ARGS
    ARGS = args
    engine.use_table()
    load_cards()
    if args.start:
        threading.Thread(target=lambda: safe_open(args.deck, args.opponents.split(","), args.seed, "creatures"), daemon=True).start()
    threading.Thread(target=ensure_client, daemon=True).start()   # /next/ serves its last build until a new one is done
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    server.daemon_threads = True
    print(f"Deckmaster game: http://{lan_address()}:{args.port}/live.html  (the first game takes about a minute to start)", flush=True)
    print(f"The new client, in progress: http://{lan_address()}:{args.port}/next/", flush=True)
    server.serve_forever()
