"""End-to-end check against the real engine. Skipped when Forge isn't installed (as in CI)."""

import unittest
from pathlib import Path

from unittest import mock

from goldfish import batch, decklist, engine, model, records, report

DECK = Path(__file__).resolve().parent.parent / "examples" / "decks" / "eternities-living-worlds-iii.txt"


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ManualGameTest(unittest.TestCase):
    def test_seeded_game_keeps_lands_restores_and_records(self):
        deck = decklist.load(DECK)
        start = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 2}
        reply = engine.request(start)
        session = reply["session"]
        try:
            self.assertEqual(reply["decision"]["kind"], "mulligan")
            reply = engine.request({"cmd": "answer", "session": session, "answer": [1]})
            play = reply["decision"]
            self.assertEqual(play["kind"], "play")
            self.assertIn("Forest (land)", play["options"])

            engine.request({"cmd": "snapshot", "session": session, "name": "t1"})
            engine.request({"cmd": "answer", "session": session, "answer": [play["options"].index("Forest (land)") + 1]})
            reply = engine.request({"cmd": "restore", "session": session, "name": "t1"})
            self.assertEqual(reply["decision"]["options"], play["options"])

            fixed = engine.request({"cmd": "override", "session": session, "args": ["life", "33"]})
            self.assertEqual(fixed["result"], "You life 33")
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        facts = records.timeline(records.load(reply["records"]))
        seen, played = records.cards(facts)
        self.assertEqual(len(seen), 8)  # the opening seven and the turn-1 draw
        self.assertEqual(played, [])    # the land play was undone by the restore


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class AutomatedGameTest(unittest.TestCase):
    def test_ai_plays_a_whole_game_and_records_end_of_turn(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 5,
                                "turns": 3, "ask": [], "mana": "auto"})
        self.assertEqual(reply.get("over"), "turn limit")
        self.assertIn("Marath, Will of the Wild", reply["ai_avoids"])
        reply = engine.request({"cmd": "end", "session": reply["session"]})
        facts = records.load(reply["records"])
        self.assertEqual([f["turn"] for f in facts if f["t"] == "eot"], [1, 2, 3])

    def test_a_decision_can_be_handed_to_the_ai(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 1})
        session = reply["session"]
        try:
            self.assertEqual(reply["decision"]["kind"], "mulligan")
            reply = engine.request({"cmd": "answer", "session": session, "defer": True})
            self.assertEqual(reply["decision"]["kind"], "play")
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        decisions = [f for f in records.load(reply["records"]) if f["t"] == "decision" and f["kind"] == "mulligan"]
        self.assertEqual(decisions[-1]["by"], "ai")
        self.assertEqual(decisions[-1]["answer"], ["keep"])  # the AI's answer is recorded like anyone's


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ForkTest(unittest.TestCase):
    def test_a_fork_replays_the_recorded_decisions_into_the_same_game(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 4,
                                "ask": ["play"], "mana": "auto"})
        session = reply["session"]
        forks = []
        try:
            while reply.get("decision") and model.turn(reply["decision"]) < 3:
                reply = engine.request({"cmd": "answer", "session": session, "defer": True})
            parked = reply["decision"]
            fork = engine.request({"cmd": "fork", "session": session})
            forks.append(fork["session"])
            self.assertEqual(fork["parent"], session)
            self.assertGreaterEqual(fork["replayed"], 2)  # the mulligan and turn 1 and 2 plays, at least
            self.assertEqual(fork["decision"], parked)
            # The fork is a game of its own: answering it leaves the parent parked where it was.
            engine.request({"cmd": "answer", "session": fork["session"], "defer": True})
            self.assertEqual(engine.request({"cmd": "decision", "session": session})["decision"], parked)
        finally:
            for fork_id in forks:
                engine.request({"cmd": "end", "session": fork_id})
            reply = engine.request({"cmd": "end", "session": session})
        facts = records.load(reply["records"])
        self.assertTrue(any(f["t"] == "fork" and "failed" not in f for f in facts))


def stand_in_model(state, questions, usage=None, session=None):
    """Stands in for the decisions API: prefers anything over passing or doing nothing."""
    answers = {}
    for name, question in questions.items():
        keys = list(question["criteria"])
        ranked = [k for k in keys if k not in ("pass", "nothing", "no attack")] + \
                 [k for k in keys if k in ("pass", "nothing", "no attack")]
        answers[name] = {"choice": ranked[0], "confidence": 0.5, "probabilities": {k: 1 / len(keys) for k in keys}}
    if usage:
        usage.add({"input_tokens": len(state) // 4}, 0.0)
    return answers


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ModelGameTest(unittest.TestCase):
    def play(self, hybrid):
        with mock.patch.object(model, "call", stand_in_model), mock.patch.object(model, "key", lambda: "test"):
            return batch.run(decklist.load(DECK), "test", games=1, seed=7, turns=3, opponents=3, pilot=None,
                             workers=1, guide="Ramp, then cast Marath.", hybrid=hybrid)

    def test_options_are_played_out_in_forks_and_the_game_keeps_only_its_own_line(self):
        manifest = self.play("outcomes")
        self.assertGreater(manifest["model"]["played_out"], 0)
        self.assertEqual(manifest["model"]["drifted"], 0)
        self.assertEqual(manifest["games"][0]["over"], "turn limit")
        facts = records.load(manifest["games"][0]["records"])
        self.assertEqual([f["turn"] for f in facts if f["t"] == "eot"][:3], [1, 2, 3])
        lands = [f["turn"] for f in facts if f["t"] == "land"]
        self.assertEqual(len(lands), len(set(lands)))  # played-out lines live in the forks' records
        self.assertIn("model", {f.get("by") for f in facts if f["t"] == "decision"})
        self.assertEqual([], engine.request({"cmd": "sessions"})["sessions"])  # every fork was ended
        lines = report.build(manifest)
        self.assertTrue(any(line.startswith("decided by") for line in lines), lines)
        self.assertTrue(any(line.startswith("power") for line in lines), lines)

    def test_plain_plays_a_whole_game_without_playing_out(self):
        self.assertEqual(self.play("plain")["model"]["played_out"], 0)


if __name__ == "__main__":
    unittest.main()
