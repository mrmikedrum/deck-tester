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


class MulliganFactsTest(unittest.TestCase):
    def test_lands_colours_and_cards_the_lands_cannot_cast(self):
        state = {"hand": ["Forest", "Temple Garden", "Sol Ring", "Counterspell", "Llanowar Elves"],
                 "text": {"Temple Garden": "Temple Garden — Land - Forest Plains — ({T}: Add {G} or {W}.) As Temple Garden enters…",
                          "Sol Ring": "Sol Ring {1} — Artifact — {T}: Add {C}{C}.",
                          "Counterspell": "Counterspell {U}{U} — Instant — Counter target spell.",
                          "Llanowar Elves": "Llanowar Elves {G} — Creature - Elf Druid — {T}: Add {G}."}}
        self.assertEqual(model.mulligan_facts(state),
                         "Lands in hand: 2 of 5, making W G. Cards needing a colour not directly shown by these lands: Counterspell.")

    def test_a_played_out_line_hides_what_was_drawn(self):
        before = {"battlefield": [], "opponents": [{"life": 40}], "text": {}}
        line = model.summarize(before, [{"t": "draw", "turn": 2, "card": "Sol Ring"}, {"t": "cast", "turn": 2, "card": "Cultivate"}],
                               {"battlefield": [], "opponents": [{"life": 40}], "mana": 2}, 2)
        self.assertEqual(line["acts"], "drew a card · cast Cultivate")


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



class AdviceTest(unittest.TestCase):
    def test_rules_match_cards_and_roles_by_zone_and_what_is_castable(self):
        from goldfish.advice import Advisor, text_matches
        adv = Advisor()
        adv.role("doubler", "Parallel Lives", text=text_matches("twice that many"))
        adv.when("doubled", board=["doubler"], castable_from={"command": ["Marath, Will of the Wild"]})
        adv.when("from the yard", castable_from={"graveyard": ["Fertilid"]})
        adv.when(lambda p: f"{p.counters('Marath, Will of the Wild')} counters", board=["Marath, Will of the Wild"], test=lambda p: p.mana > 0)
        state = {"battlefield": [{"name": "Doubling Season"}, {"name": "Marath, Will of the Wild", "counters": {"P1P1": 2}}], "hand": [],
                 "graveyard": ["Fertilid"], "command": [], "mana": 3,
                 "text": {"Doubling Season": "Doubling Season {4}{G} — Enchantment — … creates twice that many of those tokens instead."}}
        decision = {"kind": "play", "options": ["pass", "Fertilid (from graveyard)", "Marath, Will of the Wild (commander)"]}
        self.assertEqual(adv.advise(state, decision, []), "doubled from the yard 2 counters")
        self.assertIsNone(adv.advise(state, {"kind": "targets", "options": ["you"]}, []))
        self.assertIsNone(adv.advise(dict(state, battlefield=[]), decision, []).replace("from the yard", "").strip() or None)


class AfterLineTest(unittest.TestCase):
    def test_the_line_names_the_board_it_leads_to_without_naming_draws(self):
        before = {"battlefield": [{"name": "Forest"}], "text": {"Sol Ring": "Sol Ring {1} — Artifact — {T}: Add {C}{C}."}}
        facts = [{"t": "draw", "turn": 2, "card": "Cultivate"}, {"t": "cast", "turn": 2, "card": "Sol Ring"},
                 {"t": "eot", "turn": 2, "unspent": 0}]
        after = {"battlefield": [{"name": "Forest"}, {"name": "Plains"}, {"name": "Sol Ring"}], "mana": 4, "hand": ["Cultivate", "Elves"]}
        self.assertEqual(model.after_line(before, facts, after, 2),
                         "drew a card · cast Sol Ring; after: 2 lands, 4 mana next turn, 2 cards in hand; 0 mana unspent this turn; board: Sol Ring")


