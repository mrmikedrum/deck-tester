"""The game server: serves the game client and relays one live Forge table to it over HTTP (long polling).

You sit in seat one, answering every decision from the browser; Jev and the deck advisors pilot the other seats on the
table engine. Card art comes from Scryfall, cached in .deckmaster/cache/cards/ and served from here, so the board's
canvases stay same-origin.

    bin/deckmaster game [--port 8765]     then open http://<this machine>:<port>/live.html
"""
import json
import mimetypes
import re
import socket
import threading
import time
import traceback
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import decklist, engine, model, table

ROOT = Path(__file__).resolve().parent.parent
CLIENT = ROOT / "game" / "client"
DECKS = ROOT / "examples" / "decks"
CACHE = engine.HOME / "cache" / "cards"
UA = {"User-Agent": "deckmaster-game/0.1", "Accept": "application/json"}
ARGS = None

# ---- The table -----------------------------------------------------------------------------------------------------


class Table:
    def __init__(self):
        self.lock = threading.Condition()
        self.version = 0
        self.snapshot = {"state": "no game"}
        self.mine = None
        self.seats = {}
        self.generation = 0
        self.error = None
        self.log = []
        self.pilots = {}
        self.usage = None
        self.outcomes = {}

    def publish(self, snap):
        with self.lock:
            if snap != self.snapshot:
                self.snapshot = snap
                self.version += 1
                self.lock.notify_all()

    def wait(self, since, timeout=20):
        with self.lock:
            if 0 <= self.version < since:  # a client from before a bridge restart: answer at once
                return self.version, self.snapshot
            if self.version <= since:
                self.lock.wait(timeout)
            return self.version, self.snapshot

    def open(self, me, others, seed=None, mana="creatures"):
        # Resolve every real-deck opponent before replacing any existing game. Never silently
        # fall back to stock Forge-AI mode when a deck lacks a configured Jev plan/advisor.
        agents = [configured_seat(path) for path in others]
        model.key()  # check configured Jev access; never expose the key in a response or log
        try:
            engine.request({"cmd": "table_end"})
        except engine.EngineError:
            pass
        self.generation += 1
        gen = self.generation
        self.publish({"state": "starting", "gen": gen})
        seats = []
        self.usage, self.outcomes, self.pilots = model.Usage(), {}, {"You": "human"}
        names = {"You"}
        for i, path in enumerate([me] + others):
            deck = decklist.load(path)
            base_name = short(deck.commanders[0]) if i else "You"
            name = base_name
            suffix = 2
            while i and name in names:
                name = f"{base_name} {suffix}"
                suffix += 1
            names.add(name)
            seat = {"name": name, "commanders": deck.commanders, "main": deck.main, "deck": Path(path).stem,
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
        threading.Thread(target=self.watch, args=(gen,), daemon=True).start()
        return reply

    def jev_seat(self, seat, sid, gen, players):
        try:
            table.play(seat, sid, players, self.usage, self.outcomes)
        except Exception as error:
            if gen == self.generation:
                self.error = f"{seat.name}'s Jev pilot stopped: {error}"
                print(self.error, flush=True)

    def watch(self, gen):
        last_ok = time.time()
        while gen == self.generation:
            try:
                reply = engine.request({"cmd": "view", "session": self.mine})
                snap = {"state": "over" if "over" in reply else "playing", "gen": gen, "view": reply.get("view"),
                        "decision": reply.get("decision"), "over": reply.get("over"), "pilots": self.pilots}
                self.publish(snap)
                last_ok = time.time()
                time.sleep(0.12 if reply.get("decision") else 0.25)
            except Exception as error:  # a read while Forge moves cards can fail: read again
                if time.time() - last_ok > 10:
                    self.error = str(error)
                time.sleep(0.1)

    def answer(self, body):
        pending = self.snapshot.get("decision")
        if not pending:
            return {"ok": False, "error": "nothing to answer"}
        if body.get("key") and body["key"] != key(pending):
            return {"ok": False, "error": "that decision has passed"}
        req = {"cmd": "answer", "session": self.mine}
        if body.get("defer"):
            req.update(defer=True, by="ai")
        else:
            req["answer"] = body.get("answer", [])
        result = {}

        def send():
            try:
                engine.request(req)
                result["ok"] = True
            except Exception as error:
                result["error"] = str(error)
        t = threading.Thread(target=send, daemon=True)
        t.start()
        t.join(0.6)  # a refused answer comes back at once; an accepted one waits for the next decision
        if "error" in result:
            return {"ok": False, "error": result["error"]}
        return {"ok": True}

    def override(self, args):
        try:
            reply = engine.request({"cmd": "override", "session": self.mine, "args": args})
            return {"ok": True, "result": reply.get("result")}
        except Exception as error:
            return {"ok": False, "error": str(error)}


def key(decision):
    return "|".join([decision["kind"], decision["turn"], decision.get("prompt", ""), str(len(decision.get("options", [])))] + decision.get("options", [])[:6])


def short(commander):
    name = commander.split(",")[0].split(" the ")[0]
    return name.split(" ")[0] if len(name) > 10 else name


# The browser currently offers these four real decks. Plans/advisors own deck guidance;
# the same table.play path as CLI Jev tables owns model decisions and ordinary fallbacks.
PILOTS = {
    "eternities-living-worlds-iii.txt": ("living-worlds.txt", "marath_advisor.py"),
    "eternities-assimilation-iii.txt": ("assimilation.txt", "atraxa_advisor.py"),
    "blue-moon-combat-revision.txt": ("blue-moon.txt", "blue_moon_advisor.py"),
    "dack-cedh.txt": ("dack-cedh.txt", "dack_advisor.py"),
}


def configured_seat(path):
    path = Path(path)
    if path.name not in PILOTS:
        raise ValueError(f"No Jev plan/advisor configured for {path.name}; stock AI mode is disabled")
    plan, advisor = PILOTS[path.name]
    root = ROOT / "examples"
    return table.Seat("pending", str(path), str(root / "plans" / plan), str(root / "pilots" / advisor))


TABLE = Table()

# ---- Card art and data from Scryfall -------------------------------------------------------------------------------

CARDS_FILE = CACHE / "cards.json"
CARD_LOCK = threading.Lock()
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


def fetch_image(url, path):
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(get(url, raw=True))


def entry(name, c):
    faces = c.get("card_faces") if "card_faces" in c and "image_uris" not in c else None
    base = name[:-6] if name.endswith(" Token") else name
    face = next((f for f in (c.get("card_faces") or []) if f["name"] == base), None) or c
    uris = (face.get("image_uris") if faces else None) or c.get("image_uris") or {}
    s = slug(name)
    art = img = None
    if uris:
        try:
            fetch_image(uris["art_crop"], CACHE / "art" / (s + ".jpg"))
            fetch_image(uris["normal"], CACHE / "card" / (s + ".jpg"))
            art, img = "cache/art/" + s + ".jpg", "cache/card/" + s + ".jpg"
        except Exception:
            pass
    return {"name": name, "faces": [{
        "name": name, "cost": face.get("mana_cost", ""), "type": face.get("type_line", c.get("type_line", "")),
        "text": face.get("oracle_text", c.get("oracle_text", "")), "power": face.get("power"),
        "toughness": face.get("toughness"), "loyalty": face.get("loyalty"), "colors": face.get("colors", c.get("colors", [])),
        "art": art, "img": img, "keywords": c.get("keywords", [])}],
        "produces": c.get("produced_mana", []), "identity": c.get("color_identity", []), "layout": c.get("layout", "normal")}


def cards(names):
    with CARD_LOCK:
        missing = [n for n in names if n and n not in CARDS]
        if missing:
            try:
                found = scryfall(missing)
            except Exception:
                traceback.print_exc()
                found = {}
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(8) as pool:  # images download side by side
                made = dict(zip(missing, pool.map(lambda n: entry(n, found[n]) if n in found else None, missing)))
            for n in missing:
                CARDS[n] = made[n] if made[n] else {"name": n, "faces": [{"name": n, "art": None, "img": None, "keywords": []}], "produces": [], "identity": [], "layout": "normal"}
            CACHE.mkdir(parents=True, exist_ok=True)
            CARDS_FILE.write_text(json.dumps(CARDS))
        return {n: CARDS[n] for n in names if n in CARDS}


# ---- HTTP ----------------------------------------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store" if ctype == "application/json" or ctype.startswith("text/") or "javascript" in ctype else "max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path == "/api/view":
            v, snap = TABLE.wait(int(q.get("v", ["0"])[0]))
            return self.send(200, dict(snap, v=v, error=TABLE.error))
        if url.path == "/api/diagnostics":
            return self.send(200, {"pilots": TABLE.pilots,
                                   "usage": TABLE.usage.summary() if TABLE.usage else None,
                                   "outcomes": TABLE.outcomes, "error": TABLE.error})
        if url.path == "/api/cards":
            names = [n for n in q.get("n", []) if n]
            return self.send(200, cards(names))
        if url.path == "/api/decks":
            return self.send(200, sorted(p.name for p in DECKS.glob("*.txt")))
        path = url.path.lstrip("/") or "live.html"
        root, rel = (CACHE, path[len("cache/"):]) if path.startswith("cache/") else (CLIENT, path)
        f = (root / rel).resolve()
        if not str(f).startswith(str(root.resolve())) or not f.is_file():
            return self.send(404, {"error": "not found"})
        return self.send(200, f.read_bytes(), mimetypes.guess_type(str(f))[0] or "application/octet-stream")

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        try:
            b = self.body()
            if url.path == "/api/answer":
                return self.send(200, TABLE.answer(b))
            if url.path == "/api/override":
                return self.send(200, TABLE.override(b["args"]))
            if url.path == "/api/new":
                me = str(DECKS / b.get("deck", ARGS.deck))
                others = [str(DECKS / d) for d in b.get("opponents", ARGS.opponents.split(","))]
                threading.Thread(target=lambda: safe_open(me, others, b.get("seed"), b.get("mana", "creatures")), daemon=True).start()
                return self.send(200, {"ok": True})
        except Exception as error:
            traceback.print_exc()
            return self.send(500, {"ok": False, "error": str(error)})
        return self.send(404, {"error": "not found"})


def safe_open(me, others, seed, mana):
    try:
        TABLE.error = None
        TABLE.open(me, others, seed, mana)
    except Exception as error:
        traceback.print_exc()
        TABLE.error = str(error)
        TABLE.publish({"state": "error", "error": str(error)})


def fixture_faces():
    """The card faces the client's offline boards use (data.js), with the cache files their images are read from."""
    line = next(l for l in (CLIENT / "data.js").read_text().splitlines() if l.startswith("window.CARDS = "))
    cards = json.loads(line[len("window.CARDS = "):].rstrip(";"))
    return [f for c in cards.values() for f in c["faces"] if f.get("img")]


def fill_cache():
    """Fetch the client's fixture card images into the cache: Scryfall's images aren't in git, so a fresh checkout
    has none. Each goes to the file data.js names, fetched by the face's name."""
    missing = [f for f in fixture_faces() if not (CACHE / f["img"][len("cache/"):]).exists()]
    found = scryfall(sorted({f["name"] for f in missing})) if missing else {}
    lost = []
    for f in missing:
        c = found.get(f["name"])
        face = next((x for x in (c or {}).get("card_faces", []) if x["name"] == f["name"] and "image_uris" in x), c or {})
        uris = face.get("image_uris") or (c or {}).get("image_uris")
        if not uris:
            lost.append(f["name"])
            continue
        fetch_image(uris["normal"], CACHE / f["img"][len("cache/"):])
        fetch_image(uris["art_crop"], CACHE / f["art"][len("cache/"):])
    print(f"{len(missing) - len(lost)} fixture card images fetched into {CACHE}" + (f"; not found: {', '.join(lost)}" if lost else ""))
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
        threading.Thread(target=lambda: safe_open(str(DECKS / args.deck), [str(DECKS / o) for o in args.opponents.split(",")], args.seed, "creatures"), daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    server.daemon_threads = True
    print(f"Deckmaster game: http://{lan_address()}:{args.port}/live.html  (the first game takes about a minute to start)", flush=True)
    server.serve_forever()
