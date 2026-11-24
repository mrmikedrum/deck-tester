"""Native rules checks for the three upstream assimilation scripts imported into our card patch."""
import unittest
from deckmaster import engine


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class AssimilationImports(unittest.TestCase):
    def setUp(self):
        self.r = engine.request(dict(cmd='start', commanders=['Marath, Will of the Wild'],
                                     main=[[99, 'Wastes']], seed=42, turns=12, mana='auto'))
        self.sid = self.r['session']
        self.req('answer', answer=[1])
        for card in list(self.state()['hand']):
            self.ov('move', card, 'library')
        for name in ['Forest', 'Island', 'Plains', 'Mountain', 'Swamp']:
            for _ in range(4):
                self.ov('create', name, 'battlefield')
        self.opponents = [p['name'] for p in self.state()['opponents']]

    def tearDown(self):
        self.req('end')

    @classmethod
    def tearDownClass(cls):
        engine.stop()

    def req(self, cmd, **kw):
        self.r = engine.request(dict(cmd=cmd, session=self.sid, **kw))
        return self.r

    def ov(self, *args):
        return self.req('override', args=list(args))

    def state(self):
        return engine.request(dict(cmd='state', session=self.sid))['state']

    def board(self, name):
        return [c for c in self.state()['battlefield'] if c['name'] == name]

    def begin_cast(self, name):
        self.ov('create', 'Lightning Bolt', 'hand')
        self.ov('create', name, 'hand')
        opts = self.r['decision']['options']
        self.assertIn(name, opts)
        self.req('answer', answer=[opts.index(name) + 1])

    def settle(self, choose=None, targets=None):
        for _ in range(150):
            d = self.r.get('decision')
            self.assertIsNotNone(d, self.r)
            if d['kind'] == 'play' and not self.state()['stack']:
                return
            if d['kind'] == 'play':
                self.req('answer', answer=[1])
            elif d['kind'] == 'targets' and targets is not None:
                opts = d['options']
                self.req('answer', answer=[i + 1 for i, o in enumerate(opts)
                                          if any(n in o for n in targets)])
            elif choose and d['kind'] in ['choose', 'targets']:
                opts = d['options']
                picks = [i + 1 for i, o in enumerate(opts) if choose in o]
                self.assertTrue(picks, d)
                self.req('answer', answer=[picks[0]])
            else:
                self.req('answer', defer=True)
        self.fail('resolution did not settle')

    def cast(self, name, **kw):
        self.begin_cast(name)
        self.settle(**kw)

    def test_wounded_only_fresh_opponent_deaths_and_one_from_each(self):
        for name, who in [('Grizzly Bears', self.opponents[0]),
                          ('Silvercoat Lion', self.opponents[0]),
                          ('Merfolk of the Pearl Trident', self.opponents[1]),
                          ('Llanowar Elves', 'you')]:
            self.ov('create', name, 'battlefield', who)
            self.ov('destroy', name)
        self.ov('create', 'Colossal Dreadmaw', 'graveyard', self.opponents[2])
        self.begin_cast('Assimilate the Wounded')
        d = self.r['decision']
        self.assertEqual(d['kind'], 'targets')
        text = ' '.join(d['options'])
        self.assertIn('Grizzly Bears', text)
        self.assertIn('Merfolk of the Pearl Trident', text)
        self.assertNotIn('Llanowar Elves', text)
        self.assertNotIn('Colossal Dreadmaw', text)
        self.settle(targets=['Grizzly Bears', 'Merfolk of the Pearl Trident'])
        self.assertEqual(self.board('Grizzly Bears')[0]['pt'], '3/3')
        self.assertEqual(self.board('Merfolk of the Pearl Trident')[0]['counters']['+1/+1'], 1)
        self.assertFalse(self.board('Silvercoat Lion'))

    def test_wounded_allows_zero_targets(self):
        self.cast('Assimilate the Wounded', targets=[])
        self.assertIn('Assimilate the Wounded', self.state()['graveyard'])

    def test_gift_selects_one_total_and_applies_borg_artifact_types(self):
        for name, who in zip(['Grizzly Bears', 'Merfolk of the Pearl Trident', 'Colossal Dreadmaw'], self.opponents):
            self.ov('create', name, 'library', who)
        self.ov('create', 'Lord of Atlantis', 'battlefield')
        self.ov('create', 'Tempered Steel', 'battlefield')
        self.cast('Gift of Perfection', choose='Merfolk of the Pearl Trident')
        c = self.board('Merfolk of the Pearl Trident')[0]
        self.assertEqual(c['counters']['+1/+1'], 1)
        # 1/1 + counter + Tempered Steel, but NOT Lord of Atlantis: old Merfolk type is gone.
        self.assertEqual(c['pt'], '4/4')
        self.assertFalse(self.board('Grizzly Bears'))
        self.assertFalse(self.board('Colossal Dreadmaw'))
        # Unchosen creatures remain available in their owners' libraries, not exiled/milled.
        self.cast('Gift of Perfection', choose='Grizzly Bears')
        self.assertEqual(self.board('Grizzly Bears')[0]['pt'], '5/5')
        # Auto-payment may consume blue sources for generic costs in the earlier casts.
        self.ov('create', 'Island', 'battlefield')
        self.cast('Gift of Perfection', choose='Colossal Dreadmaw')
        self.assertEqual(self.board('Colossal Dreadmaw')[0]['pt'], '9/9')
        self.assertEqual(len(self.board('Merfolk of the Pearl Trident')), 1)

    def test_gift_without_creatures_does_not_mill_the_libraries(self):
        self.ov('create', 'Underworld Dreams', 'battlefield')
        self.cast('Gift of Perfection')
        self.reach_next_main()
        # Each opponent still draws normally rather than losing to an emptied library.
        self.assertEqual([p['life'] for p in self.state()['opponents']], [39, 39, 39])

    def reach_next_main(self):
        initial = self.state()['turn'].split()[0]
        for _ in range(300):
            s = self.state()
            if s['turn'].split()[0] != initial and s['turn'].endswith('main1'):
                return
            d = self.r['decision']
            if d['kind'] == 'play':
                self.req('answer', answer=[1])
            elif d['kind'] in ['targets', 'choose']:
                opts = d['options']
                pick = next((i + 1 for i, o in enumerate(opts) if 'Grizzly Bears' in o), None)
                self.req('answer', **({'answer': [pick]} if pick else {'defer': True}))
            else:
                self.req('answer', defer=True)
        self.fail('did not reach next main phase')

    def test_death_reanimates_opponent_creature_and_protects_only_artifact_creatures(self):
        self.ov('create', 'Grizzly Bears', 'graveyard', self.opponents[0])
        self.cast('Death Is Irrelevant')
        self.assertFalse(self.board('Grizzly Bears'))  # not an enters trigger
        self.reach_next_main()
        self.assertEqual(self.board('Grizzly Bears')[0]['pt'], '3/3')
        self.ov('create', 'Ornithopter', 'battlefield')
        self.ov('create', 'Llanowar Elves', 'battlefield')
        self.cast('Wrath of God')
        self.assertTrue(self.board('Grizzly Bears'))
        self.assertTrue(self.board('Ornithopter'))
        self.assertFalse(self.board('Llanowar Elves'))

    def test_death_can_assimilate_from_own_graveyard(self):
        self.ov('create', 'Grizzly Bears', 'graveyard')
        self.cast('Death Is Irrelevant')
        self.reach_next_main()
        self.assertEqual(self.board('Grizzly Bears')[0]['pt'], '3/3')
