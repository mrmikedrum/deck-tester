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

adv.when('Wormhole triggers once when you attack, even with several attackers or a zero-power creature. '
         'The New Planet is a LAND token, not a creature token: it cannot recharge Staff of the Storyteller.',
         board=['Stable Wormhole'], kinds=['play', 'attack'])

adv.when('Song copies a creature token\'s original characteristics, not its +1/+1 counters. '
         'Base-sized Elementals, Beasts and Golems are useful; the counter-sized 0/0 Alien is not equivalent.',
         any_of={'board': ['Song of the Worldsoul'], 'castable': ['Song of the Worldsoul']})
adv.when('Inspiring Call is card flow as well as protection: it draws for creatures bearing +1/+1 '
         'counters. It does not draw for a counterless token or for charge counters on a ship.',
         castable=['Inspiring Call'])
adv.when('Marath returned directly by Cosmic Rebirth has zero mana spent and normally enters with '
         'zero counters unless an extra-counter replacement supplies some. Returning him to hand allows an ordinary paid cast instead.',
         kinds=['confirm'], test=lambda p: 'Cosmic Rebirth' in p.decision.get('prompt', '')
         and 'Marath' in p.decision.get('prompt', ''))
adv.when(lambda p: 'Castable from the graveyard now: ' + ', '.join(p.castable_from['graveyard']) + '.',
         test=lambda p: bool(p.castable_from['graveyard']))

adv.when('Exploratory Mission triggers for each land entry and exiles through a NONLAND card. '
         'Play that card THIS turn; put Mission down before a land drop when affordable. '
         'Proliferation can add quest counters, but the RR bonus is produced by a resolving landfall '
         'trigger with at least five quest counters, not merely by reaching five counters.',
         any_of={'board': ['Exploratory Mission'], 'castable': ['Exploratory Mission']})
adv.when('Wrenn\'s Resolve and Escape to the Wilds provide playable cards until the END OF YOUR '
         'NEXT TURN, not cards in hand. Budget mana and land allowances for the exiled options. '
         'Escape grants its extra land play only this turn.',
         any_of={'castable': ["Wrenn's Resolve", 'Escape to the Wilds']})
adv.when('Commune with Lava costs X plus RR and grants access through your next turn. '
         'Use an affordable X with mana left to use the cards; Unbound Flourishing copies the '
         'spell, revealing another X cards, rather than making the payment free.',
         castable=['Commune with Lava'])

adv.when(lambda p: 'PLAYABLE FROM EXILE NOW: ' + ', '.join(p.castable_from['exile']) +
         '. These are real currently legal options, not just exiled card names. Use expiring access '
         'before spending the same mana or land allowance on replaceable plays from hand. '
         'An exiled land can save a land in hand for next turn. Do not pass the deadline '
         'or activate optional mana sinks while useful exiled development is affordable.',
         test=lambda p: bool(p.castable_from['exile']))
adv.when('You already have a functional mana base. Before adding more ramp or spending on adapt, '
         'prioritize drawing/casting useful spells, deploying varied life, and exploiting expiring exile '
         'access. Mana production is not this deck\'s bottleneck once the hand is thinning.',
         test=lambda p: p.mana >= 6 and len(p.hand) <= 3)
adv.when('Return of the Wildspeaker draws only the greatest NON-HUMAN power right now. '
         'Check that number before paying five: one or two cards is a poor normal refill. '
         'Grow a creature or create a substantial Elemental first if feasible, and keep mana for the '
         'refill. Human captains do not set this draw count.',
         castable=['Return of the Wildspeaker'])

adv.when('Bankbuster is a card reserve even without crew: pay two, tap and remove one charge '
         'to draw. Proliferation can replenish its charges. Preserve enough untapped mana to use '
         'the new card; crew is optional and competes with useful creatures, not a prerequisite to draw.',
         board=['Reckoner Bankbuster'])

