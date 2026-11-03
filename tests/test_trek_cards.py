"""Real Forge regression scenarios for the native Star Trek scripts (no model calls)."""
import unittest
from goldfish import engine, decklist

class TrekCardRules(unittest.TestCase):
    def setUp(self):
        d=decklist.load(engine.ROOT/'examples/decks/eternities-living-worlds-iii.txt')
        self.r=engine.request(dict(cmd='start',commanders=d.commanders,main=d.main,seed=42,turns=20,mana='auto'))
        self.sid=self.r['session'];self.req('answer',answer=[1])
        for card in list(self.state()['hand']): self.ov('move',card,'library')
        for name in ['Forest','Island','Plains','Mountain','Swamp']:
            for _ in range(3):self.ov('create',name,'battlefield')
    def tearDown(self):self.req('end')
    @classmethod
    def tearDownClass(cls):engine.request({'cmd':'shutdown'},start=False)
    def req(self,cmd,**kw):
        self.r=engine.request(dict(cmd=cmd,session=self.sid,**kw));return self.r
    def ov(self,*args):return self.req('override',args=list(args))
    def state(self):return engine.request(dict(cmd='state',session=self.sid))['state']
    def cast(self,name):
        self.ov('create','Lightning Bolt','hand');self.ov('create',name,'hand');opts=self.r['decision']['options'];self.assertIn(name,opts)
        self.req('answer',answer=[opts.index(name)+1]);self.settle()
    def settle(self):
        for _ in range(100):
            d=self.r.get('decision');self.assertIsNotNone(d,self.r)
            if d['kind']=='play' and not self.state()['stack']:return
            self.req('answer',**({'answer':[1]} if d['kind']=='play' else {'answer':[d['options'].index(getattr(self,'search_choice','Forest'))+1]} if 'Select a card from your library (Genesis Device)' in d.get('prompt','') else {'defer':True}))
        self.fail('resolution did not settle')
    def board(self,name):return [c for c in self.state()['battlefield'] if c['name']==name]
    def test_pike_distinct_names_not_land_count(self):
        self.cast('Captain Pike, Fullness of Time');self.assertEqual(self.board('Captain Pike, Fullness of Time')[0]['pt'],'5/5')
    def test_genesis_search_enters_tapped(self):
        before=len(self.state()['battlefield']);self.cast('Genesis Device')
        self.assertEqual(len(self.state()['battlefield']),before+2)
        self.assertTrue(any(c['name']=='Forest' and c.get('tapped') for c in self.state()['battlefield']))
    def test_final_frontier_ramps(self):
        n=len(self.state()['battlefield']);self.cast('Final Frontier');self.assertEqual(len(self.state()['battlefield']),n+1)
    def test_sphere_draw_and_station_threshold(self):
        self.cast('Borg Scout Sphere');self.assertEqual(len(self.state()['hand']),2)
        self.assertNotIn('pt',self.board('Borg Scout Sphere')[0])
        self.ov('create','Colossal Dreadmaw','battlefield')
        opts=self.r['decision']['options']
        self.req('answer',answer=[next(i+1 for i,o in enumerate(opts) if 'Station' in o)])
        self.settle()
        self.assertEqual(self.board('Borg Scout Sphere')[0]['counters']['Charge'],6)
        self.assertEqual(self.board('Borg Scout Sphere')[0]['pt'],'5/5')
        self.assertTrue(self.board('Colossal Dreadmaw')[0]['tapped'])
    def test_maturation_counts_cast(self):
        self.cast('Maturation Chamber');self.assertNotIn('counters',self.board('Maturation Chamber')[0])
        self.cast('Sol Ring');self.assertEqual(self.board('Maturation Chamber')[0]['counters']['Charge'],1)
    def test_conquest_sixth_trigger_doubles_without_token_recursion(self):
        self.cast('Conquest Mission')
        for _ in range(6):
            self.ov('create','Ornithopter','hand');opts=self.r['decision']['options'];self.req('answer',answer=[opts.index('Ornithopter')+1]);self.settle()
        self.assertEqual(self.board('Conquest Mission')[0]['counters']['Quest'],6)
        self.assertEqual(len(self.board('Borg Token')),7)
    def test_warp_speed_searches_to_hand(self):
        self.cast('Warp Speed');self.assertEqual(len(self.state()['hand']),2)
    def test_hit_it_mills_rest(self):
        n=self.state()['library'];self.cast('Hit It!');s=self.state()
        self.assertEqual(s['library'],n-5);self.assertGreaterEqual(len(s['graveyard']),4)
    def activate(self,fragment):
        opts=self.r['decision']['options']
        self.req('answer',answer=[next(i+1 for i,o in enumerate(opts) if fragment in o)])
        self.settle()
    def test_maturation_activated_token_count(self):
        self.cast('Maturation Chamber');self.cast('Sol Ring')
        self.activate('Create a 1/1')
        self.assertEqual(len(self.board('Borg Token')),1)
        self.assertTrue(self.board('Maturation Chamber')[0]['tapped'])
    def test_discovery_enters_discovers(self):
        self.ov('create','Sol Ring','library')
        self.cast('U.S.S. Discovery, at Black Alert')
        self.assertTrue(self.board('Sol Ring') or 'Sol Ring' in self.state()['hand'])
        self.assertNotIn('pt',self.board('U.S.S. Discovery, at Black Alert')[0])
    def combat(self):
        # Clear one full turn so newly cast creatures can attack naturally.
        for _ in range(500):
            d=self.r['decision']
            if d['kind']=='attack':
                self.req('answer',answer=list(range(1,len(d['options'])+1)))
                for _ in range(100):
                    d=self.r['decision']
                    if d['kind']=='play' and not self.state()['stack'] and self.state()['turn'].endswith('main2'):return
                    self.req('answer',**({'answer':[1]} if d['kind']=='play' else {'defer':True}))
                return
            self.req('answer',**({'answer':[1]} if d['kind']=='play' else {'defer':True}))
        self.fail('no attack decision')
    def test_locutus_granted_combat_creates_borg(self):
        self.cast('Locutus of Borg');self.combat()
        self.assertGreaterEqual(len(self.board('Borg Token')),1)
    def test_cooption_granted_combat_draws(self):
        self.cast('Co-Option Adjutant');n=self.state()['library'];self.combat()
        self.assertLessEqual(self.state()['library'],n-2)

    def test_pike_plays_top_library_land(self):
        # create/move overrides append to the library, not its top. Use an all-land library.
        self.req('end')
        self.r=engine.request(dict(cmd='start',commanders=['Marath, Will of the Wild'],
            main=[[99,'Wastes']],seed=42,turns=4,mana='auto'))
        self.sid=self.r['session'];self.req('answer',answer=[1])
        for card in list(self.state()['hand']): self.ov('move',card,'library')
        for _ in range(4): self.ov('create','Forest','battlefield')
        self.cast('Captain Pike, Fullness of Time')
        opts=self.r['decision']['options']
        self.assertIn('Wastes (land)',opts)
        self.req('answer',answer=[opts.index('Wastes (land)')+1]);self.settle()
        self.assertEqual(len(self.board('Wastes')),1)
        self.assertEqual(self.board('Captain Pike, Fullness of Time')[0]['pt'],'2/2')

    def test_warp_overrides_genesis_tapped_entry(self):
        self.cast('Warp Speed')
        self.ov('create','Wastes','library')
        self.search_choice='Wastes'
        self.cast('Genesis Device')
        self.assertEqual(len(self.board('Wastes')),1)
        self.assertFalse(self.board('Wastes')[0].get('tapped',False))

    def test_warp_reduced_activation_draws_and_sacrifices(self):
        self.cast('Warp Speed');n=len(self.state()['hand'])
        self.activate('Draw two cards')
        self.assertEqual(len(self.state()['hand']),n+2)
        self.assertFalse(self.board('Warp Speed'))
        self.assertIn('Warp Speed',self.state()['graveyard'])
    def test_locutus_grants_trigger_to_other_artifact(self):
        self.cast('Locutus of Borg');self.cast('Silver Myr')
        self.combat()
        self.assertEqual(len(self.board('Borg Token')),2)

    def test_wormhole_one_tapped_planet_per_attack_not_per_creature(self):
        self.cast('Stable Wormhole')
        self.cast('Ornithopter');self.cast('Silver Myr')
        self.combat()
        planets=self.board('New Planet')
        self.assertEqual(len(planets),1)
        self.assertTrue(planets[0]['token'])
        self.assertTrue(planets[0]['tapped'])

    def test_final_frontier_beam_returns_creature_and_exiles_spell(self):
        self.ov('create','Ornithopter','battlefield')
        self.cast('Final Frontier')
        before=self.state()['library']
        opts=self.r['decision']['options']
        self.req('answer',answer=[next(i+1 for i,o in enumerate(opts) if 'Final Frontier' in o)])
        self.settle()
        s=self.state()
        self.assertIn('Ornithopter',s['hand'])
        self.assertFalse(self.board('Ornithopter'))
        self.assertIn('Final Frontier',s['exile'])
        self.assertNotIn('Final Frontier',s['graveyard'])
        self.assertEqual(s['library'],before-1)

    def genesis_activate(self):
        self.cast('Genesis Device')
        for _ in range(3):self.ov('create','Forest','battlefield')
        self.ov('create','Wastes','library')
        before=self.state()
        opts=self.r['decision']['options']
        self.req('answer',answer=[next(i+1 for i,o in enumerate(opts) if o.startswith('Genesis Device:'))])
        return before

    def test_genesis_activated_swaps_two_lands_and_sacrifices_device(self):
        before=self.genesis_activate()
        choices=['Wastes','Command Tower']
        for _ in range(30):
            d=self.r['decision']
            if d['kind']=='play' and not self.state()['stack']:break
            if d['kind']=='confirm':answer=[1]
            elif d['kind']=='choose' and d['prompt'].startswith('sacrifice'):
                answer=[1,2]
            elif d['kind']=='choose' and 'library' in d['prompt']:
                answer=[d['options'].index(choices.pop(0))+1]
            elif d['kind']=='play':answer=[1]
            else:
                self.req('answer',defer=True);continue
            self.req('answer',answer=answer)
        else:self.fail('Genesis resolution did not finish')
        s=self.state()
        self.assertFalse(choices)
        self.assertFalse(self.board('Genesis Device'))
        self.assertIn('Genesis Device',s['graveyard'])
        self.assertEqual(len(s['battlefield']),len(before['battlefield'])-1)
        self.assertEqual(s['library'],before['library']-2)
        self.assertTrue(self.board('Wastes')[0]['tapped'])
        self.assertTrue(self.board('Command Tower')[0]['tapped'])

    def test_genesis_can_sacrifice_zero_lands(self):
        before=self.genesis_activate()
        for _ in range(20):
            d=self.r['decision']
            if d['kind']=='play' and not self.state()['stack']:break
            if d['kind']=='confirm':self.req('answer',answer=[2])
            elif d['kind']=='play':self.req('answer',answer=[1])
            elif d['kind']=='choose':self.req('answer',answer=[])
            else:self.req('answer',defer=True)
        else:self.fail('Genesis zero resolution did not finish')
        s=self.state()
        self.assertFalse(self.board('Genesis Device'))
        self.assertEqual(len(s['battlefield']),len(before['battlefield'])-1)
        self.assertEqual(s['library'],before['library'])
