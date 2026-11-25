"""The capture harness's own housekeeping (tests/protocol_capture.py), without Forge: its private engine never touches
the developer's, and saving a corpus replaces only the corpus it replaces."""
import json
import pathlib
import tempfile
import unittest
from unittest import mock

from deckmaster import engine

from tests import protocol_capture as pc

GLOBALS = ("HOME", "FORGE_BUILD", "SOCKET", "LOG", "MODE")


class TableEngineTest(unittest.TestCase):
    def setUp(self):
        self.before = {k: getattr(engine, k) for k in GLOBALS}
        self.stopped_at = []

    def tearDown(self):
        for k, v in self.before.items():   # whatever happened, leave the module as it was
            setattr(engine, k, v)

    def stop(self):
        self.stopped_at.append(engine.SOCKET)

    def test_a_failed_setup_stops_only_the_private_engine(self):
        with mock.patch.object(pc.shutil, "copy2", side_effect=OSError("no forge build")), \
                mock.patch.object(engine, "stop", side_effect=self.stop):
            with self.assertRaises(OSError):
                with pc.table_engine():
                    self.fail("never entered")
        self.assertTrue(self.stopped_at)
        for socket in self.stopped_at:
            self.assertNotEqual(socket, self.before["SOCKET"])
            self.assertIn("protocol-capture-", str(socket))
        self.assertEqual({k: getattr(engine, k) for k in GLOBALS}, self.before)

    def test_the_globals_come_back_even_when_stopping_fails(self):
        with mock.patch.object(pc.shutil, "copy2"), \
                mock.patch.object(engine, "stop", side_effect=RuntimeError("stuck")):
            with self.assertRaises(RuntimeError):
                with pc.table_engine():
                    self.assertEqual(engine.MODE, ["table"])
                    self.assertIn("protocol-capture-", str(engine.SOCKET))
        self.assertEqual({k: getattr(engine, k) for k in GLOBALS}, self.before)


def envelope(state, v):
    return {"state": state, "gen": None, "v": v, "error": None, "answer": None}


class Captured:
    seed = 7
    observed = []


class SaveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = pathlib.Path(self.tmp.name) / "protocol"
        self.out.mkdir()
        # the last corpus: two envelopes listed in its index, and files that are not the corpus's
        (self.out / "001-old.json").write_text("{}")
        (self.out / "002-old.json").write_text("{}")
        (self.out / "index.json").write_text(json.dumps({"files": {"001-old.json": {}, "002-old.json": {}}}))
        (self.out / "README.md").write_text("what the corpus holds")
        (self.out / "notes.json").write_text('{"mine": true}')

    def tearDown(self):
        self.tmp.cleanup()

    def names(self):
        return sorted(p.name for p in self.out.iterdir())

    def test_only_the_last_corpus_is_replaced(self):
        index = pc.save(self.out, Captured(), [("no game", envelope("no game", 0)), ("starting", envelope("starting", 1))])
        self.assertEqual(sorted(index["files"]), ["001-no-game.json", "002-starting.json"])
        self.assertEqual(self.names(), ["001-no-game.json", "002-starting.json", "README.md", "index.json", "notes.json"])
        self.assertEqual(json.loads((self.out / "notes.json").read_text()), {"mine": True})
        self.assertEqual(json.loads((self.out / "index.json").read_text())["files"], index["files"])
        self.assertEqual([p.name for p in self.out.parent.iterdir()], ["protocol"])   # no staging left behind

    def test_a_failed_save_leaves_the_last_corpus_whole(self):
        before = {p.name: p.read_text() for p in self.out.iterdir()}
        with mock.patch.object(pc, "trim", side_effect=[envelope("no game", 0), ValueError("boom")]):
            with self.assertRaises(ValueError):
                pc.save(self.out, Captured(), [("no game", envelope("no game", 0)), ("starting", envelope("starting", 1))])
        self.assertEqual({p.name: p.read_text() for p in self.out.iterdir()}, before)
        self.assertEqual([p.name for p in self.out.parent.iterdir()], ["protocol"])

    def test_a_new_file_never_overwrites_one_the_last_corpus_did_not_list(self):
        (self.out / "001-no-game.json").write_text('{"hand": "made"}')
        before = {p.name: p.read_text() for p in self.out.iterdir()}
        with self.assertRaises(FileExistsError):
            pc.save(self.out, Captured(), [("no game", envelope("no game", 0))])
        self.assertEqual({p.name: p.read_text() for p in self.out.iterdir()}, before)


if __name__ == "__main__":
    unittest.main()
