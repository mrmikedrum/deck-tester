"""Current Living Worlds advisor. Supply with --pilot and the living-worlds --guide.

These are conditional facts for the decision model, not a second rules engine or a deterministic pilot.
Keep the approved deck identity in the plan; put position-specific sequencing reminders here.
"""
from goldfish.advice import Advisor

adv = Advisor()
adv.role('fetch', 'Arid Mesa', 'Bloodstained Mire', 'Flooded Strand', 'Misty Rainforest',
         'Scalding Tarn', 'Verdant Catacombs', 'Windswept Heath', 'Wooded Foothills', 'Fabled Passage')

adv.when('A fetchland is offered now. This list has typed Forest/dual targets for green development; '
         'the fetch can fix early green rather than leaving green spells stranded behind Plains.',
         castable=['fetch'], test=lambda p: p.land_drop and p.turn.startswith(('T1 ', 'T2 ', 'T3 ')))

adv.when('Loading Zone doubles counters placed on your creatures, Spacecraft and Planets. '
         'It does not double the number of tokens, and an ordinary noncreature mana rock is not covered.',
         board=['Loading Zone'])
adv.when('Kami adds ONE extra +1/+1 counter per placement on your permanents; it is not a token doubler '
         'or a multiplier for charge counters.', board=['Kami of Whispered Hopes'])
adv.when('Unbound Flourishing copies Marath\'s X-cost activated ability and X instants/sorceries. '
         'Marath\'s fixed RGB casting cost does not contain X; the enchantment does not double his entry counters.',
         board=['Unbound Flourishing'], any_of={'board': ['Marath, Will of the Wild'],
         'castable': ['Marath, Will of the Wild']})

adv.when(lambda p: f"Marath has {p.counters('Marath, Will of the Wild')} +1/+1 counters and the board "
         f"shows {p.mana} available mana. Before modifiers, one activation can spend at most "
         f"{min(p.counters('Marath, Will of the Wild'), p.mana)} counters/mana. Spending the last counter "
         'can kill him; retaining a seeded growth engine is a different choice from making one larger token.',
         board=['Marath, Will of the Wild'],
         test=lambda p: p.counters('Marath, Will of the Wild') > 0 and p.mana > 0)
adv.when('Incubation Druid has no +1/+1 counter: its mana ability makes ONE mana, not three. '
         'Marath or another counter placement can seed its three-mana ability.',
         board=['Incubation Druid'], test=lambda p: p.counters('Incubation Druid') == 0)
adv.when('Incubation Druid is counter-seeded: when untapped and not summoning-sick it can tap for THREE '
         'mana of a type a land you control could produce. Tapping it as station crew consumes that resource.',
         board=['Incubation Druid'], test=lambda p: p.counters('Incubation Druid') > 0)

adv.when('Spelunking\'s optional land from hand is an additional battlefield entry, NOT your normal land '
         'play. Its untapped-entry effect also applies to fetched worlds.',
         kinds=['confirm', 'choose'], test=lambda p: 'Spelunking' in p.decision.get('prompt', ''))
adv.when('Tannuk draws on the SECOND landfall resolution this turn only. A normal land plus a fetch, '
         'Wormhole Planet, or land-search effect can supply that second entry; a third does not draw again.',
         board=['Tannuk, Memorial Ensign'], kinds=['play', 'attack'])
adv.when('Wormhole triggers once when you attack, even with several attackers or a zero-power creature. '
         'The New Planet is a LAND token, not a creature token: it cannot recharge Staff of the Storyteller.',
         board=['Stable Wormhole'], kinds=['play', 'attack'])
adv.when('Pike permits top-library LAND plays, not an extra land drop. Janeway or a stationed Broodship '
         'can provide an additional land allowance; those are distinct abilities.',
         board=['Captain Pike, Fullness of Time'])

adv.when('Song copies a creature token\'s original characteristics, not its +1/+1 counters. '
         'Base-sized Elementals, Beasts and Golems are useful; the counter-sized 0/0 Alien is not equivalent.',
         any_of={'board': ['Song of the Worldsoul'], 'castable': ['Song of the Worldsoul']})
adv.when('Inspiring Call is card flow as well as protection: it draws for creatures bearing +1/+1 '
         'counters. It does not draw for a counterless token or for charge counters on a ship.',
         castable=['Inspiring Call'])
adv.when('Discovery uses the native discover rules: casting an X spell for free sets X to zero. '
         'Putting that spell into hand preserves the option to pay a useful X later.',
         kinds=['confirm', 'choose'], test=lambda p: 'Discovery' in p.decision.get('prompt', ''))
adv.when('Marath returned directly by Cosmic Rebirth has zero mana spent and normally enters with '
         'zero counters. Returning him to hand allows an ordinary paid cast instead.',
         kinds=['confirm'], test=lambda p: 'Cosmic Rebirth' in p.decision.get('prompt', '')
         and 'Marath' in p.decision.get('prompt', ''))
adv.when(lambda p: 'Castable from the graveyard now: ' + ', '.join(p.castable_from['graveyard']) + '.',
         test=lambda p: bool(p.castable_from['graveyard']))

advise = adv.advise