class PilotingRegressionTest(unittest.TestCase):
    def test_goldfish_goal_is_engine_development_not_incidental_damage(self):
        self.assertNotIn("win fast", model.GAME)
        self.assertIn("Follow the deck plan", model.GAME)

    def test_number_samples_keep_small_positive_and_both_bounds(self):
        for low, high in [(0, 40), (0, 19), (2, 40), (1, 99)]:
            values = [a[0] for a in model.lines_to_try(decision("number", [], low, high)).values()]
            self.assertLessEqual(len(values), model.MAX_LINES)
            self.assertIn(low, values)
            self.assertIn(high, values)
            if low <= 1 <= high:
                self.assertIn(1, values)
        self.assertIn("zero", model.instructions(decision("number", [], 0, 40)))

    def test_london_bottoms_are_model_choices_without_previewing_draws(self):
        d = decision("choose", ["Forest", "Plains", "Sol Ring", "Sunfall"], 2, 2, prompt="put 2 on the bottom")
        options = model.plain_options(d)
        self.assertEqual(len(options), 6)
        self.assertIn(["Sol Ring", "Sunfall"], options.values())
        self.assertEqual(model._numbers(d, ["Sol Ring", "Sunfall"]), [3, 4])
        self.assertEqual(model.lines_to_try(d), {})
        self.assertIn("only source", model.instructions(d))
        d["prompt"] = "choose cards to exile"
        self.assertIsNone(model.plain_options(d))

    def test_fetch_access_is_not_claimed_impossible(self):
        state = {"hand": ["Misty Rainforest", "Sol Ring"], "text": {
            "Misty Rainforest": "Misty Rainforest — Land — Search your library for a Forest or Island card.",
            "Sol Ring": "Sol Ring {1} — Artifact — Add {C}{C}."}}
        self.assertIn("only if suitable targets remain", model.mulligan_facts(state))

    def test_fork_result_shows_counter_fuel_and_self_losses(self):
        before = {"battlefield": [{"name": "Hangarback Walker", "id": 7}, {"name": "Forest", "id": 8}], "text": {}}
        after = {"battlefield": [{"name": "Incubator Token", "id": 9, "counters": {"+1/+1": 3}, "token": True}],
                 "mana": 1, "hand": []}
        facts = [{"t": "activate", "turn": 7, "card": "Reckoner Bankbuster", "failed": True}]
        text = model.after_line(before, facts, after, 7)
        self.assertIn("[+1/+1 3]", text)
        self.assertIn("you lose your own Hangarback Walker", text)
        self.assertNotIn("you lose your own Forest", text)
        self.assertIn("1 failed action", text)


class OpeningPolicyTest(unittest.TestCase):
    def test_extreme_seven_card_hands_redraw_but_london_has_a_floor(self):
        self.assertEqual(model.mulligan_policy({"hand": ["Forest"] * 7}), "mulligan")
        self.assertEqual(model.mulligan_policy({"hand": ["Forest"] + ["Sol Ring"] * 6}), "mulligan")
        self.assertIsNone(model.mulligan_policy({"hand": ["Forest"] * 3 + ["Sol Ring"] * 4}))
        for size in range(5):
            self.assertEqual(model.mulligan_policy({"hand": ["Sol Ring"] * size}), "keep")

    def test_keep_instructions_judge_already_bottomed_hand(self):
        d = decision("mulligan", ["keep", "mulligan"], prompt="keep this hand (then bottom 2)")
        text = model.instructions(d, {"hand": ["Forest"] * 2 + ["Sol Ring"] * 3})
        self.assertIn("these 5 cards", text)
        self.assertIn("already bottomed", text)
        self.assertNotIn("two to four", text)

    def test_three_card_bottom_does_not_fall_back_to_forge(self):
        d = decision("choose", list("ABCDEFG"), 3, 3, prompt="put 3 on the bottom")
        self.assertEqual(len(model.plain_options(d)), 35)

    def test_extreme_hand_uses_logged_policy_not_a_model_call(self):
        from unittest.mock import patch
        d = decision("mulligan", ["keep", "mulligan"])
        decider = model.Decider("Develop.", 3, model.Usage())
        with patch.object(model.engine, "request", return_value={"state": {"hand": ["Forest"] * 7}}), \
             patch.object(model, "call") as call, patch.object(decider, "send", return_value={}) as send:
            decider.step({"decision": d, "session": "test"})
        call.assert_not_called()
        self.assertEqual(send.call_args[0][1], {"answer": [2], "by": "policy"})


