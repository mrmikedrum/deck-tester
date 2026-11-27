"""The game bridge (deckmaster/game.py) without Forge: answers and their status, the build stamp, the client log, and
serving and building the client at /. The engine is stubbed at `engine.request`."""
import http.client
import json
import os
import pathlib
import queue
import re
import socket
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer
from unittest import mock

from deckmaster import engine, game

PLAY = {"kind": "play", "turn": "T3 main1", "prompt": "", "options": ["pass", "Forest (land)"], "details": None,
        "min": 1, "max": 1, "repeat": False, "mine": True, "refs": [{}, {"card": 7, "spell": True}], "id": 41}
CONFIRM = {"kind": "confirm", "turn": "T3 main1", "prompt": "use Soul Warden", "options": ["yes", "no"], "min": 1,
           "max": 1, "repeat": False, "mine": True, "id": 42}
PLAY_AGAIN = dict(PLAY, id=43)   # the same question asked again: the same key, another decision


def status(d, state, attempt=1, **extra):
    return dict({"key": game.key(d), "id": d.get("id"), "attempt": attempt, "state": state}, **extra)


class Engine:
    """engine.request, scripted: each call takes the next behaviour; "block" waits for release(), an Exception raises."""

    def __init__(self, *behaviours):
        self.behaviours = list(behaviours)
        self.calls = []
        self.gates = []

    def request(self, req):
        self.calls.append(req)
        behaviour = self.behaviours.pop(0) if self.behaviours else "ok"
        if behaviour == "block":
            gate = threading.Event()
            self.gates.append(gate)
            gate.wait(5)
        elif isinstance(behaviour, Exception):
            raise behaviour
        return {"ok": True}

    def release(self, n=0):
        while len(self.gates) <= n:
            time.sleep(0.01)
        self.gates[n].set()


def playing(decision, gen=1):
    return {"state": "playing", "gen": gen, "view": {}, "decision": decision, "over": None, "pilots": {}}


def show(t, decision, gen=1, session="s1"):
    """What the game's watcher does with a view the engine sent for `session`, the seat of game `gen`."""
    return t.show(playing(decision, gen), gen, session)


def table(decision=PLAY):
    t = game.Table()
    t.generation = 1
    t.mine = "s1"
    show(t, decision)
    return t


