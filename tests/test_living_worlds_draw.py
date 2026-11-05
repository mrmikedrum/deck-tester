"""Native card-supply scenarios for the Living Worlds refinement candidates."""
import unittest

from goldfish import engine
from tests import test_exploratory_mission as mission_rules


class LivingWorldsDrawRules(unittest.TestCase):
    setUp = mission_rules.ExploratoryMissionRules.setUp
    tearDown = mission_rules.ExploratoryMissionRules.tearDown
    req = mission_rules.ExploratoryMissionRules.req
    ov = mission_rules.ExploratoryMissionRules.ov
    state = mission_rules.ExploratoryMissionRules.state
    settle = mission_rules.ExploratoryMissionRules.settle
    cast = mission_rules.ExploratoryMissionRules.cast

    @classmethod
    def tearDownClass(cls):
        engine.stop()

    def board(self, name):
        return [c for c in self.state()['battlefield'] if c['name'] == name]

    def activate(self, name):
        opts = self.r['decision']['options']
        self.req('answer', answer=[next(i + 1 for i, o in enumerate(opts) if o.startswith(name + ':'))])
        for _ in range(60):
            d = self.r['decision']
            if d['kind'] == 'play' and not self.state()['stack']:
                return
            if d['kind'] == 'targets':
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options']) if 'Opp 1' in o)])
            elif d['kind'] == 'play':
                self.req('answer', answer=[1])
            else:
                self.req('answer', defer=True)
        self.fail('activation did not resolve')

    def test_riker_immediate_haste_draw_pays_one_and_gives_chosen_opponent_two(self):
        self.cast('Commander William Riker')
        # Native draw-trigger observer: the targeted opponent loses two life
        # only if they actually draw two cards. Overrides merely arrange it.
        self.ov('create', 'Underworld Dreams', 'battlefield')
        before = self.state()
        self.activate('Commander William Riker')
        after = self.state()
        self.assertEqual(len(after['hand']), len(before['hand']) + 2)
        self.assertEqual(after['mana'], before['mana'] - 1)
        self.assertEqual([p['life'] for p in after['opponents']], [38, 40, 40])
        self.assertTrue(self.board('Commander William Riker')[0]['tapped'])
        self.assertFalse(any(o.startswith('Commander William Riker:') for o in self.r['decision']['options']))

    def test_riker_vigilance_attack_keeps_same_turn_draw_available(self):
        self.cast('Commander William Riker')
        for _ in range(100):
            d = self.r['decision']
            if d['kind'] == 'attack':
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options'])
                                              if 'Commander William Riker' in o and 'Opp 1' in o)])
                break
            self.req('answer', **({'answer': [1]} if d['kind'] == 'play' else {'defer': True}))
        else:
            self.fail('no attack decision')
        for _ in range(100):
            d = self.r['decision']
            if d['kind'] == 'play' and d['turn'].endswith('main2') and not self.state()['stack']:
                break
            self.req('answer', **({'answer': [1]} if d['kind'] == 'play' else {'defer': True}))
        self.assertEqual(self.state()['opponents'][0]['life'], 37)
        self.assertFalse(self.board('Commander William Riker')[0].get('tapped', False))
        self.activate('Commander William Riker')
        self.assertTrue(self.board('Commander William Riker')[0]['tapped'])

    def test_bankbuster_native_draws_exhaust_charges_and_create_crew_and_treasure(self):
        self.cast('Reckoner Bankbuster')
        self.assertEqual(self.board('Reckoner Bankbuster')[0]['counters']['Charge'], 3)
        before = len(self.state()['hand'])
        for remaining in [2, 1, 0]:
            self.activate('Reckoner Bankbuster')
            self.assertEqual(self.board('Reckoner Bankbuster')[0].get('counters', {}).get('Charge', 0), remaining)
            if remaining:
                self.ov('untap', 'Reckoner Bankbuster')  # simulate later availability, not an untap trigger
        self.assertEqual(len(self.state()['hand']), before + 3)
        self.assertTrue(self.board('Pilot Token'))
        self.assertTrue(self.board('Treasure Token'))

    def test_native_proliferation_replenishes_bankbuster_charge(self):
        self.cast('Reckoner Bankbuster')
        self.activate('Reckoner Bankbuster')
        self.ov('create', 'Pollenbright Druid', 'hand')
        opts = self.r['decision']['options']
        self.req('answer', answer=[opts.index('Pollenbright Druid') + 1])
        for _ in range(60):
            d = self.r['decision']
            if d['kind'] == 'play' and not self.state()['stack']:
                break
            if d['kind'] == 'mode':
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options']) if 'roliferate' in o)])
            elif d['kind'] == 'choose' and any('Reckoner Bankbuster' in o for o in d['options']):
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options']) if 'Reckoner Bankbuster' in o)])
            else:
                self.req('answer', **({'answer': [1]} if d['kind'] == 'play' else {'defer': True}))
        self.assertEqual(self.board('Reckoner Bankbuster')[0]['counters']['Charge'], 3)
