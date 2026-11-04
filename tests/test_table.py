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

    def test_blocks_offer_each_single_block(self):
        decision = {"kind": "block", "options": ["Wurm 6/4 blocks Bear 2/2", "Elf 1/1 blocks Bear 2/2"]}
        self.assertEqual(table_model.block_lines(decision), {"Wurm 6/4 blocks Bear 2/2": ["Wurm 6/4 blocks Bear 2/2"],
                                                             "Elf 1/1 blocks Bear 2/2": ["Elf 1/1 blocks Bear 2/2"],
                                                             "no blocks": []})
        decider = table_model.TableDecider("", 2, model.Usage())
        lines = decider.lines(decision)
        self.assertEqual(decider.line_name(decision, [], lines), "no blocks")
        self.assertEqual(decider.line_name(decision, decision["options"], lines), "the blocks Forge's AI would make")

    def test_other_players_turns_are_looked_ahead_on(self):
        decider = table_model.TableDecider("", 2, model.Usage())
        theirs = {"kind": "play", "turn": "T3 Ana end", "mine": False}
        self.assertFalse(model.ours(theirs))
        self.assertTrue(decider.explores(theirs))
        self.assertIn("end of another player's turn", decider.instructions(theirs, STATE))
        self.assertIn("respond", decider.instructions(theirs, dict(STATE, stack=["Lightning Bolt"])))
        self.assertIn("attacking you", decider.instructions(dict(theirs, turn="T3 Ana attackers"), STATE))
        self.assertFalse(model.Decider("", 3, model.Usage()).explores(theirs))
        self.assertTrue(model.ours({"kind": "play", "turn": "T3 main1"}))  # decisions recorded before the flag

    def test_combat_is_shown(self):
        self.assertEqual(table_model.render._permanent({"name": "Bear", "pt": "2/2", "tapped": True, "attacking": "you"}),
                         "Bear 2/2 (tapped, attacking you)")
        self.assertEqual(table_model.render._permanent({"name": "Wurm", "pt": "6/4", "blocking": ["Bear"]}),
                         "Wurm 6/4 (blocking Bear)")

    def test_a_line_shows_everyones_life(self):
        before = dict(STATE, battlefield=[])
        after = dict(before, life=35, opponents=[{"name": "Ana", "life": 33}, {"name": "Bo", "life": 40}])
        line = model.Line([], [], after, None, 0)
        text = table_model.TableDecider("", 2, model.Usage()).result(before, line, 3)
        self.assertTrue(text.endswith("; life: you 35, Ana 33, Bo 40"))

    def test_a_line_names_what_each_player_lost(self):
        before = dict(STATE, battlefield=[{"name": "Forest"}, {"name": "Craw Wurm", "pt": "6/4"}],
                      opponents=[{"name": "Ana", "life": 40, "battlefield": [{"name": "Typhoid Rats", "pt": "1/1"}]}])
        after = dict(before, battlefield=[{"name": "Forest"}], opponents=[{"name": "Ana", "life": 40, "battlefield": []}])
        text = table_model.TableDecider("", 1, model.Usage()).result(before, model.Line([], [], after, None, 0), 3)
        self.assertIn("; gone: your Craw Wurm, Ana's Typhoid Rats; life: you 38, Ana 40", text)

    def test_a_line_says_what_could_attack_back(self):
        eot = {"t": "eot", "turn": 3, "lands": 3, "mana": 3, "unspent": 0, "hand": 1, "creatures": 1, "power": 6,
               "permanents": 1, "untapped": 0, "others_power": {"Ana": 0, "Bo": 6}}
        line = model.Line([], [eot], dict(STATE, opponents=[]), None, 0)
        text = table_model.TableDecider("", 2, model.Usage()).result(dict(STATE, opponents=[]), line, 3)
        self.assertIn("; until your next turn: 0 of your creatures untapped to block; the others' creatures could attack you "
                      "for Ana 0, Bo 6", text)

    def test_a_line_says_what_mana_went_unused_before_the_turn(self):
        line = model.Line([], [{"t": "held", "turn": 3, "unspent": 4}], dict(STATE, opponents=[]), None, 0)
        text = table_model.TableDecider("", 2, model.Usage()).result(dict(STATE, opponents=[]), line, 3)
        self.assertIn("; leaves 4 mana unspent before your turn", text)


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