def settle(t, state, timeout=3):
    """Wait for the snapshot's answer status to reach `state`."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = t.snapshot.get("answer")
        if status and status["state"] == state:
            return status
        time.sleep(0.01)
    raise AssertionError(f"answer status never became {state}: {t.snapshot.get('answer')}")


class CardImageTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.cache = pathlib.Path(tmp.name)
        self.now = 100
        patches = mock.patch.multiple(game, CACHE=self.cache, CARDS={}, CARDS_FILE=self.cache / "cards.json", PRINT_RETRY_AT={})
        patches.start()
        self.addCleanup(patches.stop)
        clock = mock.patch.object(game, "time", mock.Mock(wraps=time, monotonic=lambda: self.now))
        clock.start()
        self.addCleanup(clock.stop)

    def test_cached_clients_share_background_upgrade_and_retry_after_cooldown(self):
        normal = "cache/card/forest.jpg"
        large = "cache/card-large/forest.jpg"
        forest = {"faces": [{"name": "Forest", "img": normal, "art": "cache/art/forest.jpg"}]}
        island = {"faces": [{"name": "Island", "img": "cache/card-large/island.jpg"}]}
        game.CARDS.update(Forest=forest, Island=island)
        started, release = threading.Event(), threading.Event()
        found = {"Forest": {"image_uris": {"large": "https://example.test/forest.jpg"}}}

        def outage(names):
            started.set()
            if not release.wait(5):
                raise AssertionError("test never released the upstream request")
            raise TimeoutError("offline")

        with mock.patch.object(game, "scryfall", side_effect=outage) as lookup, \
                mock.patch.object(game, "get", return_value=b"large") as download, \
                mock.patch.object(game.traceback, "print_exc"), \
                Server(self.cache / "dist", None) as server, ThreadPoolExecutor(2) as clients:
            try:
                first = clients.submit(server.get, "/api/cards?n=Forest")
                self.assertTrue(started.wait(2))
                second = clients.submit(server.get, "/api/cards?n=Forest&n=Island")
                for client, expected in [(first, {"Forest": forest}), (second, {"Forest": forest, "Island": island})]:
                    status, _, data = client.result(timeout=2)
                    self.assertEqual((status, json.loads(data)), (200, expected))
                self.assertEqual(lookup.call_count, 1)
            finally:
                release.set()
                game.PRINT_QUEUE.join()

            self.now += game.PRINT_COOLDOWN - 1
            self.assertEqual(game.cards(["Forest"])["Forest"]["faces"][0]["img"], normal)
            self.assertEqual(lookup.call_count, 1)
            self.now += 1
            lookup.side_effect = None
            lookup.return_value = found
            game.cards(["Forest"])
            game.PRINT_QUEUE.join()
            face = game.cards(["Forest"])["Forest"]["faces"][0]
            self.assertEqual((face["img"], face["art"]), (large, "cache/art/forest.jpg"))
            self.assertEqual(lookup.call_count, 2)
            download.assert_called_once_with(found["Forest"]["image_uris"]["large"], raw=True)

    def test_failed_first_print_recovers_from_the_catalog_after_restart(self):
        art_url, print_url = "https://example.test/art.jpg", "https://example.test/print.jpg"
        found = {"Forest": {"type_line": "Basic Land", "image_uris": {"art_crop": art_url, "large": print_url}}}
        with mock.patch.object(game, "scryfall", return_value=found) as lookup, \
                mock.patch.object(game, "get", side_effect=[b"art", TimeoutError(), b"large"]) as download:
            first = game.cards(["Forest"])["Forest"]["faces"][0]
            self.assertEqual((first["type"], first["art"], first["img"]), ("Basic Land", "cache/art/forest.jpg", None))
            self.assertEqual(game.cards(["Forest"])["Forest"]["faces"][0], first)
            self.assertEqual(download.call_count, 2)

            game.CARDS.clear()
            game.PRINT_RETRY_AT.clear()
            game.load_cards()
            self.assertEqual(game.cards(["Forest"])["Forest"]["faces"][0], first)
            game.PRINT_QUEUE.join()
            face = game.cards(["Forest"])["Forest"]["faces"][0]
            self.assertEqual((face["type"], face["art"], face["img"]),
                             ("Basic Land", "cache/art/forest.jpg", "cache/card-large/forest.jpg"))
            self.assertNotIn("printPending", face)
            lookup.assert_called_once_with(["Forest"])
            self.assertEqual(download.call_args, mock.call(print_url, raw=True))

    def test_cold_batch_downloads_cards_in_parallel(self):
        names = ["Forest", "Island"]
        found = {name: {"image_uris": {"art_crop": f"{name}/art", "large": f"{name}/print"}} for name in names}
        started = {name: threading.Event() for name in names}
        release = threading.Event()

        def download(url, raw):
            name, kind = url.split("/")
            if kind == "art":
                started[name].set()
                if not release.wait(5):
                    raise AssertionError("test never released the download")
            return b"image"

        with mock.patch.object(game, "scryfall", return_value=found), \
                mock.patch.object(game, "get", side_effect=download), ThreadPoolExecutor(1) as client:
            request = client.submit(game.cards, names)
            try:
                for event in started.values():
                    self.assertTrue(event.wait(2))
                self.assertFalse(request.done())
            finally:
                release.set()
            cards = request.result(timeout=2)
        for name in names:
            self.assertEqual(cards[name]["faces"][0]["img"], f"cache/card-large/{name.lower()}.jpg")

    def test_pending_downloads_share_a_fixed_worker_count(self):
        names = [f"Card {i}" for i in range(100)]
        for name in names:
            game.CARDS[name] = {"faces": [{"name": name, "printPending": "https://example.test/" + name}]}

        full, release = threading.Event(), threading.Event()
        lock = threading.Lock()
        active = peak = 0

        def download(url, raw):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == game.PRINT_WORKERS:
                    full.set()
            try:
                if not release.wait(5):
                    raise AssertionError("test never released the download")
                return b"print"
            finally:
                with lock:
                    active -= 1

        starts = []

        class Worker(threading.Thread):
            def start(self):
                super().start()
                starts.append(self)

        threads = mock.Mock(wraps=threading, Thread=Worker)
        with mock.patch.multiple(game, PRINT_QUEUE=queue.Queue(), PRINT_WORKERS_STARTED=0, threading=threads), \
                mock.patch.object(game, "get", side_effect=download) as get, ThreadPoolExecutor(3) as clients:
            try:
                requests = [clients.submit(game.cards, names[offset::3]) for offset in range(3)]
                for request in requests:
                    request.result(timeout=2)
                self.assertTrue(full.wait(2))
                self.assertEqual(len(starts), 3)
                self.assertEqual(get.call_count, 3)
            finally:
                release.set()
                game.PRINT_QUEUE.join()
            self.assertEqual(peak, game.PRINT_WORKERS)
            self.assertEqual(get.call_count, len(names))
            self.assertTrue(all(game.CARDS[n]["faces"][0]["img"] for n in names))

    def test_worker_exception_releases_the_claim(self):
        game.CARDS["Forest"] = {"faces": [{"name": "Forest", "printPending": "https://example.test/forest"}]}
        upgrade_result = {"faces": [{"name": "Forest", "img": "cache/card-large/forest.jpg"}]}
        retried = threading.Event()
        retry_at = self.now + game.PRINT_COOLDOWN

        def upgrade(name, card):
            if self.now < retry_at:
                raise SystemExit()
            retried.set()
            return upgrade_result

        with mock.patch.multiple(game, PRINT_QUEUE=queue.Queue(), PRINT_WORKERS_STARTED=0, PRINT_WORKERS=1), \
                mock.patch.object(game, "upgrade_print", side_effect=upgrade) as attempt, \
                mock.patch.object(game.traceback, "print_exc") as log:
            game.cards(["Forest"])
            game.PRINT_QUEUE.join()
            log.assert_called_once()
            self.assertEqual(game.PRINT_RETRY_AT["Forest"], retry_at)
            self.now = retry_at
            game.cards(["Forest"])
            self.assertTrue(retried.wait(2))
            game.PRINT_QUEUE.join()
            self.assertEqual(game.CARDS["Forest"], upgrade_result)
            self.assertEqual(attempt.call_count, 2)
            self.assertNotIn("Forest", game.PRINT_RETRY_AT)

    def test_fill_cache_uses_distinct_printing_ids_for_elemental_tokens(self):
        faces = [f for f in game.fixture_faces() if f["name"] == "Elemental"]
        tokens = {
            "elemental-marath": "c5ad13b4-bbf5-4c98-868f-4d105eaf8833",
            "elemental-waves": "f0e68ed9-d863-4822-b281-e184f3d62faa",
        }
        replies = {}
        for token, printing in tokens.items():
            path = self.cache / "card-large" / (token + ".jpg")
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(b"previous ambiguous print")
            path.with_suffix(".id").write_text(printing)
            art = self.cache / "art" / (token + ".jpg")
            art.parent.mkdir(exist_ok=True)
            art.write_bytes(b"previous ambiguous crop")
            uri = "https://example.test/" + token
            replies["https://api.scryfall.com/cards/" + printing] = {"image_uris": {"large": uri, "art_crop": uri + "-art"}}
            replies[uri] = token.encode()
            replies[uri + "-art"] = (token + "-art").encode()

        with mock.patch.object(game, "fixture_faces", return_value=faces), \
                mock.patch.object(game, "scryfall") as by_name, \
                mock.patch.object(game, "get", side_effect=lambda url, **_: replies[url]) as by_id:
            self.assertEqual(game.fill_cache(), 0)
            self.assertEqual(by_id.call_count, 6)
            self.assertEqual(game.fill_cache(), 0)
            self.assertEqual(by_id.call_count, 6)
            by_name.assert_not_called()
        for token in tokens:
            self.assertEqual((self.cache / "card-large" / (token + ".jpg")).read_bytes(), token.encode())
            self.assertEqual((self.cache / "art" / (token + ".jpg")).read_bytes(), (token + "-art").encode())


class AnswerStatusTest(unittest.TestCase):
    def test_an_accepted_answer_is_working_until_the_engine_returns_then_applied(self):
        t, eng = table(), Engine("block")
        with mock.patch.object(engine, "request", eng.request):
            before = t.version
            self.assertEqual(t.answer({"key": game.key(PLAY), "id": 41, "answer": [2]}), {"ok": True, "attempt": 1})
            self.assertEqual(eng.calls, [{"cmd": "answer", "session": "s1", "id": 41, "answer": [2]}])
            self.assertEqual(t.snapshot["answer"], status(PLAY, "working"))
            self.assertGreater(t.version, before)   # a status change wakes the long polls
            eng.release()
            self.assertEqual(settle(t, "applied"), status(PLAY, "applied"))

    def test_the_old_clients_key_is_checked_then_the_pending_decisions_id_goes_to_the_engine(self):
        t, eng = table(), Engine()
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"key": game.key(PLAY), "answer": [2]}), {"ok": True, "attempt": 1})
        self.assertEqual(eng.calls, [{"cmd": "answer", "session": "s1", "id": 41, "answer": [2]}])

    def test_a_decision_without_an_id_is_answered_as_before(self):
        t, eng = table({k: v for k, v in PLAY.items() if k != "id"}), Engine("block")
        with mock.patch.object(engine, "request", eng.request):
            t.answer({"key": game.key(PLAY), "answer": [2]})
            self.assertEqual(eng.calls, [{"cmd": "answer", "session": "s1", "answer": [2]}])
            self.assertEqual(t.snapshot["answer"], {"key": game.key(PLAY), "id": None, "attempt": 1, "state": "working"})
            self.assertEqual(t.answer({"key": game.key(PLAY), "answer": [1]}),
                             {"ok": False, "error": "an answer is already being worked on"})   # by key
            eng.release()
            settle(t, "applied")

    def test_a_refused_answer_says_why_in_the_reply_and_the_status(self):
        t, eng = table(), Engine(engine.EngineError("pick exactly 1"))
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"id": 41, "answer": [1, 2]}), {"ok": False, "error": "pick exactly 1",
                                                                    "attempt": 1})
        self.assertEqual(t.snapshot["answer"], status(PLAY, "refused", error="pick exactly 1"))

    def test_a_second_answer_while_one_is_working_is_refused(self):
        t, eng = table(), Engine("block", "ok")
        with mock.patch.object(engine, "request", eng.request):
            t.answer({"id": 41, "answer": [2]})
            self.assertEqual(t.answer({"id": 41, "answer": [1]}),
                             {"ok": False, "error": "an answer is already being worked on"})
            self.assertEqual(t.answer({"defer": True}), {"ok": False, "error": "an answer is already being worked on"})
            self.assertEqual(len(eng.calls), 1)
            eng.release()
            settle(t, "applied")
            # finished: it may be answered again (the engine refuses it if it has moved on)
            self.assertEqual(t.answer({"id": 41, "defer": True}), {"ok": True, "attempt": 2})
            self.assertEqual(eng.calls[1], {"cmd": "answer", "session": "s1", "id": 41, "defer": True, "by": "ai"})

    def test_a_new_decision_waits_for_the_outstanding_answer_reply(self):
        t, eng = table(), Engine("block", "ok")
        with mock.patch.object(engine, "request", eng.request):
            t.answer({"id": 41, "answer": [1]})
            show(t, PLAY_AGAIN)
            body = {"key": game.key(PLAY), "id": 43, "answer": [1]}
            self.assertEqual(t.answer(body), {"ok": False, "error": "an answer is already being worked on"})
            self.assertEqual([c["id"] for c in eng.calls], [41])
            eng.release()
            settle(t, "applied")
            self.assertEqual(t.answer(body), {"ok": True, "attempt": 2})
            self.assertEqual([c["id"] for c in eng.calls], [41, 43])

    def test_answers_that_cannot_be_forwarded_leave_the_status_alone(self):
        t, eng = table(), Engine()
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"key": "play|T2 main1||1|pass", "answer": [1]}),
                             {"ok": False, "error": "that decision has passed"})
            self.assertEqual(t.answer({"key": game.key(PLAY), "id": 40, "answer": [1]}),
                             {"ok": False, "error": "that decision has passed"})
            show(t, None)
            self.assertEqual(t.answer({"answer": [1]}), {"ok": False, "error": "nothing to answer"})
        self.assertEqual(eng.calls, [])
        self.assertIsNone(t.snapshot["answer"])

    def test_a_late_reply_never_overwrites_a_newer_answer(self):
        t, eng = table(), Engine("block", engine.EngineError("pick exactly 1"))
        with mock.patch.object(engine, "request", eng.request):
            t.answer({"id": 41, "answer": [2]})
            gen = t.begin()
            show(t, CONFIRM, gen=gen, session="s2")
            t.answer({"id": 42, "gen": gen, "answer": [1, 2]})
            self.assertEqual(t.snapshot["answer"]["id"], 42)
            eng.release()
            time.sleep(0.1)
        self.assertEqual(t.snapshot["answer"], status(CONFIRM, "refused", attempt=3, error="pick exactly 1"))

    def test_each_forwarded_answer_is_a_new_attempt(self):
        # a refusal that comes and goes between two polls still shows: the next status has a later attempt
        t, eng = table(), Engine(engine.EngineError("pick exactly 1"), "ok")
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"id": 41, "answer": [1, 2]}),
                             {"ok": False, "error": "pick exactly 1", "attempt": 1})   # the reply names it too
            first = t.snapshot["answer"]
            self.assertEqual((first["state"], first["error"]), ("refused", "pick exactly 1"))
            self.assertEqual(t.answer({"key": "stale", "answer": [1]})["ok"], False)   # not forwarded: no attempt
            self.assertEqual(t.answer({"id": 41, "answer": [2]}), {"ok": True, "attempt": 2})
        second = settle(t, "applied")
        self.assertIsInstance(first["attempt"], int)
        self.assertEqual(second["attempt"], first["attempt"] + 1)
        t.begin()   # a new game's answers carry on counting: an attempt never repeats while the bridge runs
        show(t, PLAY, gen=2)
        with mock.patch.object(engine, "request", Engine().request):
            t.answer({"id": 41, "gen": 2, "answer": [2]})
        self.assertGreater(settle(t, "applied")["attempt"], second["attempt"])

    def test_the_status_survives_the_view_moving_on(self):
        t, eng = table(), Engine()
        with mock.patch.object(engine, "request", eng.request):
            t.answer({"id": 41, "answer": [2]})
        settle(t, "applied")
        show(t, CONFIRM)
        self.assertEqual(t.snapshot["answer"], status(PLAY, "applied"))
        self.assertEqual(t.snapshot["decision"], CONFIRM)


# Each engine session numbers its decisions from 1, so the next game's opening mulligan can share the last one's id
# and key: only the game's gen tells them apart.
MULLIGAN = {"kind": "mulligan", "turn": "T0 setup", "prompt": "keep this hand", "options": ["keep", "mulligan"],
            "min": 1, "max": 1, "repeat": False, "mine": True, "id": 1}


class GameReplacementTest(unittest.TestCase):
    def replaced(self):
        """Game 1 asked its opening mulligan in session s1; game 2 asks the same, as id 1, in session s2."""
        t = table(MULLIGAN)
        self.assertEqual(t.begin(), 2)
        show(t, MULLIGAN, gen=2, session="s2")
        return t

    def test_an_answer_meant_for_the_last_game_is_refused(self):
        t, eng = self.replaced(), Engine()
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"key": game.key(MULLIGAN), "id": 1, "gen": 1, "answer": [2]}),
                             {"ok": False, "error": "that decision has passed"})
            self.assertEqual(eng.calls, [])
            self.assertIsNone(t.snapshot["answer"])
            self.assertEqual(t.answer({"key": game.key(MULLIGAN), "id": 1, "gen": 2, "answer": [1]}), {"ok": True, "attempt": 2})
        self.assertEqual(eng.calls, [{"cmd": "answer", "session": "s2", "id": 1, "answer": [1]}])

    def test_the_old_client_sends_no_gen_and_still_answers(self):
        t, eng = self.replaced(), Engine()
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"key": game.key(MULLIGAN), "answer": [1]}), {"ok": True, "attempt": 2})
        self.assertEqual(eng.calls, [{"cmd": "answer", "session": "s2", "id": 1, "answer": [1]}])

    def test_the_answer_goes_to_the_session_whose_view_showed_the_decision(self):
        t, eng = table(MULLIGAN), Engine()
        t.mine = "s2"   # the next game's seat, opened before its first view arrives
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"id": 1, "gen": 1, "answer": [1]}), {"ok": True, "attempt": 1})
        self.assertEqual(eng.calls[0]["session"], "s1")

    def test_while_the_next_game_starts_there_is_nothing_to_answer(self):
        t, eng = table(MULLIGAN), Engine()
        t.begin()
        with mock.patch.object(engine, "request", eng.request):
            self.assertEqual(t.answer({"key": game.key(MULLIGAN), "id": 1, "gen": 1, "answer": [1]}),
                             {"ok": False, "error": "nothing to answer"})
            self.assertEqual(t.answer({"key": game.key(MULLIGAN), "answer": [1]}),
                             {"ok": False, "error": "nothing to answer"})
        self.assertEqual(eng.calls, [])
        self.assertEqual((t.snapshot["state"], t.snapshot["gen"]), ("starting", 2))

    def test_http_reserves_generations_before_workers_run(self):
        t = game.Table()
        handler = mock.Mock(path="/api/new")
        handler.length.return_value = 1
        handler.body.side_effect = [{"deck": "first"}, {"deck": "second"}]
        handler.send.side_effect = lambda code, body: acknowledged.append((code, body, t.generation))
        queued, acknowledged = [], []
        factory = mock.Mock(side_effect=lambda target, args, daemon: mock.Mock(
            **{"start.side_effect": lambda: queued.append((target, args))}))
        with mock.patch.multiple(game, TABLE=t, ARGS=mock.Mock(deck="default", opponents="opponent"),
                                 threading=mock.Mock(Thread=factory)), mock.patch.object(t, "open") as opened:
            game.Handler.do_POST(handler)
            game.Handler.do_POST(handler)
            for target, args in reversed(queued):
                target(*args)
        self.assertEqual(acknowledged, [(200, {"ok": True}, 1), (200, {"ok": True}, 2)])
        opened.assert_called_once_with(2, "second", ["opponent"], None, "creatures")
        self.assertEqual(t.snapshot["gen"], 2)

    def test_a_view_from_the_last_game_is_not_shown(self):
        t = table(MULLIGAN)
        t.begin()
        self.assertFalse(show(t, PLAY, gen=1, session="s1"))
        self.assertEqual((t.snapshot["state"], t.snapshot["gen"]), ("starting", 2))


class SlowView:
    """engine.request for the watcher: the first view waits for release(), then shows the mulligan."""

    def __init__(self):
        self.calls, self.asked, self.gate = [], threading.Event(), threading.Event()

    def request(self, req, start=True):
        assert not start  # A watcher only reads the engine that opened its session.
        self.calls.append(req)
        if len(self.calls) == 1:
            self.asked.set()
            self.gate.wait(5)
        return {"view": {}, "decision": MULLIGAN}


class WatcherTest(unittest.TestCase):
    def test_a_delayed_view_from_the_last_game_never_overwrites_the_next(self):
        t, eng = game.Table(), SlowView()
        t.generation = 1
        with mock.patch.object(engine, "request", eng.request):
            watcher = threading.Thread(target=t.watch, args=(1, "s1"), daemon=True)
            watcher.start()
            self.assertTrue(eng.asked.wait(5))
            t.begin()   # game 2 starts while game 1's view is on its way
            eng.gate.set()
            watcher.join(5)
            self.assertFalse(watcher.is_alive())
        self.assertEqual((t.snapshot["state"], t.snapshot["gen"]), ("starting", 2))
        self.assertEqual(eng.calls, [{"cmd": "view", "session": "s1"}])

    def test_the_watcher_reads_its_own_session(self):
        t, eng = game.Table(), SlowView()
        t.generation, t.mine = 1, "s9"
        eng.gate.set()
        with mock.patch.object(engine, "request", eng.request), mock.patch.object(game.time, "sleep",
                                                                                   side_effect=lambda s: t.begin()):
            t.watch(1, "s1")
        self.assertEqual(eng.calls, [{"cmd": "view", "session": "s1"}])
        self.assertEqual(t.snapshot["state"], "starting")


    def test_long_stall_interrupts_only_after_recovery_window(self):
        t = game.Table()
        gen = t.begin()
        clock = mock.Mock(return_value=0)
        backoffs = []

        def request(req, start=True):
            if clock() == 0:
                return {"view": {"me": "You"}, "decision": PLAY}
            if t.snapshot["state"] == "reconnecting":
                self.assertEqual(t.answer({"id": PLAY["id"], "gen": gen})["ok"], False)
            raise engine.EngineTimeout("view stalled")

        def pause(delay):
            if t.snapshot["state"] == "reconnecting":
                backoffs.append(delay)
            clock.return_value += delay

        with mock.patch.object(game.time, "monotonic", clock), mock.patch.object(game.time, "sleep", side_effect=pause), \
                mock.patch.object(engine, "request", side_effect=request), mock.patch.object(engine, "engine_pid", return_value=None):
            t.watch(gen, "s1")
        self.assertGreaterEqual(clock(), game.RECOVERY_SECONDS)
        self.assertEqual(backoffs[:5], [0.5, 1, 2, 4, 5])
        self.assertEqual(t.version, 4)
        self.assertEqual(t.snapshot["state"], "interrupted")
        self.assertNotIn("decision", t.snapshot)

    def test_slow_view_recovers_to_a_clean_snapshot_of_the_same_session(self):
        t = game.Table()
        gen = t.begin()
        clock = mock.Mock(return_value=0)
        calls = []

        def request(req, start=True):
            calls.append(req["session"])
            self.assertFalse(start)
            if len(calls) == 1:
                return {"view": {"me": "You"}, "decision": PLAY}
            if len(calls) == 2:
                clock.return_value += 30
                raise engine.EngineTimeout("view stalled")
            self.assertEqual(t.snapshot["state"], "reconnecting")
            self.assertNotIn("decision", t.snapshot)
            self.assertEqual(t.answer({"id": PLAY["id"], "gen": gen})["ok"], False)
            return {"view": {"me": "You"}, "over": "over: a draw"}

        with mock.patch.object(game.time, "monotonic", clock), mock.patch.object(game.time, "sleep"), \
                mock.patch.object(engine, "request", side_effect=request), mock.patch.object(engine, "engine_pid", return_value=None):
            t.watch(gen, "s1")
        self.assertEqual(calls, ["s1"] * 3)
        self.assertEqual(t.version, 4)
        self.assertEqual(t.snapshot["state"], "over")
        self.assertEqual(t.snapshot["gen"], gen)
        self.assertIsNone(t.error)


    def test_reconnect_keeps_the_same_answer_outstanding_until_it_settles(self):
        t, eng = table(), Engine("block")
        before = []
        body = {"id": PLAY["id"], "gen": 1, "answer": [2]}
        view = {"view": {"me": "You"}, "decision": PLAY}

        def request(req, start=True):
            if req["cmd"] == "answer":
                return eng.request(req)
            before.append((t.snapshot["state"], t.snapshot["answer"], t.answer(body)))
            if len(before) == 1:
                raise engine.EngineTimeout("view stalled")
            if len(before) == 2:
                return view
            eng.release()
            settle(t, "applied")
            return {"view": view["view"], "over": "over: a draw"}

        with mock.patch.object(engine, "engine_pid", return_value=None), mock.patch.object(engine, "request", side_effect=request):
            t.watch(1, "s1")
        self.assertEqual(before, [
            ("playing", None, {"ok": True, "attempt": 1}),
            ("reconnecting", status(PLAY, "working"), {"ok": False, "error": "nothing to answer"}),
            ("playing", status(PLAY, "working"), {"ok": False, "error": "an answer is already being worked on"}),
        ])
        self.assertEqual(t.snapshot["answer"], status(PLAY, "applied"))
        self.assertEqual(len(eng.calls), 1)


class EnvelopeTest(unittest.TestCase):
    def test_the_envelope_carries_version_error_build_and_answer(self):
        self.assertEqual(game.envelope({"state": "no game"}, 0, None),
                         {"state": "no game", "answer": None, "v": 0, "error": None, "build": None})
        snap = dict(playing(PLAY), answer={"key": "k", "state": "working"})
        env = game.envelope(snap, 4, "engine closed the connection", "abc123def456")
        self.assertEqual((env["v"], env["error"], env["build"], env["answer"]),
                         (4, "engine closed the connection", "abc123def456", {"key": "k", "state": "working"}))
        self.assertEqual(game.Table().snapshot, {"state": "no game", "answer": None})

    def test_the_build_comes_from_the_served_builds_build_json(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(game, "DIST", pathlib.Path(tmp)):
            self.assertIsNone(game.client_build())
            (pathlib.Path(tmp) / "build.json").write_text('{"build": "c84102cd92eb"}\n')
            self.assertEqual(game.client_build(), "c84102cd92eb")
            (pathlib.Path(tmp) / "build.json").write_text("not json")
            game._BUILD["mtime"] = None
            self.assertIsNone(game.client_build())

    def test_the_key_is_the_one_in_the_corpus(self):
        self.assertEqual(game.key(PLAY), "play|T3 main1||2|pass|Forest (land)")
        self.assertEqual(game.key({"kind": "number", "turn": "T2 main1", "prompt": "X for Fireball", "options": []}),
                         "number|T2 main1|X for Fireball|0")


def entry(**changes):
    return dict({"level": "error", "code": "decode", "build": "c84102cd92eb", "rev": 12, "stop": 3,
                 "message": "view.players.0.battlefield.3.id: Invalid type"}, **changes)


class ClientLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.tmp.name) / "clientlog.jsonl"
        self.now = 1000.0
        self.log = game.ClientLog(self.path, clock=lambda: self.now)

    def tearDown(self):
        self.tmp.cleanup()

    def lines(self):
        return [json.loads(line) for line in self.path.read_text().splitlines()]

    def test_entries_are_appended_with_the_time(self):
        self.assertEqual(self.log.add({"entries": [entry(), entry(level="warn", build=None, rev=None, stop=None)]}),
                         (200, {"ok": True, "kept": 2, "dropped": 0}))
        first, second = self.lines()
        self.assertEqual(first, dict(entry(), at=1000.0))
        self.assertEqual((second["level"], second["build"], second["rev"], second["stop"]), ("warn", None, None, None))
        self.log.add({"entries": [{"level": "info", "code": "boot", "message": "hello"}]})   # build, rev, stop may be left out
        self.assertEqual(self.lines()[2]["rev"], None)

    def test_other_shapes_are_refused(self):
        bad = {
            "not an object": [],
            "no entries": {},
            "extra top-level key": {"entries": [entry()], "more": 1},
            "entries not a list": {"entries": entry()},
            "empty": {"entries": []},
            "51 entries": {"entries": [entry()] * 51},
            "entry not an object": {"entries": ["x"]},
            "unknown field": {"entries": [entry(card_text="...")]},
            "missing message": {"entries": [{"level": "info", "code": "x"}]},
            "level": {"entries": [entry(level="fatal")]},
            "code with spaces": {"entries": [entry(code="bad code")]},
            "long code": {"entries": [entry(code="x" * 65)]},
            "message not text": {"entries": [entry(message=3)]},
            "message over 2 KB": {"entries": [entry(message="é" * 1025)]},   # 2050 bytes
            "rev negative": {"entries": [entry(rev=-1)]},
            "rev a bool": {"entries": [entry(rev=True)]},
            "stop text": {"entries": [entry(stop="3")]},
            "build not text": {"entries": [entry(build=7)]},
        }
        for name, body in bad.items():
            with self.subTest(name):
                code, reply = self.log.add(body)
                self.assertEqual((code, reply["ok"]), (400, False))
                self.assertTrue(reply["error"])
        self.assertFalse(self.path.exists())
        self.assertEqual(self.log.add({"entries": [entry(message="é" * 1024)]})[0], 200)   # exactly 2 KB

    def test_at_most_50_entries_a_minute(self):
        self.assertEqual(self.log.add({"entries": [entry()] * 30})[1]["kept"], 30)
        self.now += 30
        self.assertEqual(self.log.add({"entries": [entry()] * 30})[1], {"ok": True, "kept": 20, "dropped": 10})
        self.assertEqual(self.log.add({"entries": [entry()]})[0], 429)
        self.now += 31   # the first 30 are over a minute old
        self.assertEqual(self.log.add({"entries": [entry()] * 40})[1]["kept"], 30)
        self.assertEqual(len(self.lines()), 80)

    def test_the_file_rotates_keeping_one_old_file(self):
        log = game.ClientLog(self.path, limit=1000, clock=lambda: self.now)
        for i in range(12):
            self.now += 61
            log.add({"entries": [entry(code=f"c{i}")]})
        old = self.path.with_name("clientlog.jsonl.1")
        self.assertTrue(old.exists())
        self.assertLessEqual(self.path.stat().st_size, 1000)
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), ["clientlog.jsonl", "clientlog.jsonl.1"])
        self.assertEqual(self.lines()[-1]["code"], "c11")


class Server:
    """The real handler on a free port, with the bridge's globals pointed at a temporary build and log."""

    def __init__(self, dist, log):
        self.patches = [mock.patch.object(game, "DIST", dist), mock.patch.object(game, "CLIENT_LOG", log),
                        mock.patch.object(game, "TABLE", game.Table())]

    def __enter__(self):
        for p in self.patches:
            p.start()
        game._BUILD["mtime"] = None
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), game.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        for p in self.patches:
            p.stop()

    def get(self, path, method="GET", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        conn.request(method, path, body=None if body is None else json.dumps(body), headers=headers)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, dict(r.getheaders()), data

    def post_raw(self, path, length, body=b""):
        """A POST whose Content-Length header says `length`, whatever the body is."""
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=5)
        conn.putrequest("POST", path)
        conn.putheader("Content-Type", "application/json")
        conn.putheader("Content-Length", length)
        conn.endheaders(body)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, json.loads(data)


class ClientServingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.dist = root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_text("<!doctype html><title>Deckmaster</title>")
        (self.dist / "assets" / "index-B8eTv0QL.js").write_text("console.log(1)")
        (self.dist / "build.json").write_text('{"build": "c84102cd92eb"}\n')
        self.log = game.ClientLog(root / "clientlog.jsonl")

    def tearDown(self):
        self.tmp.cleanup()

    def test_root_serves_the_build_with_long_caching_only_for_hashed_assets(self):
        with Server(self.dist, self.log) as s:
            status, headers, data = s.get("/")
            self.assertEqual((status, data, headers["Cache-Control"]), (200, b"<!doctype html><title>Deckmaster</title>", "no-store"))
            status, headers, _ = s.get("/assets/index-B8eTv0QL.js")
            self.assertEqual((status, headers["Cache-Control"]), (200, "public, max-age=31536000, immutable"))
            self.assertIn("javascript", headers["Content-Type"])
            self.assertEqual(s.get("/missing.js")[0], 404)
            self.assertEqual(s.get("/../../../deckmaster/game.py")[0], 404)

    def test_old_entrypoints_redirect_and_preserve_query(self):
        with Server(self.dist, self.log) as s:
            for path in ("/next", "/next/", "/live.html"):
                with self.subTest(path=path):
                    status, headers, _ = s.get(path + "?debug=1")
                    self.assertEqual((status, headers["Location"]), (302, "/?debug=1"))
            for path in ("/next/assets/index-B8eTv0QL.js", "/offline.html", "/src/app/main.ts"):
                self.assertEqual(s.get(path)[0], 404)

    def test_the_client_api_carries_the_build(self):
        with Server(self.dist, self.log) as s:
            status, _, data = s.get("/next/api/view?v=5")   # a cursor from before a restart: answered at once
            env = json.loads(data)
            self.assertEqual((status, env["state"], env["build"], env["answer"]), (200, "no game", "c84102cd92eb", None))
            self.assertEqual(json.loads(s.get("/api/view?v=5")[2])["build"], "c84102cd92eb")

    def test_the_client_log_endpoint(self):
        with Server(self.dist, self.log) as s:
            status, _, data = s.get("/api/clientlog", "POST", {"entries": [entry()]})
            self.assertEqual((status, json.loads(data)), (200, {"ok": True, "kept": 1, "dropped": 0}))
            self.assertEqual(s.get("/next/api/clientlog", "POST", {"entries": [entry()]})[0], 200)
            status, _, data = s.get("/api/clientlog", "POST", {"entries": [entry(level="fatal")]})
            self.assertEqual((status, json.loads(data)["ok"]), (400, False))
            self.assertEqual(s.get("/api/clientlog", "POST", [1, 2])[0], 400)
        self.assertEqual(len(self.log.path.read_text().splitlines()), 2)

    def test_the_bench_endpoint_keeps_each_run_as_a_file(self):
        bench = game.BenchResults(pathlib.Path(self.tmp.name) / "bench", clock=lambda: 1_700_000_000)
        with mock.patch.object(game, "BENCH_RESULTS", bench), Server(self.dist, self.log) as s:
            status, _, data = s.get("/next/api/bench", "POST", {"rows": [{"input": "dense"}], "userAgent": "iPad"})
            reply = json.loads(data)
            self.assertEqual((status, reply["ok"]), (200, True))
            name = pathlib.Path(reply["file"]).name
            self.assertEqual(json.loads((bench.folder / name).read_text())["rows"], [{"input": "dense"}])
            second = json.loads(s.get("/api/bench", "POST", {"rows": []})[2])["file"]   # the same second: a new name
            self.assertNotEqual(pathlib.Path(second).name, name)
            self.assertEqual(s.get("/api/bench", "POST", {"no": "rows"})[0], 400)
            # the render bench's run says which bench it is
            render = json.loads(s.get("/api/bench", "POST", {"bench": "render", "table": "turn 15", "framesPerMoment": 120, "rows": []})[2])["file"]
            self.assertEqual(json.loads((bench.folder / pathlib.Path(render).name).read_text())["bench"], "render")
        bench.KEEP = 1
        bench.add({"rows": []})
        self.assertEqual(len(list(bench.folder.glob("bench-*.json"))), 1)

    def test_the_bench_endpoint_answers_every_request_and_keeps_within_the_cap(self):
        bench = game.BenchResults(pathlib.Path(self.tmp.name) / "bench")
        with mock.patch.object(game, "BENCH_RESULTS", bench), Server(self.dist, self.log) as s:
            # within the cap as sent, kept within it: compact, and only the page's fields
            rows = [{f"k{k}": i for k in range(320)} for i in range(60)]   # ~230 KiB as sent, past the cap pretty-printed
            status, _, data = s.get("/api/bench", "POST", {"rows": rows, "userAgent": "iPad", "extra": "not kept"})
            self.assertEqual(status, 200)
            kept = bench.folder / pathlib.Path(json.loads(data)["file"]).name
            self.assertLessEqual(kept.stat().st_size, 256 * 1024)   # the request cap
            self.assertEqual(sorted(json.loads(kept.read_text())), ["rows", "userAgent"])
            # the wrong shape, too many rows, nested past what parses: refused, each with an answer
            self.assertEqual(s.get("/api/bench", "POST", {"rows": [1, 2]})[0], 400)
            self.assertEqual(s.get("/api/bench", "POST", {"rows": [{}] * 65})[0], 400)
            deep = b'{"rows":[{"a":' + b"[" * 100000 + b"]" * 100000 + b"}]}"
            self.assertEqual(s.post_raw("/api/bench", str(len(deep)), deep)[0], 400)
            # a folder it cannot write: 500, and the server goes on
            bench.folder = pathlib.Path(self.tmp.name) / "a-file"
            bench.folder.write_text("")
            status, _, data = s.get("/api/bench", "POST", {"rows": []})
            self.assertEqual((status, json.loads(data)["ok"]), (500, False))
            self.assertEqual(s.get("/api/bench", "POST", {"no": "rows"})[0], 400)

    def test_a_bad_content_length_is_refused_and_a_good_one_read_exactly(self):
        body = json.dumps({"entries": [entry()]}).encode()
        with Server(self.dist, self.log) as s:
            for path in ("/api/clientlog", "/api/answer"):
                for length in ("-1", "-100", "abc", "1.5", ""):
                    with self.subTest(path=path, length=length):
                        status, reply = s.post_raw(path, length, body)
                        self.assertEqual((status, reply["ok"]), (400, False))
            self.assertEqual(s.post_raw("/api/clientlog", str(300 * 1024))[0], 413)
            self.assertEqual(s.post_raw("/api/clientlog", str(len(body)), body + b"trailing junk")[0], 200)
            self.assertEqual(s.post_raw("/api/clientlog", str(len(body) - 1), body)[0], 400)   # read exactly: cut JSON
        self.assertEqual(len(self.log.path.read_text().splitlines()), 1)

    def test_without_a_build_root_says_how_to_make_one(self):
        with Server(pathlib.Path(self.tmp.name) / "nothing", self.log) as s:
            status, _, data = s.get("/")
            self.assertEqual(status, 404)
            self.assertIn(b"npm run build", data)


class BuildOnStartTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.game = pathlib.Path(self.tmp.name) / "game"
        client = self.game / "client"
        (client / "src" / "protocol").mkdir(parents=True)
        (client / "src" / "protocol" / "index.ts").write_text("export {};\n")
        (client / "index.html").write_text("<!doctype html>")
        (self.game / "package.json").write_text("{}")
        (self.game / "package-lock.json").write_text("{}")
        (self.game / "vite.config.mts").write_text("export default {};")
        (client / "test" / "model").mkdir(parents=True)
        (client / "test" / "model" / "catalog.json").write_text("{}")
        self.corpus = self.game.parent / "tests" / "fixtures" / "protocol"
        self.corpus.mkdir(parents=True)
        (self.corpus / "001-no-game.json").write_text('{"state": "no game"}')
        self.dist = client / "dist"
        self.patches = [mock.patch.object(game, "GAME", self.game), mock.patch.object(game, "CLIENT", client),
                        mock.patch.object(game, "DIST", self.dist)]
        for p in self.patches:
            p.start()
        self.node = "v22.11.0"
        self.builds = []
        self.broken = False
        self.said = []

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def run_(self, cmd, **kw):
        if cmd[1:] == ["--version"]:
            return mock.Mock(stdout=self.node + "\n", stderr="", returncode=0)
        self.builds.append((cmd, kw.get("cwd")))
        if self.broken:
            return mock.Mock(stdout="", stderr="vite: error", returncode=1)
        out = pathlib.Path(cmd[cmd.index("--outDir") + 1])
        out.mkdir(parents=True)
        (out / "index.html").write_text(f"build {len(self.builds)}")
        (out / "build.json").write_text('{"build": "x"}')
        return mock.Mock(stdout="built", stderr="", returncode=0)

    def ensure(self, which=lambda name: "/usr/bin/" + name):
        return game.ensure_client(run=self.run_, which=which, say=self.said.append)

    def test_a_stale_build_is_rebuilt_in_staging_then_published(self):
        self.assertEqual(self.ensure(), "built")
        (cmd, cwd), = self.builds
        self.assertEqual(cmd[:4], ["/usr/bin/npm", "run", "build", "--"])
        self.assertEqual((cmd[4], pathlib.Path(cmd[5]).name, cwd), ("--outDir", "dist.staging", str(self.game)))
        self.assertEqual((self.dist / ".stamp").read_text().strip(), game.client_stamp(self.node))
        self.assertEqual((self.dist / "index.html").read_text(), "build 1")
        self.assertFalse(self.dist.with_name("dist.staging").exists())
        self.assertFalse(self.dist.with_name("dist.old").exists())

    def test_a_current_build_is_left_alone(self):
        self.ensure()
        self.assertEqual(self.ensure(), "current")
        self.assertEqual(len(self.builds), 1)

    def test_sources_and_node_make_the_stamp(self):
        self.ensure()
        (self.game / "client" / "src" / "protocol" / ".DS_Store").write_text("noise")
        self.assertEqual(self.ensure(), "current")
        (self.game / "client" / "src" / "protocol" / "index.ts").write_text("export const x = 1;\n")
        self.assertEqual(self.ensure(), "built")
        self.node = "v24.0.0"
        self.assertEqual(self.ensure(), "built")
        (self.game / "package-lock.json").write_text('{"lockfileVersion": 3}')
        self.assertEqual(self.ensure(), "built")
        (self.game / "package.json").write_text('{"scripts": {"build": "vite build"}}')
        self.assertEqual(self.ensure(), "built")
        self.assertEqual((self.dist / "index.html").read_text(), "build 5")

    def test_the_workbench_inputs_make_the_stamp(self):
        # the workbench's motion page bundles the protocol corpus and a test catalog (import.meta.glob)
        self.ensure()
        (self.corpus / "001-no-game.json").write_text('{"state": "no game", "v": 0}')
        self.assertEqual(self.ensure(), "built")
        (self.corpus / "054-choose.json").write_text("{}")
        self.assertEqual(self.ensure(), "built")
        (self.game / "client" / "test" / "model" / "catalog.json").write_text('{"Forest": {}}')
        self.assertEqual(self.ensure(), "built")
        self.assertEqual(self.ensure(), "current")

    def test_the_stamp_reads_what_the_vite_build_id_reads(self):
        config = (game.ROOT / "game" / "vite.config.mts").read_text()
        listed = re.search(r"const BUILD_INPUTS = \[(.*?)\];", config, re.S).group(1)
        self.assertEqual(tuple(re.findall(r'"([^"]+)"', listed)), game.STAMP_INPUTS)
        here = game.ROOT / "game" / "client" / "src" / "scene" / "workbench"
        sources = "".join(p.read_text() for p in sorted(here.glob("*.ts")))
        for glob in re.findall(r'import\.meta\.glob[^(]*\("([^"]+)"', sources):
            target = os.path.relpath(os.path.normpath(here / glob), game.ROOT / "game").replace(os.sep, "/")
            self.assertTrue(any(target == rel or target.startswith(rel + "/") for rel in game.STAMP_INPUTS), target)

    def test_a_failed_build_keeps_the_last_one(self):
        self.ensure()
        (self.game / "client" / "index.html").write_text("<!doctype html><title>changed</title>")
        self.broken = True
        self.assertEqual(self.ensure(), "failed")
        self.assertEqual((self.dist / "index.html").read_text(), "build 1")
        self.assertFalse(self.dist.with_name("dist.staging").exists())
        self.assertIn("vite: error", self.said[-1])
        self.assertIn("its last build", self.said[-1])

    def test_without_node_what_exists_is_served(self):
        self.assertEqual(self.ensure(which=lambda name: None), "no node")
        self.assertEqual(self.builds, [])
        self.assertIn("Node isn't installed", self.said[-1])
        self.assertFalse(self.dist.exists())


