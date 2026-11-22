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

adv.when('Warp Speed overrides tapped-land entries. Its draw ability discounts only GENERIC mana for '
         'differently named lands; it still requires UU and sacrificing the enchantment.', board=['Warp Speed'])
adv.when('The passive opponents have no nonland permanents. Sunfall would erase your own creatures, '
         'not answer an opposing army; noncreature Incubators survive it.', castable=['Sunfall'],
         test=lambda p: bool(p.state.get('opponents')) and
         all(o.get('other') == 0 for o in p.state['opponents']))
adv.when(lambda p: 'Castable from the graveyard now: ' + ', '.join(p.castable_from['graveyard']) + '.',
         test=lambda p: bool(p.castable_from['graveyard']))

adv.role('mana_myr', 'Copper Myr', 'Gold Myr', 'Silver Myr')
adv.when('These Myr are one-mana sources after summoning sickness wears off: Copper makes green, '
         'Gold makes white, Silver makes blue. Counters grow their bodies, not their mana output. '
         'Stationing taps a Myr and competes with its mana ability; a sick Myr may serve as station '
         'crew but cannot yet tap for mana.',
         any_of={'board': ['mana_myr'], 'castable': ['mana_myr']})
adv.when('Harmonize draws three without needing creatures, counters, combat or graveyard targets. '
         'It can start card flow while conditional engines are missing their input.', castable=['Harmonize'])
adv.when('Terrasymbiosis needs +1/+1 counters placed on a CREATURE and draws that many only once '
         'per turn. Charge/quest growth alone does not feed it. Sequence it before a large placement '
         'or counter-bearing creature entry when useful; optional draw can be declined.',
         board=['Terrasymbiosis'])

adv.when('Insight Engine makes its own charge counter before drawing for its charge total. '
         'It does not require a creature army; spare mana can deploy and start this card engine '
         'instead of leaving it in hand while repeatedly buying small upgrades.',
         any_of={'board': ['Insight Engine'], 'castable': ['Insight Engine']})
adv.when('Uthros Research Craft needs 3 charge counters before FUTURE artifact casts draw cards '
         'and add another charge. Tokens and transformations do not count as casts. Its creature '
         'threshold is 12; station crew competes with mana and combat.', board=['Uthros Research Craft'])
adv.when('A charged Bankbuster draws for two mana, tap and one charge without needing crew. '
         'Proliferation replenishes charges; crewing is optional and must not repeatedly consume '
         'the creatures needed for actual development.', board=['Reckoner Bankbuster'])
adv.when('Steel Overseer seeds or grows +1/+1 counters on EACH artifact creature, not on '
         'ordinary noncreature artifacts or untransformed Incubators. It needs tap and cannot '
         'activate while summoning-sick; deploy it before expecting repeated army upgrades.',
         any_of={'board': ['Steel Overseer'], 'castable': ['Steel Overseer']})
adv.when('Inspiring Call draws for creatures with +1/+1 counters and protects them. A large '
         'counterless Borg army does not by itself make a large refill.', castable=['Inspiring Call'])
adv.when('The Borg Queen’s static +2/+2 grows other artifact creatures WITHOUT adding counters. '
         'That pumps an unseeded Borg army, but does not itself create new proliferation targets.',
         board=['The Borg Queen'])

advise = adv.advise
