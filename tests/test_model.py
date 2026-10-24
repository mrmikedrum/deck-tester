"""What the decision model reads and how its picks map back to options, without calling the API."""

import unittest

from goldfish import model


def decision(kind, options, low=1, high=1, details=None, repeat=False, prompt=""):
    return {"kind": kind, "turn": "T2 main1", "prompt": prompt, "options": options, "details": details,
            "min": low, "max": high, "repeat": repeat}


def board(*permanents, mana=3, life=120):
    return {"mana": mana, "battlefield": [{"name": n} for n in permanents],
            "opponents": [{"life": life}], "text": {"Misty Rainforest": "Misty Rainforest — Land — {T}, Pay 1 life…"}}


class LinesTest(unittest.TestCase):
    def test_single_picks_play_out_each_distinct_option_and_nothing_when_optional(self):
        tries = model.lines_to_try(decision("targets", ["Bear", "Bear", "you"], low=0))
        self.assertEqual(tries, {"Bear": ["Bear"], "you": ["you"], "nothing": []})

    def test_attacks_compare_everything_with_nothing_one_defender_each(self):
        tries = model.lines_to_try(decision("attack", ["Bear -> Opp 1", "Bear -> Opp 2", "Elk -> Opp 1"], 0, 3))
        self.assertEqual(tries, {"attack with everything": ["Bear -> Opp 1", "Elk -> Opp 1"], "no attack": []})

    def test_wide_numbers_are_sampled_and_too_many_options_are_not_played_out(self):
        self.assertLessEqual(len(model.lines_to_try(decision("number", [], 0, 40))), model.MAX_LINES)
        self.assertEqual(model.lines_to_try(decision("play", [f"card {i}" for i in range(12)])), {})

    def test_orderings_repeats_payment_and_long_lists_go_to_forge(self):
        self.assertIsNone(model.plain_options(decision("order", ["a", "b"], 2, 2)))
        self.assertIsNone(model.plain_options(decision("mode", ["a", "b"], 1, 3, repeat=True)))
        self.assertIsNone(model.plain_options(decision("pay", ["Forest", "Elves"], 0, 2)))
        self.assertIsNone(model.plain_options(decision("number", [], 0, 40)))
        self.assertIsNone(model.plain_options(decision("choose", [f"type {i}" for i in range(40)])))

    def test_forges_pick_is_named_like_the_lines_tried(self):
        self.assertEqual(model.line_name(decision("attack", ["Bear -> Opp 1"], 0, 1), ["Bear -> Opp 1"], {}), "attack with everything")
        self.assertEqual(model.line_name(decision("number", [], 0, 5), ["3"], {}), "X = 3")
        self.assertEqual(model.line_name(decision("targets", ["Bear", "you"], 0, 1), [], {}), "nothing")
        self.assertEqual(model.line_name(decision("play", ["pass", "Sol Ring"]), ["Sol Ring"], {}), "Sol Ring")

    def test_option_text_is_the_full_text_but_never_for_pass(self):
        d = decision("play", ["pass", "Sol Ring"], details=["pass priority", "Sol Ring {1} — Artifact — {T}: Add {C}{C}."])
        self.assertEqual(model.option_text(d, "pass"), "pass")
        self.assertTrue(model.option_text(d, "Sol Ring").startswith("Sol Ring {1}"))


class ResultsTest(unittest.TestCase):
    def test_results_compare_in_words_and_flag_losing_our_own_permanents(self):
        before = board("Misty Rainforest", "Spirit Token")
        ramp = model.summarize(before, [{"t": "cast", "turn": 2, "card": "Sol Ring"}],
                               board("Misty Rainforest", "Spirit Token", "Sol Ring", mana=5), 2)
        removal = model.summarize(before, [{"t": "cast", "turn": 2, "card": "Swords to Plowshares"}],
                                  board("Misty Rainforest", mana=3), 2)
        fetch = model.summarize(before, [], board("Spirit Token", "Plains", mana=4), 2)
        words = model.worded({"Sol Ring": ramp, "Swords": removal, "fetch": fetch})
        self.assertIn("the most mana next turn", words["Sol Ring"])
        self.assertIn("adds Sol Ring", words["Sol Ring"])
        self.assertIn("you lose your own Spirit Token", words["Swords"])
        self.assertNotIn("lose your own", words["fetch"])  # a fetch land leaving is the fetch working
        self.assertNotIn("damage", words["fetch"])  # no option deals damage, so damage isn't mentioned

    def test_a_line_that_ends_the_game_says_so(self):
        self.assertEqual(model.worded({"win": None}), {"win": "the game ends"})


class ContextTest(unittest.TestCase):
    def test_the_board_leaves_out_opponents_exile_and_library(self):
        state = {"turn": "T2 main1", "life": 40, "mana": 2, "library": 90, "hand": ["Sol Ring"], "battlefield": [],
                 "command": [], "graveyard": [], "exile": ["X"], "stack": [], "opponents": [
                     {"name": "Opp 1", "life": 40, "lands": 2, "other": 0}], "text": {}}
        text = model.describe("Ramp.", state, decision("play", ["pass"]), 3, "T2 drew Forest")
        self.assertNotIn("library", text)
        self.assertNotIn("opponents:", text)
        self.assertNotIn("exile", text)
        self.assertIn("This turn so far: T2 drew Forest", text)


if __name__ == "__main__":
    unittest.main()
