"""Native browser-seat regression: real floating mana must make the commander castable."""
import pathlib
import shutil
import socket
import tempfile
import threading
import unittest

from deckmaster import engine


@unittest.skipUnless(engine.FORGE_BUILD.exists(), 'requires installed Forge')
class ManualManaTest(unittest.TestCase):
    def test_browser_mana_and_counter_targets_belong_to_player(self):
        saved = {k: getattr(engine, k) for k in ('HOME', 'FORGE_BUILD', 'SOCKET', 'LOG', 'MODE')}
        stopped = threading.Event()
        worker = None
        with tempfile.TemporaryDirectory(prefix='seat-mana-regression-') as home:
            try:
                engine.HOME = pathlib.Path(home)
                engine.FORGE_BUILD = engine.HOME / 'forge-build'
                shutil.copy2(saved['FORGE_BUILD'], engine.FORGE_BUILD)
                engine.use_table()
                with socket.socket() as port:
                    port.bind(('127.0.0.1', 0))
                    available = port.getsockname()[1]
                opened = engine.request({'cmd': 'table', 'people': 0, 'port': available, 'seats': [
                    {'name': 'You', 'commanders': ['Marath, Will of the Wild'], 'main': [[99, 'Forest']],
                     'watch': True, 'mana': 'always', 'seed': 119},
                    {'name': 'Opponent', 'commanders': ["Atraxa, Praetors' Voice"], 'main': [[99, 'Forest']],
                     'ask': [], 'seed': 120}]})
                sid, other = opened['seats']['You'], opened['seats']['Opponent']

                def ai():
                    while not stopped.is_set():
                        try:
                            r = engine.request({'cmd': 'decision', 'session': other})
                            if 'over' in r:
                                return
                            if r.get('decision') and not stopped.is_set():
                                engine.request({'cmd': 'answer', 'session': other, 'defer': True})
                        except (engine.EngineError, OSError):
                            return

                worker = threading.Thread(target=ai, daemon=True)
                worker.start()

                def answer(r, label):
                    choices = r['decision']['options']
                    pick = next(i + 1 for i, o in enumerate(choices)
                                if o.lower() == label.lower() or o.startswith(label))
                    return engine.request({'cmd': 'answer', 'session': sid, 'answer': [pick]})

                r = answer(engine.request({'cmd': 'decision', 'session': sid}), 'keep')
                for card in ('Adagia, Windswept Bastion', 'Stomping Ground', 'Command Tower'):
                    engine.request({'cmd': 'override', 'session': sid, 'args': ['create', card]})
                    r = engine.request({'cmd': 'override', 'session': sid, 'args': ['untap', card]})
                r = answer(r, 'Command Tower:')
                self.assertEqual(r['decision']['kind'], 'choose')
                r = answer(r, 'green')
                me = next(p for p in engine.request({'cmd': 'view', 'session': sid})['view']['players']
                          if p['name'] == 'You')
                self.assertEqual(me['manaPool'], {'G': 1})
                self.assertTrue(next(c for c in me['battlefield'] if c['name'] == 'Command Tower')['tapped'])
                self.assertFalse(any(o.startswith('Command Tower:') for o in r['decision']['options']))
                r = answer(r, 'Marath, Will of the Wild (commander)')
                self.assertEqual(r['decision']['kind'], 'pay')
                opts = r['decision']['options']
                picks = [next(i + 1 for i, o in enumerate(opts) if o.startswith(name) and o.endswith(color))
                         for name, color in [('Adagia', '(W)'), ('Stomping', '(R)')]]
                engine.request({'cmd': 'answer', 'session': sid, 'answer': picks})
                me = next(p for p in engine.request({'cmd': 'view', 'session': sid})['view']['players']
                          if p['name'] == 'You')
                marath = next(c for c in me['battlefield'] if c['name'] == 'Marath, Will of the Wild')
                self.assertEqual(marath['counters']['+1/+1'], 3)
                self.assertEqual(me['manaPool'], {})
                # A previous AI affordability check must not preselect Marath as the counter target.
                engine.request({'cmd': 'override', 'session': sid, 'args': ['create', 'Grizzly Bears']})
                r = engine.request({'cmd': 'override', 'session': sid, 'args': ['untap', 'Adagia, Windswept Bastion']})
                r = answer(r, 'Marath, Will of the Wild:')
                if r['decision']['kind'] == 'number':
                    r = engine.request({'cmd': 'answer', 'session': sid, 'answer': [1]})
                self.assertEqual(r['decision']['kind'], 'mode')
                r = answer(r, 'Put X +1/+1 counters')
                self.assertEqual(r['decision']['kind'], 'targets')
                r = answer(r, 'Grizzly Bears')
                me = next(p for p in engine.request({'cmd': 'view', 'session': sid})['view']['players']
                          if p['name'] == 'You')
                bears = next(c for c in me['battlefield'] if c['name'] == 'Grizzly Bears')
                marath = next(c for c in me['battlefield'] if c['name'] == 'Marath, Will of the Wild')
                self.assertEqual(bears['counters']['+1/+1'], 1)
                self.assertEqual(marath['counters']['+1/+1'], 2)
                # Mana-only options remain clickable during a watched opponent spell, but
                # cannot hold the otherwise empty end-of-turn priority window afterwards.
                engine.request({'cmd': 'override', 'session': sid,
                                'args': ['move', 'Marath, Will of the Wild', 'command']})
                engine.request({'cmd': 'override', 'session': sid,
                                'args': ['create', 'Grizzly Bears', 'hand', 'Opponent']})
                for _ in range(3):
                    engine.request({'cmd': 'override', 'session': sid,
                                    'args': ['create', 'Forest', 'battlefield', 'Opponent']})
                r = engine.request({'cmd': 'override', 'session': sid,
                                    'args': ['untap', 'Command Tower']})
                for _ in range(8):
                    v = engine.request({'cmd': 'view', 'session': sid})['view']
                    if v['stack'] and v['stack'][0]['controller'] == 'Opponent':
                        break
                    picks = [] if r['decision']['kind'] == 'attack' else [1]
                    r = engine.request({'cmd': 'answer', 'session': sid, 'answer': picks})
                else:
                    self.fail('fixture opponent never cast its Bear')
                self.assertEqual(r['decision']['kind'], 'play')
                self.assertTrue(all(ref.get('mana') for ref in r['decision']['refs'][1:]))
                self.assertTrue(r['decision']['refs'][1:])
                r = engine.request({'cmd': 'answer', 'session': sid, 'answer': [1]})
                v = engine.request({'cmd': 'view', 'session': sid})['view']
                self.assertEqual(v['active'], 'You')
                self.assertEqual(v['phase'], 'MAIN1')
            finally:
                stopped.set()
                engine.stop()
                if worker:
                    worker.join(timeout=10)
                for k, v in saved.items():
                    setattr(engine, k, v)
        if worker:
            self.assertFalse(worker.is_alive())
