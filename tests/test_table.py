import unittest

from goldfish import model, table_model, table_report

STATE = {"turn": "T3 main1", "life": 38, "mana": 3, "library": 90, "hand": ["Forest"], "land_drop": False,
         "battlefield": [{"name": "Forest"}], "command": ["Marath, Will of the Wild"], "graveyard": [], "exile": [],
         "stack": [], "opponents": [
             {"name": "Ana", "life": 33, "lands": 3, "other": 2, "hand": 4,
              "battlefield": [{"name": "Grizzly Bears", "pt": "2/2"}, {"name": "Sol Ring", "tapped": True}],
              "command": ["Atraxa, Praetors' Voice"]},
             {"name": "Bo", "life": 40, "lands": 2, "other": 0, "hand": 6, "battlefield": [], "command": []}]}


class TableDeciderTest(unittest.TestCase):
    def test_the_model_reads_the_table_and_the_other_players(self):
        decider = table_model.TableDecider("Ramp, then win with Marath.", 2, model.Usage())
        text = decider.context(STATE, {"kind": "play", "turn": "T3 main1"}, "", None)
        self.assertIn("who play their own decks", text)
        self.assertNotIn("never block", text)
        self.assertIn("Ana: life 33, 4 cards in hand, 3 lands; board: Grizzly Bears 2/2, Sol Ring (tapped); "
                      "in the command zone: Atraxa", text)
        self.assertIn("Bo: life 40, 6 cards in hand, 2 lands; board: nothing but lands", text)

    def test_goldfish_reading_is_unchanged(self):
        text = model.Decider("Ramp.", 3, model.Usage()).context(STATE, {"kind": "play", "turn": "T3 main1"}, "", None)
        self.assertIn("never block or interact", text)
        self.assertNotIn("Ana", text)

    def test_attacks_offer_each_opponent(self):
        decision = {"kind": "attack", "options": ["Bear 2/2 -> Ana", "Bear 2/2 -> Bo", "Elf 1/1 -> Ana"]}
        lines = table_model.attack_lines(decision)
        self.assertEqual(lines, {"attack Ana with everything that can": ["Bear 2/2 -> Ana", "Elf 1/1 -> Ana"],
                                 "attack Bo with everything that can": ["Bear 2/2 -> Bo"], "no attack": []})
        decider = table_model.TableDecider("", 2, model.Usage())
        self.assertEqual(decider.line_name(decision, ["Bear 2/2 -> Bo"], lines), "attack Bo with everything that can")
        self.assertEqual(decider.line_name(decision, ["Elf 1/1 -> Ana"], lines), "the attack Forge's AI would make")


class TableReportTest(unittest.TestCase):
    def test_life_by_round_and_seat_summary(self):
        facts = [{"t": "start", "turn": 0, "deck": "d", "commander": "Marath, Will of the Wild"},
                 {"t": "decision", "turn": 1, "kind": "play", "by": "model"},
                 {"t": "life", "turn": 1, "player": "Ana", "life": 37},
                 {"t": "cast", "turn": 2, "card": "Marath, Will of the Wild", "by": "model"},
                 {"t": "fork", "turn": 2, "session": "g2"}, {"t": "fork", "turn": 2, "refused": "others acted"},
                 {"t": "eot", "turn": 2, "lands": 2, "mana": 3, "hand": 5, "creatures": 1, "power": 3, "permanents": 0},
                 {"t": "end", "turn": 2, "reason": "over: a draw"}]
        rounds = table_report.life_by_round(facts, ["Me", "Ana"])
        self.assertEqual(rounds[2], {"Me": 40, "Ana": 37})
        s = table_report.seat_summary(facts)
        self.assertEqual((s["commander_turn"], s["forks"], s["forks_refused"], s["by"]), (2, 1, 1, {"model": 1}))


if __name__ == "__main__":
    unittest.main()
