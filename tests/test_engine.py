"""End-to-end check against the real engine. Skipped when Forge isn't installed (as in CI)."""

import unittest
from pathlib import Path

from goldfish import decklist, engine, records

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


if __name__ == "__main__":
    unittest.main()
