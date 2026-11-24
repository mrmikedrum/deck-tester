import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[3] / "skills/commander-search/scripts/scryfall.py"
SPEC = importlib.util.spec_from_file_location("deckmaster_search", SCRIPT)
SEARCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SEARCH)


def fixture():
    return {
        "operation": "search", "input": "example", "status": "partial", "complete": False,
        "pages_fetched": 1, "total_cards": 3, "returned_cards": 2,
        "next_page": "https://api.scryfall.com/cards/search?page=2",
        "source_urls": ["https://api.scryfall.com/cards/search?q=example"],
        "retrieved_at": "2026-10-23T00:00:00Z", "warnings": ["Partial retrieval"],
        "cards": [
            {"name": "Front // Back", "layout": "transform", "color_identity": ["G", "U"],
             "prices": {"usd": "5"}, "image_uris": {"normal": "image"},
             "legalities": {"commander": "legal"}, "scryfall_uri": "card-link",
             "card_faces": [
                 {"name": "Front", "mana_cost": "{G}", "type_line": "Creature",
                  "oracle_text": "Exact front wording.", "power": "1", "toughness": "2"},
                 {"name": "Back", "type_line": "Creature", "oracle_text": "Exact back wording.",
                  "power": "3", "toughness": "4", "image_uris": {"normal": "back-image"}},
             ]},
            {"name": "Other", "mana_cost": "{2}", "oracle_text": "Other exact wording.",
             "type_line": "Artifact", "keywords": [], "set": "ABC", "collector_number": "1"},
        ],
    }


class ViewsTest(unittest.TestCase):
    def test_names_view_preserves_coverage_and_faces_without_mutating_full_result(self):
        result = fixture()
        before = copy.deepcopy(result)
        compact = SEARCH.display_view(result, "names")
        for key in ("complete", "next_page", "total_cards", "returned_cards", "warnings", "source_urls", "retrieved_at"):
            self.assertEqual(compact[key], result[key])
        self.assertEqual(compact["cards"][0]["card_faces"][1]["name"], "Back")
        self.assertNotIn("oracle_text", compact["cards"][1])
        self.assertNotIn("prices", compact["cards"][0])
        self.assertEqual(result, before)

    def test_rules_view_keeps_exact_rules_stats_identity_and_legality_for_both_faces(self):
        result = SEARCH.display_view(fixture(), "rules")
        card = result["cards"][0]
        self.assertEqual(card["color_identity"], ["G", "U"])
        self.assertEqual(card["legalities"], {"commander": "legal"})
        self.assertEqual(card["scryfall_uri"], "card-link")
        self.assertEqual(card["card_faces"][0]["oracle_text"], "Exact front wording.")
        self.assertEqual(card["card_faces"][1]["power"], "3")
        self.assertEqual(card["card_faces"][1]["oracle_text"], "Exact back wording.")
        self.assertNotIn("image_uris", card["card_faces"][1])

    def test_full_view_is_unchanged(self):
        result = fixture()
        self.assertIs(SEARCH.display_view(result, "full"), result)

    def test_display_paging_keeps_retrieval_coverage_and_exposes_remaining_cards(self):
        result = fixture()
        first = SEARCH.display_view(result, "names", limit=1)
        self.assertEqual(first["returned_cards"], 2)
        self.assertEqual(first["displayed_cards"], 1)
        self.assertEqual(first["view_total_cards"], 2)
        self.assertEqual(first["next_offset"], 1)
        self.assertFalse(first["complete"])
        second = SEARCH.display_view(result, "rules", offset=1, limit=1)
        self.assertEqual(second["cards"][0]["oracle_text"], "Other exact wording.")
        self.assertIsNone(second["next_offset"])
        self.assertEqual(len(result["cards"]), 2)

    def test_invalid_display_limits_are_rejected(self):
        for offset, limit in [(-1, None), (0, 0)]:
            with self.assertRaises(ValueError):
                SEARCH.display_view(fixture(), "names", offset, limit)

    def test_selection_is_exact_case_insensitive_and_retains_source_coverage(self):
        selected = SEARCH.inspect_result(fixture(), ["OTHER"])
        self.assertEqual([card["name"] for card in selected["cards"]], ["Other"])
        self.assertEqual(selected["returned_cards"], 1)
        self.assertEqual(selected["source_returned_cards"], 2)
        self.assertFalse(selected["complete"])
        self.assertEqual(selected["status"], "partial")
        self.assertEqual(selected["total_cards"], 3)
        self.assertTrue(selected["next_page"])

    def test_missing_selection_is_explicit_and_does_not_claim_no_search_matches(self):
        selected = SEARCH.inspect_result(fixture(), ["Other", "Missing"])
        self.assertEqual(selected["status"], "error")
        self.assertEqual(selected["missing_names"], ["Missing"])
        self.assertEqual(len(selected["cards"]), 1)
        self.assertEqual(selected["total_cards"], 3)
        self.assertFalse(selected["complete"])

    def test_bad_saved_shape_is_rejected(self):
        with self.assertRaises(ValueError):
            SEARCH.inspect_result({"cards": "wrong"}, [])


class CommandsTest(unittest.TestCase):
    def test_saved_inspection_is_local_and_selects_complete_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "results.json"
            source.write_text(json.dumps(fixture()))
            output = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "inspect", str(source), "--name", "Other"]), \
                    patch.object(SEARCH, "request_json", side_effect=AssertionError("Unexpected network")), \
                    patch.object(SEARCH.subprocess, "run", side_effect=AssertionError("Unexpected cache call")), \
                    contextlib.redirect_stdout(output):
                self.assertEqual(SEARCH.main(), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["cards"][0]["oracle_text"], "Other exact wording.")
            self.assertEqual(result["view"], "rules")
            self.assertEqual(json.loads(source.read_text()), fixture())

    def test_search_can_save_full_data_while_displaying_names_and_caching_full_data(self):
        original = fixture()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "results.json"
            output = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "search", "example", "--view", "names", "--limit", "1", "--output", str(destination)]), \
                    patch.object(SEARCH, "retrieve", return_value=original), \
                    patch.object(SEARCH.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as cache, \
                    contextlib.redirect_stdout(output):
                self.assertEqual(SEARCH.main(), 0)
            self.assertEqual(json.loads(destination.read_text()), original)
            self.assertEqual(json.loads(cache.call_args.kwargs["input"]), original)
            displayed = json.loads(output.getvalue())
            self.assertEqual(displayed["displayed_cards"], 1)
            self.assertEqual(displayed["next_offset"], 1)
            self.assertNotIn("oracle_text", displayed["cards"][0]["card_faces"][0])

    def test_saved_inspection_returns_failure_for_a_missing_name(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "results.json"
            source.write_text(json.dumps(fixture()))
            command = subprocess.run([sys.executable, str(SCRIPT), "inspect", str(source), "--name", "Missing"], text=True, capture_output=True)
            self.assertEqual(command.returncode, 1)
            self.assertEqual(json.loads(command.stdout)["missing_names"], ["Missing"])


if __name__ == "__main__":
    unittest.main()
