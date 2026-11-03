"""Current Manufactured Cosmos advisor. Use with --pilot and the assimilation --guide.

Facts distinguish cast triggers, entry triggers, proliferation and crew costs; this hook advises the
model but never substitutes for Forge's legal actions or makes the final choice itself.
"""
from goldfish.advice import Advisor

adv = Advisor()


def countered(p):
    return [card for card in p.state.get('battlefield', [])
            if any(n > 0 for n in card.get('counters', {}).values())]


def incubators(p):
    return [card for card in p.state.get('battlefield', []) if card['name'] == 'Incubator Token']


adv.when(lambda p: f"{len(countered(p))} permanents have counters of some kind. Atraxa's end-step "
         'proliferation can add one of EACH kind already present on chosen permanents; it cannot seed a '
         'new counter kind or put the first counter on an empty component.',
         board=["Atraxa, Praetors' Voice"], test=lambda p: bool(countered(p)))
adv.when('Tekuthal replaces a proliferation with TWO proliferations. It does not double every counter '
         'placement or the number of tokens you create.', board=['Tekuthal, Inquiry Dominus'])
adv.when('Loading Zone doubles counters placed on your creatures, Spacecraft and Planets, not tokens '
         'or every ordinary artifact. Maturation Chamber is a noncreature artifact, not a Spacecraft.',
         board=['Loading Zone'])
adv.when('Kami adds one extra +1/+1 counter per placement on your permanents, not extra charge/quest '
         'counters and not extra token bodies.', board=['Kami of Whispered Hopes'])

adv.when(lambda p: f"Maturation Chamber has {p.counters('Maturation Chamber', 'Charge')} charge counters. "
         'Its activation costs FOUR mana and tap and creates that many Borg, without removing counters. '
         'Only future artifact SPELL CASTS add its counters; token entries and Incubator transformations do not.',
         board=['Maturation Chamber'])
adv.when(lambda p: f"Conquest Mission has {p.counters('Conquest Mission', 'Quest')} quest counters. "
         f"Its next nontoken-artifact-entry trigger, absent other changes, adds a counter then makes "
         f"{2 if p.counters('Conquest Mission', 'Quest') >= 5 else 1} Borg. Tokens and transformations "
         'do not trigger it.', board=['Conquest Mission'])
adv.when(lambda p: f"Borg Scout Sphere has {p.counters('Borg Scout Sphere', 'Charge')}/6 charge counters; "
         + ('its fleet-wide flying is active.' if p.counters('Borg Scout Sphere', 'Charge') >= 6
            else 'its fleet-wide flying is NOT active yet.'), board=['Borg Scout Sphere'])
adv.when('Locutus and Co-Option Adjutant grant combat-damage triggers to artifact creatures: '
         'connecting bodies generate Borg/cards, not merely attacking. Sphere evasion requires its threshold.',
         any_of={'board': ['Locutus of Borg', 'Co-Option Adjutant']}, kinds=['play', 'attack'])

adv.when(lambda p: f"There are {len(incubators(p))} untransformed Incubators, with +1/+1 counter counts "
         + ', '.join(str(c.get('counters', {}).get('+1/+1', 0)) for c in incubators(p))
         + '. Proliferation can grow them before transformation; transforming costs two per token unless '
         'Glissa transforms the batch with her combat mode.', test=lambda p: bool(incubators(p)),
         kinds=['play', 'mode'])
adv.when('Glissa can transform ALL existing Incubators with one combat mode and no mana payment. '
         'Alternatively she incubates two new bodies; a new noncreature Incubator is not immediate attacking power.',
         board=['Glissa, Herald of Predation'], kinds=['mode'],
         test=lambda p: 'Glissa' in p.decision.get('prompt', ''))
adv.when(lambda p: 'Atraxa is untapped with power '
         + p.permanent("Atraxa, Praetors' Voice").get('pt', '?/?').split('/')[0]
         + '. Her vigilance preserves that station resource after attacking; stationing before combat '
         'would tap her. Summoning sickness does not prevent serving as station crew.',
         board=["Atraxa, Praetors' Voice"], test=lambda p: not p.tapped("Atraxa, Praetors' Voice"))
adv.when('Ezuri draws when YOU proliferate. Incubator/charge-counter growth can therefore replenish '
         'cards; this is different from merely putting a counter on something.', board=['Ezuri, Stalker of Spheres'])

adv.when(lambda p: f"Only {len(p.hand)} cards remain in hand. Decode draws two without requiring an "
         'artifact fleet or combat damage. Void is a bonus after a NONLAND permanent departure or warped '
         'spell this turn; sacrificing a fetchland does not enable it.', castable=['Decode Transmissions'],
         test=lambda p: len(p.hand) <= 4)
adv.when('Warp Speed overrides tapped-land entries. Its draw ability discounts only GENERIC mana for '
         'differently named lands; it still requires UU and sacrificing the enchantment.', board=['Warp Speed'])
adv.when('The passive opponents have no nonland permanents. Sunfall would erase your own creatures, '
         'not answer an opposing army; noncreature Incubators survive it.', castable=['Sunfall'],
         test=lambda p: bool(p.state.get('opponents')) and
         all(o.get('other') == 0 for o in p.state['opponents']))
adv.when(lambda p: 'Castable from the graveyard now: ' + ', '.join(p.castable_from['graveyard']) + '.',
         test=lambda p: bool(p.castable_from['graveyard']))

advise = adv.advise
