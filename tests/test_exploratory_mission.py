"""Native Forge scenarios: setup overrides do not count as landfall resolutions."""
import unittest

from deckmaster import engine


class ExploratoryMissionRules(unittest.TestCase):
    def setUp(self):
        self.r = engine.request(dict(cmd='start', commanders=['Marath, Will of the Wild'],
                                     main=[[99, 'Wastes']], seed=42, turns=5, mana='auto'))
        self.sid = self.r['session']
        self.req('answer', answer=[1])
        for card in list(self.state()['hand']):
            self.ov('move', card, 'library')
        for name in ['Mountain', 'Forest', 'Plains']:
            for _ in range(4):
                self.ov('create', name, 'battlefield')
        # The installed native create override puts each card on top. Build a
        # known prefix: two Wastes, Sol Ring, Memnite, then Ornithopters.
        for name in ['Ornithopter'] * 12 + ['Memnite', 'Sol Ring', 'Wastes', 'Wastes']:
            self.ov('create', name, 'library')
        self.cast('Exploratory Mission')

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

    def settle(self):
        for _ in range(100):
            d = self.r.get('decision')
            self.assertIsNotNone(d, self.r)
            if d['kind'] == 'play' and not self.state()['stack']:
                return
            if d['kind'] == 'play':
                self.req('answer', answer=[1])
            else:
                self.req('answer', defer=True)
        self.fail('resolution did not settle')

    def cast(self, name):
        self.ov('create', name, 'hand')
        options = self.r['decision']['options']
        self.assertIn(name, options)
        self.req('answer', answer=[options.index(name) + 1])
        self.settle()

    def land(self):
        self.ov('create', 'Mountain', 'hand')
        options = self.r['decision']['options']
        self.req('answer', answer=[options.index('Mountain (land)') + 1])
        self.settle()

    def mission(self):
        return next(c for c in self.state()['battlefield'] if c['name'] == 'Exploratory Mission')

    def exile_options(self):
        return [o for o in self.r['decision']['options'] if 'exile' in o.lower()]

    def next_turn(self):
        for _ in range(200):
            d = self.r.get('decision')
            self.assertIsNotNone(d, self.r)
            if d['turn'].startswith('T2 ') and d['kind'] == 'play' and not self.state()['stack']:
                return
            if d['kind'] == 'play':
                self.req('answer', answer=[1])
            else:
                self.req('answer', defer=True)
        self.fail('next turn did not arrive')

    def test_landfall_exiles_lands_through_one_nonland_and_only_permits_that_spell(self):
        before = self.state()
        self.assertNotIn('counters', self.mission())
        self.land()
        s = self.state()
        self.assertEqual(self.mission()['counters']['Quest'], 1)
        self.assertEqual(s['library'], before['library'] - 3)
        self.assertEqual(s['exile'].count('Wastes'), 2)
        self.assertIn('Sol Ring', s['exile'])
        self.assertFalse(any('Wastes' in o for o in self.exile_options()))
        option = next(o for o in self.exile_options() if 'Sol Ring' in o)
        mana = s['mana']
        self.req('answer', answer=[self.r['decision']['options'].index(option) + 1])
        self.settle()
        self.assertIn('Sol Ring', [c['name'] for c in self.state()['battlefield']])
        # Casting from exile still pays the normal generic mana cost.
        self.assertEqual(self.state()['mana'], mana - 1 + 2)
        self.assertNotIn('Sol Ring', self.state()['exile'])
        self.assertEqual(before['library'], 115)

    def test_fifth_counter_adds_red_mana_but_fourth_does_not(self):
        self.ov('counter', 'Exploratory Mission', 'Quest', '3')
        before = self.state()['mana']
        self.land()
        self.assertEqual(self.mission()['counters']['Quest'], 4)
        self.assertEqual(self.state()['mana'], before + 1)
        self.cast('Explore')  # native extra land allowance and draw
        before = self.state()['mana']
        self.land()
        self.assertEqual(self.mission()['counters']['Quest'], 5)
        self.assertEqual(self.state()['mana'], before + 3)
        self.assertEqual(len(self.exile_options()), 2)

    def test_permission_expires_this_turn_without_moving_unused_card(self):
        self.land()
        self.assertTrue(self.exile_options())
        self.next_turn()
        self.assertIn('Sol Ring', self.state()['exile'])
        self.assertFalse(self.exile_options())
        self.assertEqual(self.mission()['counters']['Quest'], 1)  # opponents played lands

    def test_permission_survives_source_leaving(self):
        self.land()
        self.ov('destroy', 'Exploratory Mission')
        self.assertTrue(any('Sol Ring' in o for o in self.exile_options()))

    def test_native_proliferate_advances_threshold_but_does_not_itself_add_mana(self):
        self.ov('counter', 'Exploratory Mission', 'Quest', '4')
        self.ov('create', 'Pollenbright Druid', 'hand')
        options = self.r['decision']['options']
        before = self.state()['mana']
        self.req('answer', answer=[options.index('Pollenbright Druid') + 1])
        for _ in range(40):
            d = self.r['decision']
            if d['kind'] == 'play' and not self.state()['stack']:
                break
            if d['kind'] == 'mode':
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options']) if 'roliferate' in o)])
            elif d['kind'] == 'choose' and any('Exploratory Mission' in o for o in d['options']):
                self.req('answer', answer=[next(i + 1 for i, o in enumerate(d['options']) if 'Exploratory Mission' in o)])
            elif d['kind'] == 'play':
                self.req('answer', answer=[1])
            else:
                self.req('answer', defer=True)
        self.assertEqual(self.mission()['counters']['Quest'], 5)
        self.assertEqual(self.state()['mana'], before - 2)
        before = self.state()['mana']
        self.land()
        self.assertEqual(self.mission()['counters']['Quest'], 6)
        self.assertEqual(self.state()['mana'], before + 3)

    def test_cast_requires_two_red_not_just_four_generic_mana(self):
        for n in range(1, 5):
            self.ov('tap', 'Mountain#' + str(n))
        self.ov('create', 'Exploratory Mission', 'hand')
        self.assertNotIn('Exploratory Mission', self.r['decision']['options'])
        self.ov('untap', 'Mountain#1')
        self.assertNotIn('Exploratory Mission', self.r['decision']['options'])
        self.ov('untap', 'Mountain#2')
        self.assertIn('Exploratory Mission', self.r['decision']['options'])

    def test_no_nonland_still_exiles_library_and_awards_threshold_mana(self):
        # Remove the known nonland fixture cards without granting permission.
        # Keep the live mana/commander options so setup cannot auto-pass a turn.
        for name in ['Sol Ring', 'Memnite'] + ['Ornithopter#' + str(n) for n in range(1, 13)]:
            self.ov('move', name, 'exile')
        self.ov('counter', 'Exploratory Mission', 'Quest', '4')
        before = self.state()
        self.land()
        self.assertEqual(self.state()['library'], 0)
        self.assertEqual(self.state()['exile'].count('Wastes'), before['library'])
        self.assertEqual(self.mission()['counters']['Quest'], 5)
        self.assertEqual(self.state()['mana'], before['mana'] + 3)
        self.assertFalse(self.exile_options())
