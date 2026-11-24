"""The deck database: decks from the decks repository and imports, with immutable revisions."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from deckmaster import decklist, decks

FIXTURES = Path(__file__).resolve().parent / "fixtures"
DCK = """[metadata]
Name=Proliferate Life
[Commander]
1 Marath, Will of the Wild|C13|[1]
[Main]
99 Forest|DMU|[1]
"""


class DecksTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.root = Path(self.dir.name)
        env = mock.patch.dict(os.environ, {"DECKMASTER_DB": str(self.root / "decks.db")})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(self.dir.cleanup)
        self.here = self.root / "projects" / "demo" / "deckmaster"
        self.here.mkdir(parents=True)
        (self.here / "marath.plan.md").write_text("Ramp, then cast Marath.")
        self.manifest(plan="marath.plan.md")

    def manifest(self, **extra):
        spec = {"name": "Marath tokens", "list": str(FIXTURES / "decks" / "marath-tokens.txt"),
                "advisor": str(FIXTURES / "advisors" / "marath.py"), **extra}
        (self.here / "marath.json").write_text(json.dumps(spec))

    def test_sync_adds_a_revision_only_when_the_list_plan_or_advisor_changes(self):
        hash_ = decklist.load(str(FIXTURES / "decks" / "marath-tokens.txt")).revision()
        self.assertEqual(decks.sync(str(self.root)), [("marath", f"revision {hash_}")])
        self.assertEqual(decks.sync(str(self.root)), [("marath", "unchanged")])
        first = decks.get("marath")
        (self.here / "marath.plan.md").write_text("Ramp harder.")
        decks.sync(str(self.root))
        second = decks.get("marath")
        self.assertGreater(second.revision, first.revision)
        self.assertEqual((first.plan, second.plan), ("Ramp, then cast Marath.", "Ramp harder."))
        self.assertEqual(second.list.revision(), hash_)
        self.assertEqual(second.source, "projects/demo/deckmaster/marath.json")
        self.assertTrue(second.advisor.endswith("marath.py"))

    def test_a_forge_dck_imports_by_its_own_name(self):
        path = self.root / "Proliferate Life.dck"
        path.write_text(DCK)
        slug, added = decks.import_list(str(path))
        self.assertEqual((slug, added), ("proliferate-life", True))
        deck = decks.get(slug)
        self.assertEqual((deck.name, deck.list.commanders, deck.list.size), ("Proliferate Life", ["Marath, Will of the Wild"], 100))
        self.assertIsNone(deck.plan)
        self.assertEqual(decks.import_list(str(path))[1], False)

    def test_a_deck_is_named_by_slug_manifest_or_file(self):
        decks.sync(str(self.root))
        self.assertEqual(decks.resolve("marath").plan, "Ramp, then cast Marath.")
        self.assertEqual(decks.resolve(str(self.here / "marath.json")).plan, "Ramp, then cast Marath.")
        listed = decks.resolve(str(FIXTURES / "decks" / "yue-moon.txt"))
        self.assertEqual((listed.slug, listed.plan, listed.advisor), ("yue-moon", None, None))
        with self.assertRaisesRegex(decks.DeckError, "no deck nothing"):
            decks.resolve("nothing")

    def test_a_manifest_naming_a_missing_advisor_is_refused(self):
        self.manifest(advisor="gone.py")
        with self.assertRaisesRegex(decks.DeckError, "no advisor"):
            decks.sync(str(self.root))


if __name__ == "__main__":
    unittest.main()
