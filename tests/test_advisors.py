"""Deck advisors must read native state accurately and reach the outcomes model's context."""
import unittest
from pathlib import Path
from unittest import mock

from goldfish import advice, batch, model

ROOT = Path(__file__).resolve().parent.parent


def position(*permanents, hand=(), mana=5):
    return dict(turn='T3 main1', life=40, mana=mana, library=85, hand=list(hand),
                battlefield=list(permanents), command=[], graveyard=[], exile=[], stack=[], text={},
                land_drop=True, opponents=[dict(name='Opp 1', life=40, lands=3, other=0)])


def decision(*options, kind='play', prompt=''):
    return dict(kind=kind, turn='T3 main1', prompt=prompt, options=list(options),
                details=list(options), min=1, max=1, repeat=False)


class AdvisorsTest(unittest.TestCase):
    def setUp(self):
        self.nature = batch.load_pilot(str(ROOT / 'examples/pilots/marath_advisor.py'))['advise']
        self.assimilation = batch.load_pilot(str(ROOT / 'examples/pilots/atraxa_advisor.py'))['advise']

    def test_native_counter_labels_enable_marath_spending_fact(self):
        state = position(dict(name='Marath, Will of the Wild', pt='3/3', counters={'+1/+1': 3}))
        self.assertEqual(advice.Position(state, decision('pass'), []).counters('Marath, Will of the Wild'), 3)
        text = self.nature(state, decision('pass'), [])
        self.assertIn('Marath has 3 +1/+1 counters', text)
        self.assertIn('at most 3 counters/mana', text)
        self.assertIsNone(self.nature(position(), decision('pass'), []))

    def test_legacy_counter_labels_remain_readable_but_native_labels_win(self):
        state = position(dict(name='Marath', counters={'P1P1': 2}))
        self.assertEqual(advice.Position(state, decision('pass'), []).counters('Marath'), 2)
        state['battlefield'][0]['counters']['+1/+1'] = 3
        self.assertEqual(advice.Position(state, decision('pass'), []).counters('Marath'), 3)

    def test_loading_zone_is_not_reported_as_a_token_doubler(self):
        text = self.nature(position(dict(name='Loading Zone')), decision('pass'), [])
        self.assertIn('does not double the number of tokens', text)

    def test_conquest_uses_post_increment_threshold(self):
        for counters, expected in [(4, 1), (5, 2)]:
            state = position(dict(name='Conquest Mission', counters={'Quest': counters}))
            text = self.assimilation(state, decision('pass'), [])
            self.assertIn(f'adds a counter then makes {expected} Borg', text)

    def test_incubators_keep_individual_counts_and_all_counter_kinds_count(self):
        state = position(dict(name="Atraxa, Praetors' Voice", pt='4/4'),
                         dict(name='Incubator Token', counters={'+1/+1': 5}),
                         dict(name='Incubator Token', counters={'+1/+1': 2}),
                         dict(name='Maturation Chamber', counters={'Charge': 3}))
        text = self.assimilation(state, decision('pass'), [])
        self.assertIn('3 permanents have counters', text)
        self.assertIn('counter counts 5, 2', text)
        self.assertIn('Chamber has 3 charge counters', text)
        self.assertIn('FOUR mana', text)

    def test_tekuthal_doubles_proliferations_not_every_counter(self):
        text = self.assimilation(position(dict(name='Tekuthal, Inquiry Dominus')), decision('pass'), [])
        self.assertIn('TWO proliferations', text)
        self.assertIn('does not double every counter', text)

    def test_sphere_evasion_requires_six_and_glissa_has_bulk_transform(self):
        state = position(dict(name='Borg Scout Sphere', counters={'Charge': 5}),
                         dict(name='Glissa, Herald of Predation'))
        self.assertIn('NOT active yet', self.assimilation(state, decision('pass'), []))
        state['battlefield'][0]['counters']['Charge'] = 6
        self.assertIn('flying is active', self.assimilation(state, decision('pass'), []))
        text = self.assimilation(state, decision('transform', kind='mode', prompt='modes for Glissa'), [])
        self.assertIn('no mana payment', text)

    def test_graveyard_and_triggered_choices_are_context_specific(self):
        text = self.nature(position(), decision('Final Frontier (beammeup) (from graveyard)'), [])
        self.assertIn('Castable from the graveyard now: Final Frontier', text)
        text = self.nature(position(), decision('yes', 'no', kind='confirm', prompt='Search your hand? (Spelunking)'), [])
        self.assertIn('NOT your normal land', text)

    def test_outcomes_step_sends_python_advice_and_played_out_criteria_to_model(self):
        state = position(dict(name='Marath, Will of the Wild', pt='3/3', counters={'+1/+1': 3}))
        d = decision('pass', 'Ornithopter')
        reply = dict(session='test-session', records='/not/read', decision=d)
        lines = {name: model.Line([name], [], None, 'test', 0) for name in d['options']}
        decider = model.Decider('Test plan', 3, model.Usage(), hybrid='outcomes', advise=self.nature)
        with mock.patch.object(model.engine, 'request', return_value={'state': state}), \
             mock.patch.object(model.records, 'load', return_value=[]), \
             mock.patch.object(decider, 'explore', return_value=(lines, None)) as explore, \
             mock.patch.object(model, 'call', return_value={'pick': {'choice': 'pass', 'confidence': .9}}) as call:
            decider.step(reply)
        explore.assert_called_once()
        context, questions = call.call_args.args[:2]
        self.assertIn('Guidance for this position:', context)
        self.assertIn('Marath has 3', context)
        self.assertEqual(set(questions['pick']['criteria']), {'pass', 'Ornithopter'})
        self.assertIn('the game ends', questions['pick']['criteria']['Ornithopter'])
