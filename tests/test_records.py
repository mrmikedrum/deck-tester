import unittest

from goldfish import records, render

FACTS = [
    {"t": "start", "turn": 0, "seed": 11},
    {"t": "draw", "turn": 0, "card": "Forest", "id": 1},
    {"t": "draw", "turn": 0, "card": "Sol Ring", "id": 2},
    {"t": "decision", "turn": 0, "kind": "mulligan", "prompt": "keep this hand", "options": 2, "answer": ["keep"], "by": "agent"},
    {"t": "turn", "turn": 1},
    {"t": "draw", "turn": 1, "card": "Forest", "id": 3},
    {"t": "land", "turn": 1, "card": "Forest", "id": 1},
    {"t": "snapshot", "turn": 1, "name": "a"},
    {"t": "cast", "turn": 1, "card": "Sol Ring", "id": 2, "as": "Sol Ring"},
    {"t": "restore", "turn": 1, "name": "a"},
    {"t": "look", "turn": 1, "cards": ["Island", "Forest"], "ids": [9, 3], "why": "scry"},
    {"t": "look", "turn": 1, "cards": ["Plains"], "ids": [10], "why": "searched (Fabled Passage)"},
    {"t": "cast", "turn": 1, "card": "Sol Ring", "id": 2, "as": "Sol Ring", "x": 2, "failed": True},
    {"t": "life", "turn": 1, "player": "Opp 1", "life": 37},
    {"t": "end", "turn": 1, "reason": "turn limit"},
]


class TimelineTest(unittest.TestCase):
    def test_restore_drops_the_abandoned_branch(self):
        kept = records.timeline(FACTS)
        self.assertFalse(any(f["t"] == "cast" and not f.get("failed") for f in kept))
        self.assertTrue(any(f["t"] == "restore" for f in kept))


class CardsTest(unittest.TestCase):
    def test_seen_counts_each_physical_card_once_and_ignores_searches(self):
        seen, played = records.cards(records.timeline(FACTS))
        self.assertEqual(seen, ["Forest", "Sol Ring", "Forest", "Island"])
        self.assertEqual(played, ["Forest"])

    def test_names_group_duplicates(self):
        self.assertEqual(records.names(["Forest", "Island", "Forest"]), "Forest x2, Island")


class DigestTest(unittest.TestCase):
    def test_one_line_per_turn(self):
        lines = records.digest(records.timeline(FACTS))
        self.assertEqual(lines[0], "T0 drew Forest, Sol Ring")
        self.assertEqual(lines[1], "T1 drew Forest · land Forest · Opp 1 37 · over: turn limit")

    def test_decisions_on_request(self):
        lines = records.digest(FACTS, decisions=True)
        self.assertIn("   mulligan (keep this hand): keep", lines)

    def test_happened_groups_runs(self):
        line = records.happened(FACTS[1:3] + FACTS[11:])
        self.assertEqual(line, "drew Forest, Sol Ring · couldn't cast Sol Ring X=2 · Opp 1 37 · over: turn limit")


class RenderTest(unittest.TestCase):
    def test_decision_collapses_runs_and_shows_pick_range(self):
        decision = {"turn": "T1 main1", "kind": "choose", "prompt": "search", "min": 0, "max": 1,
                    "options": ["Forest", "Forest", "Forest", "Plains"]}
        self.assertEqual(render.decision(decision), "T1 main1 choose (search) [pick 0-1]: 1-3 Forest · 4 Plains")

    def test_number_decision(self):
        decision = {"turn": "T2 main1", "kind": "number", "prompt": "X for Hangarback Walker", "min": 0, "max": 3, "options": []}
        self.assertEqual(render.decision(decision), "T2 main1 number (X for Hangarback Walker): number 0-3")

    def test_state_is_short_by_default(self):
        state = {"turn": "T3 main1", "life": 40, "mana": 3, "library": 89, "hand": ["Forest", "Forest"],
                 "battlefield": [{"name": "Forest", "tapped": True}, {"name": "Forest", "tapped": True},
                                 {"name": "Ouroboroid", "pt": "1/3", "sick": True}],
                 "command": ["Marath, Will of the Wild"], "graveyard": [], "exile": [], "stack": [],
                 "opponents": [{"name": "Opp 1", "life": 40, "lands": 3, "other": 0}]}
        self.assertEqual(render.state(state), [
            "T3 main1 · life 40 · mana 3 · library 89",
            "hand: Forest x2",
            "board: Forest (tapped) x2, Ouroboroid 1/3 (sick)",
            "command: Marath, Will of the Wild",
        ])
        self.assertIn("opponents: Opp 1 life 40 lands 3", render.state(state, full=True))


if __name__ == "__main__":
    unittest.main()
