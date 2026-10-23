import unittest
from pathlib import Path

from goldfish import decklist

EXAMPLES = Path(__file__).resolve().parent.parent / "examples" / "decks"


class ParseTest(unittest.TestCase):
    def test_moxfield_export(self):
        deck = decklist.load(EXAMPLES / "eternities-living-worlds-iii.txt")
        self.assertEqual(deck.commanders, ["Marath, Will of the Wild"])
        self.assertEqual(deck.size, 100)
        self.assertEqual(deck.problems(), [])

    def test_deckmaster_sections_and_annotations(self):
        deck = decklist.parse(
            "// COMMANDER\n"
            "1 Atraxa, Praetors' Voice (2X2) 190 *F*\n"
            "\n"
            "1 Sol Ring | {\"facts\": {}}\n"
            "30 Forest\n"
            "// MAYBEBOARD\n"
            "1 Doubling Season\n"
        )
        self.assertEqual(deck.commanders, ["Atraxa, Praetors' Voice"])
        self.assertEqual(deck.main, [(1, "Sol Ring"), (30, "Forest")])

    def test_problems_flag_size_and_duplicates(self):
        deck = decklist.parse("# commander\n1 Marath, Will of the Wild\n# main\n2 Sol Ring\n")
        problems = deck.problems()
        self.assertTrue(any("100 cards" in p for p in problems))
        self.assertTrue(any("2 copies of Sol Ring" in p for p in problems))

    def test_revision_ignores_order_and_printings(self):
        a = decklist.parse("// COMMANDER\n1 Marath, Will of the Wild\n\n1 Sol Ring (C21) 263\n30 Forest\n")
        b = decklist.parse("// COMMANDER\n1 Marath, Will of the Wild\n\n30 Forest\n1 Sol Ring\n// MAYBEBOARD\n1 Mox Opal\n")
        self.assertEqual(a.revision(), b.revision())
        self.assertNotEqual(a.revision(), decklist.parse("// COMMANDER\n1 Marath, Will of the Wild\n\n31 Forest\n").revision())

    def test_rejects_garbage_line(self):
        with self.assertRaises(decklist.DecklistError):
            decklist.parse("Sol Ring without a quantity\n")


if __name__ == "__main__":
    unittest.main()
