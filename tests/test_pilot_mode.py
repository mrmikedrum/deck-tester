"""Real-deck primary modes must be explicit; hybrid fallbacks remain permitted."""
import contextlib
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest import mock

from deckmaster import batch, decks, game, model, table

ROOT = Path(__file__).resolve().parent.parent


class PilotModeTest(unittest.TestCase):
    def test_bare_real_deck_batch_rejects_stock_ai_before_starting(self):
        with mock.patch.object(batch.engine, 'request') as request:
            with self.assertRaisesRegex(ValueError, 'require a Jev'):
                batch.run(None, 'test', 1, 1, 1, 3, None, 1)
            request.assert_not_called()

    def test_bare_real_deck_table_rejects_stock_ai_before_starting(self):
        seat = SimpleNamespace(plan=None, handlers={})
        with mock.patch.object(table.engine, 'use_table') as use_table:
            with self.assertRaisesRegex(ValueError, 'require a Jev'):
                table.host([seat], 0)
            use_table.assert_not_called()

    def test_every_browser_opponent_has_its_plan_and_advisor_and_uses_table_pilot(self):
        with deck_repository() as root:
            decks.sync(root)
            seat = game.configured_seat('marath-tokens')
            self.assertTrue(seat.plan)
            self.assertIn('advise', seat.handlers)
            self.assertIn('play', seat.request()['ask'])
            host = game.Table()
            host.generation, host.usage = 1, model.Usage()
            with mock.patch.object(table, 'play') as play:
                host.jev_seat(seat, 'test-session', 1, 4)
                play.assert_called_once_with(seat, 'test-session', 4, host.usage, host.outcomes)
            with self.assertRaisesRegex(ValueError, 'stock AI mode is disabled'):
                game.configured_seat('yue-moon')   # a list without plan or advisor


@contextlib.contextmanager
def deck_repository():
    """A decks repository with two fixture decks (one with a plan and an advisor), and a database of its own."""
    with tempfile.TemporaryDirectory() as root, mock.patch.dict(os.environ, {'DECKMASTER_DB': root + '/decks.db'}):
        here = Path(root) / 'projects' / 'demo' / 'deckmaster'
        here.mkdir(parents=True)
        fixtures = ROOT / 'tests' / 'fixtures'
        (here / 'marath-tokens.plan.md').write_text('Ramp, then cast Marath.')
        (here / 'marath-tokens.json').write_text(json.dumps({
            'name': 'Marath tokens', 'list': str(fixtures / 'decks' / 'marath-tokens.txt'),
            'plan': 'marath-tokens.plan.md', 'advisor': str(fixtures / 'advisors' / 'marath.py')}))
        (here / 'yue-moon.json').write_text(json.dumps({'list': str(fixtures / 'decks' / 'yue-moon.txt')}))
        yield root