class GameStartTest(unittest.TestCase):
    def test_engine_start_failure_publishes_error_for_the_same_game(self):
        t = game.Table()
        failure = "engine socket path too long"
        calls = []

        def request(req, start=True):
            calls.append((req["cmd"], start))
            raise engine.EngineError(failure)

        with mock.patch.multiple(game, TABLE=t, ARGS=mock.Mock(table_port=18000)), \
                mock.patch.object(game, "close_table"), mock.patch("deckmaster.game.decks.get"), mock.patch("deckmaster.game.model.key"), \
                mock.patch("deckmaster.game.engine.request", side_effect=request), mock.patch("deckmaster.game.traceback.print_exc"):
            game.safe_open(t.begin(), "test", [], None, "creatures")
        version, snap = t.wait(1, timeout=0)
        self.assertEqual(version, 2)
        self.assertEqual(snap, {"state": "error", "gen": 1, "error": failure, "answer": None})
        self.assertEqual(calls[-1], ("table", True))

    def test_no_first_view_publishes_start_error(self):
        t = game.Table()
        gen = t.begin()
        with mock.patch.object(engine, "engine_pid", return_value=123), mock.patch.object(engine, "process_alive", return_value=False), \
                mock.patch.object(engine, "request", side_effect=engine.EngineError("engine closed the connection")):
            t.watch(gen, "s1")
        _, snap = t.wait(1, timeout=0)
        self.assertEqual((snap["state"], snap["gen"], snap["error"]), ("error", gen, "engine closed the connection"))

    def test_empty_view_does_not_hide_a_subsequent_start_failure(self):
        t = game.Table()
        gen = t.begin()
        replies = [{"view": {}}, {"view": {}, "over": "error: table initialization failed"}]
        with mock.patch.object(game.time, "sleep"), mock.patch.object(engine, "request", side_effect=replies):
            t.watch(gen, "s1")
        version, snap = t.wait(1, timeout=0)
        self.assertEqual(version, 2)
        self.assertEqual((snap["state"], snap["gen"]), ("error", gen))

    def test_silent_peer_times_out_table_and_view_reads(self):
        commands = []
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp, socket.socket(socket.AF_UNIX) as peer:
            path = pathlib.Path(tmp) / "table.sock"
            peer.bind(str(path))
            peer.listen()
            peer.settimeout(2)

            def listen():
                for _ in range(2):
                    conn, _ = peer.accept()
                    with conn, conn.makefile("rb") as stream:
                        conn.settimeout(2)
                        cmd = json.loads(stream.readline())["cmd"]
                        commands.append((cmd, conn.recv(1)))

            worker = threading.Thread(target=listen, daemon=True)
            worker.start()
            with mock.patch.multiple(engine, HOME=path.parent, SOCKET=path, REQUEST_TIMEOUTS={"table": 0.05, "view": 0.05}):
                for cmd in ("table", "view"):
                    with self.assertRaisesRegex(engine.EngineTimeout, f"engine timed out on {cmd}"):
                        engine.request({"cmd": cmd}, start=False)
            worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
        self.assertEqual(commands, [(cmd, b"") for cmd in ("table", "view")])

    def test_replacement_and_timed_out_creation_wait_for_table_to_close(self):
        t = game.Table()
        commands = []

        def request(req, start=True):
            cmd = req["cmd"]
            commands.append(cmd)
            if cmd == "table":
                raise engine.EngineTimeout("creation timed out")
            return {"state": "no table"}

        with mock.patch.multiple(game, TABLE=t, ARGS=mock.Mock(table_port=18000)), \
                mock.patch.object(engine, "SOCKET", mock.Mock(**{"exists.return_value": True})), \
                mock.patch("deckmaster.game.decks.get"), mock.patch("deckmaster.game.model.key"), \
                mock.patch.object(engine, "request", side_effect=request), mock.patch.object(game.traceback, "print_exc"):
            game.safe_open(t.begin(), "test", [], None, "creatures")
        self.assertEqual(commands, ["table_end", "table_state", "table", "table_end", "table_state"])
        self.assertEqual(t.snapshot["error"], "creation timed out")
        self.assertFalse(t.start_lock.locked())

    def test_responsive_empty_views_can_wait_past_the_old_start_limit(self):
        t = game.Table()
        gen = t.begin()
        seen = []

        def request(req, start=True):
            seen.append(t.snapshot["state"])
            return {"view": {}} if len(seen) < 3 else {"view": {"me": "You"}, "decision": PLAY}

        def pause(delay):
            if len(seen) == 3:
                self.assertEqual(t.snapshot["decision"], PLAY)
                t.begin()

        with mock.patch.object(game.time, "monotonic", side_effect=[0, 0, 61, 62]), \
                mock.patch.object(game.time, "time", side_effect=[0, 0, 61, 62]), \
                mock.patch.object(game.time, "sleep", side_effect=pause), mock.patch.object(engine, "request", side_effect=request):
            t.watch(gen, "s1")
        self.assertEqual(seen, ["starting"] * 3)

    def test_deck_rejection_is_a_start_failure(self):
        t = game.Table()
        gen = t.begin()
        msg = "could not start (a deck failed the lobby's checks)"
        with mock.patch.object(engine, "request", return_value={"view": {}, "over": msg, "startFailure": "deck"}):
            t.watch(gen, "s1")
        version, snap = t.wait(1, timeout=0)
        self.assertEqual(version, 2)
        self.assertEqual(snap, {"state": "error", "gen": gen, "error": msg, "answer": None, "startFailure": "deck"})

    def test_generic_lobby_refusal_does_not_blame_a_deck(self):
        t = game.Table()
        gen = t.begin()
        message = "table couldn't start"
        with mock.patch.object(engine, "request", return_value={"view": {}, "over": message, "startFailure": "engine"}):
            t.watch(gen, "s1")
        self.assertEqual(t.snapshot["state"], "error")
        self.assertEqual(t.snapshot["startFailure"], "engine")
        self.assertEqual(t.snapshot["error"], message)

    def test_stale_pid_does_not_remove_a_live_listener(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp, socket.socket(socket.AF_UNIX) as peer:
            root = pathlib.Path(tmp)
            path = root / "engine.sock"
            peer.bind(str(path))
            peer.listen()
            pid_file = path.with_suffix(".pid")
            pid_file.write_text(str(os.getpid()))  # This process owns the listener, but it is not the JVM.
            with mock.patch.multiple(engine, HOME=root, SOCKET=path, STOP_GRACE_SECONDS=0), \
                    mock.patch.object(engine, "request", side_effect=engine.EngineTimeout("shutdown timed out")), \
                    mock.patch.object(engine.os, "kill") as kill:
                with self.assertRaisesRegex(engine.EngineError, "cannot confirm engine shutdown"):
                    engine.stop()
                kill.assert_not_called()
            self.assertTrue(path.is_socket())
            self.assertTrue(pid_file.exists())

    def test_long_socket_path_fails_before_starting_java(self):
        with mock.patch.object(engine, "SOCKET", pathlib.Path("/tmp") / ("a" * 108)):
            with self.assertRaisesRegex(engine.EngineError, "socket path too long"):
                engine._start()


if __name__ == "__main__":
    unittest.main()
