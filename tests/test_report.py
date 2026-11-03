import tempfile
import unittest
from pathlib import Path

from goldfish import batch, report


def eot(turn, lands, mana, unspent, opponents_life):
    return {"t": "eot", "turn": turn, "lands": lands, "mana": mana, "unspent": unspent, "hand": 5,
            "creatures": 0, "permanents": 0, "opponents_life": opponents_life}


GAME = [
    {"t": "start", "turn": 0, "seed": 7, "opponents": 3},
    {"t": "decision", "turn": 0, "kind": "mulligan", "answer": ["mulligan"], "by": "ai"},
    {"t": "land", "turn": 1, "card": "Forest", "id": 1},
    eot(1, 1, 1, 1, 120),
    {"t": "cast", "turn": 2, "card": "Marath, Will of the Wild", "id": 2, "by": "agent"},
    eot(2, 1, 1, 0, 117),
]


class SummaryTest(unittest.TestCase):
    def test_game_summary(self):
        s = report.game_summary(GAME, ["Marath, Will of the Wild"])
        self.assertEqual(s["commander"], 2)
        self.assertEqual(s["missed"], [2])
        self.assertEqual(s["mulligans"], 1)
        self.assertEqual(s["damage"], {1: 0, 2: 3})

    def test_forks_and_lost_lookahead(self):
        def fork(turn, failed=None):
            return {"t": "fork", "turn": turn, "session": "g9", "failed": failed}

        stray = report.game_summary(GAME + [fork(1), fork(1, "drift"), fork(2), fork(2)], [])
        self.assertEqual((stray["forks"], stray["forks_failed"], stray["blind"]), (4, 1, None))
        # Every fork failing from a turn on means the game left its own replay there.
        blind = report.game_summary(GAME + [fork(1), fork(1, "drift"), fork(1), fork(2, "x"), fork(2, "x"), fork(3, "x")], [])
        self.assertEqual((blind["forks_failed"], blind["blind"]), (4, 2))
        manifest = {"id": "b1", "deck": "d", "hash": "h", "turns": 2, "seconds": 1.0,
                    "model": {"model": "m", "calls": 1, "cost": 0.0, "seconds_per_call": 0.1, "drifted": 2},
                    "games": [{"seed": 7, "session": "g1"}]}
        text = "\n".join(report.summary(manifest, [blind]))
        self.assertIn("forks: 4 of 6 drifted", text)
        self.assertIn("g1 from T2", text)

    def test_report_lines(self):
        manifest = {"id": "b1", "deck": "marath", "hash": "abc", "pilot": None, "turns": 2, "seconds": 1.0,
                    "ai_avoids": ["Marath, Will of the Wild"], "games": [{"seed": 7, "session": "g1"}]}
        lines = report.summary(manifest, [report.game_summary(GAME, ["Marath, Will of the Wild"])])
        self.assertEqual(lines[0], "b1 · marath@abc · 1 games · seeds 7-7 · Forge AI · to turn 2 · 1.0s")
        self.assertIn("Forge's AI doesn't play: Marath", lines[1])
        self.assertTrue(lines[3].startswith("lands"))
        self.assertIn("missed %", "\n".join(lines))
        self.assertIn("commander cast in 1/1 · median T2 · T2-T2", lines)


class PilotTest(unittest.TestCase):
    def test_pilot_kinds_and_answers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "pilot.py"
            path.write_text("def play(d):\n    return None\n\ndef mulligan(d):\n    return 1\n\nhelper = 3\n")
            handlers = batch.load_pilot(str(path))
            self.assertEqual(sorted(handlers), ["mulligan", "play"])
            self.assertEqual(batch._answer(handlers["mulligan"], {}), [1])
            self.assertIsNone(batch._answer(handlers["play"], {}))
            self.assertIsNone(batch._answer(None, {}))


if __name__ == "__main__":
    unittest.main()