class FailureFeedbackTest(unittest.TestCase):
    def test_actual_failure_is_not_retried_until_observed_state_changes(self):
        decider = model.Decider("Develop.", 3, model.Usage())
        state = {"mana": 3, "battlefield": []}
        self.assertEqual(decider.rejected_plays("test", state, []), set())
        facts = [{"t": "activate", "as": "Vehicle: Crew 3", "failed": True}]
        self.assertEqual(decider.rejected_plays("test", state, facts), {"Vehicle: Crew 3"})
        self.assertEqual(decider.rejected_plays("test", state, facts), {"Vehicle: Crew 3"})
        self.assertEqual(decider.rejected_plays("test", dict(state, mana=4), facts), set())
        self.assertEqual(decider.rejected_plays("other", state, facts), set())

    def test_failed_crew_with_only_pass_remaining_is_a_logged_policy_pick(self):
        from unittest.mock import patch
        d = decision("play", ["pass", "Vehicle: Crew 3"])
        state = {"turn": "T2 main1", "life": 40, "mana": 2, "library": 90, "hand": [], "battlefield": [],
                 "command": [], "graveyard": [], "exile": [], "stack": [], "opponents": [], "text": {}}
        decider = model.Decider("Develop.", 3, model.Usage(), hybrid="plain")
        decider.rejected_plays("test", state, [])
        facts = [{"t": "activate", "turn": 2, "as": "Vehicle: Crew 3", "card": "Vehicle", "failed": True}]
        with patch.object(model.engine, "request", return_value={"state": state}), \
             patch.object(model.records, "load", return_value=facts), patch.object(model, "call") as call, \
             patch.object(decider, "send", return_value={}) as send:
            decider.step({"decision": d, "session": "test", "records": "unused"})
        call.assert_not_called()
        self.assertEqual(send.call_args[0][1], {"answer": [1], "by": "policy"})


class CounterLandContextTest(unittest.TestCase):
    def test_lands_with_engine_counters_are_visible_in_outcomes(self):
        before = {"battlefield": [], "text": {"World": "World — Land — Station 12."}}
        after = {"battlefield": [{"name": "World", "counters": {"Charge": 11}}], "mana": 3, "hand": []}
        self.assertIn("World [Charge 11]", model.after_line(before, [], after, 2))

    def test_empty_opponent_warning_is_goldfish_only(self):
        state = {"turn": "T2 main1", "life": 40, "mana": 2, "library": 90, "hand": [], "battlefield": [],
                 "command": [], "graveyard": [], "exile": [], "stack": [], "opponents": [
                     {"name": "Opp 1", "life": 40, "lands": 2, "other": 0}], "text": {}}
        d = decision("play", ["pass"])
        self.assertIn("wipe would remove only your own", model.describe("Develop.", state, d, 3))
        self.assertNotIn("wipe would remove only your own", model.describe("Develop.", state, d, 3, table="Table {opponents}"))


class ImpulseOutcomeTest(unittest.TestCase):
    def test_impulse_stock_is_visible_without_claiming_it_is_playable(self):
        before = {"battlefield": [], "text": {}}
        after = {"battlefield": [], "mana": 6, "hand": [], "exile": ["Swords to Plowshares", "Incubation Druid"]}
        text = model.after_line(before, [], after, 6)
        self.assertIn("2 cards remain in exile", text)
        self.assertIn("not hand cards", text)
        self.assertIn("permissions/duration depend", text)
        self.assertNotIn("Swords to Plowshares", text)


class CapturedOpeningRegressionTest(unittest.TestCase):
    def test_exact_b226_one_and_seven_land_hands_are_redrawn(self):
        import json
        from pathlib import Path
        situations = Path(__file__).resolve().parent.parent / "bench" / "situations"
        for source in ["g89171", "g89695"]:
            case = json.loads((situations / f"eternities-audit-{source}-T0-mulligan.json").read_text())
            self.assertEqual(model.mulligan_policy(case["state"]), "mulligan")


if __name__ == "__main__":
    unittest.main()
