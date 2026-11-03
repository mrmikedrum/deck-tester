"""Resource updates must not shadow upstream or overwrite unknown user edits."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from goldfish import card_resources


class CardResourcesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.vendor = self.root / 'vendor/forge'
        self.vendor.mkdir(parents=True)
        subprocess.run(['git', 'init', '-q', str(self.vendor)], check=True)
        self.upstream = self.vendor / 'forge-gui/res/cardsfolder/a/analogue.txt'
        self.upstream.parent.mkdir(parents=True)
        self.upstream.write_text('Name:Analogue\n')
        self.commit()
        cards = self.root / 'cards'
        cards.mkdir()
        (cards / 'test.txt').write_text('Name:Test Card\nManaCost:1\nTypes:Artifact\n')
        (cards / 'manifest.json').write_text(json.dumps({'test.txt': {'name': 'Test Card'}}))
        self.installed = self.vendor / 'forge-gui/res/cardsfolder/goldfish-local/test.txt'

    def commit(self):
        subprocess.run(['git', '-C', str(self.vendor), 'add', str(self.upstream)], check=True)
        subprocess.run(['git', '-C', str(self.vendor), '-c', 'user.name=Test',
                        '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], check=True)

    def test_update_and_retirement_preserve_prior_file(self):
        card_resources.prepare(self.root)
        original = self.installed.read_text()
        card_resources.prepare(self.root)
        (self.root / 'cards/manifest.json').write_text('{}')
        card_resources.prepare(self.root)
        self.assertFalse(self.installed.exists())
        self.assertEqual(next((self.root / '.goldfish/retired-cards').rglob('test.txt')).read_text(), original)

    def test_new_upstream_name_blocks_shadowing(self):
        card_resources.prepare(self.root)
        self.upstream.write_text('Name:Test Card\n')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'Upstream now defines'):
            card_resources.prepare(self.root)

    def test_edited_destination_is_never_overwritten(self):
        card_resources.prepare(self.root)
        self.installed.write_text('my changes')
        with self.assertRaisesRegex(ValueError, 'Unmanaged or edited'):
            card_resources.prepare(self.root)
        self.assertEqual(self.installed.read_text(), 'my changes')

    def test_reports_label_games_with_local_scripts(self):
        from goldfish import records, report
        facts = [{'t': 'start', 'seed': 1, 'local_cards': 'Test Card'}]
        self.assertIn('local card scripts: Test Card', records.header(facts))
        summary = report.game_summary(facts, [])
        self.assertEqual(summary['local_cards'], 'Test Card')