adv.when('There are NO opposing nonland permanents. Let expiring removal expire rather than '
         'destroying your own useful engine merely to use the card. In particular, Emergency Eject '
         'on your own Loading Zone is not successful card advantage. Expiring access is a priority '
         'only for USEFUL development; a dead reactive card is not an obligation to cast it.',
         kinds=['play', 'targets'],
         test=lambda p: all(o.get('other', 0) == 0 for o in p.state.get('opponents', []))
         and any(n in p.castable for n in ['Emergency Eject', 'Chaos Warp', 'Sundering Growth', 'Swords to Plowshares']))

adv.role('mana_myr', 'Copper Myr', 'Gold Myr', 'Iron Myr')
adv.when('These Myr are one-mana sources after summoning sickness wears off: Copper makes green, '
         'Gold makes white, Iron makes red. Counters grow their bodies, not their mana output. '
         'Stationing taps a Myr and competes with its mana ability; a sick Myr may serve as station '
         'crew but cannot yet tap for mana.',
         any_of={'board': ['mana_myr'], 'castable': ['mana_myr']})
adv.when('Harmonize draws three without needing creatures, counters, combat or graveyard targets. '
         'It can start card flow while conditional engines are missing their input.', castable=['Harmonize'])
adv.when('Terrasymbiosis needs +1/+1 counters placed on a CREATURE and draws that many only once '
         'per turn. Charge/quest growth alone does not feed it. Sequence it before a large placement '
         'or counter-bearing creature entry when useful; optional draw can be declined.',
         board=['Terrasymbiosis'])

adv.when('Scholar can remove ANY counter from a permanent you control, not just a +1/+1 counter '
         'from itself. It finds a PLAINS card, including Temple Garden or Sacred Foundry, not only a '
         'basic. The land goes onto the battlefield tapped only if an opponent controls more lands '
         'and you choose to do so; otherwise it goes to hand. A sick Scholar cannot activate. '
         'Do not spend a creature’s last survival counter or a critical world/engine threshold '
         'without a concrete benefit.', board=['Scholar of New Horizons'])
adv.when('Walking Ballista costs XX: normally paying four gives X=2, not four counters. '
         'Proliferation and counter enhancers can replenish it; its four-mana counter activation '
         'and remove-a-counter damage ability do not tap it. Removing its last counter normally '
         'kills the 0/0 body. X=0 normally dies immediately unless a counter replacement keeps it '
         'alive or another concrete benefit justifies it. Unbound Flourishing doubles the X of '
         'this permanent spell, unlike Marath’s fixed casting cost.',
         any_of={'board': ['Walking Ballista'], 'castable': ['Walking Ballista']})
adv.when('Broodship needs 3 charge counters for an extra land play, and 8 to become a flying '
         'creature with once-on-your-turn permanent-spell access from the graveyard. That cast '
         'requires sacrificing a land in addition to its other costs. Check lands in hand and '
         'real graveyard targets before spending creatures on station.', board=['Exploration Broodship'])
adv.when('Staff of the Storyteller supplies its own Spirit, then gains a story counter for each '
         'event creating one or more creature tokens. Its white-mana/tap draw spends a story counter. '
         'Wormhole land tokens do not recharge it.', board=['Staff of the Storyteller'])
adv.when('Tribute checks the entering creature’s power as its trigger resolves: power at least '
         'three draws a card; otherwise it places two +1/+1 counters. This is not a Human/non-Human '
         'restriction. Counter enhancers can enlarge that placement.', board=['Tribute to the World Tree'])
adv.when('War Room can refill a thin hand without a creature or counter engine: pay three mana, '
         'tap the land and pay THREE life with Marath. Prefer a useful charged Bankbuster draw '
         'when cheaper, and do not spend all remaining access on optional sinks.',
         board=['War Room'], test=lambda p: len(p.hand) <= 2 and p.mana >= 4)
adv.when('Trilobite removes a +1/+1 counter for TWO colorless mana usable ONLY for activating '
         'abilities, not casting spells. It can fund Marath, Ballista’s four-mana growth, or other '
         'abilities, but do not count it as generic spell mana. Removing its last counter normally '
         'kills it. Marath plus Trilobite and an extra-counter replacement can create a repeatable '
         'mana/counter loop; identify that actual line rather than inventing a mandatory combo plan.',
         board=['Cryptic Trilobite'])

advise = adv.advise
