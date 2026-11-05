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

adv.when('Exploratory Mission triggers for each land entry and exiles through a NONLAND card. '
         'Play that card THIS turn; put Mission down before a land drop when affordable. '
         'Proliferation can add quest counters, but the RR bonus is produced by a resolving landfall '
         'trigger with at least five quest counters, not merely by reaching five counters.',
         any_of={'board': ['Exploratory Mission'], 'castable': ['Exploratory Mission']})
adv.when('Elemental Bond draws when a creature ENTERS with power at least three, including a '
         'base-3+ Marath Elemental or a real large Song copy. Growing an already present creature '
         'does not trigger Bond. Marath\'s initial three-counter cast can supply a draw.',
         board=['Elemental Bond'])
adv.when('Wrenn\'s Resolve and Escape to the Wilds provide playable cards until the END OF YOUR '
         'NEXT TURN, not cards in hand. Budget mana and land allowances for the exiled options. '
         'Escape grants its extra land play only this turn.',
         any_of={'castable': ["Wrenn's Resolve", 'Escape to the Wilds']})
adv.when('Commune with Lava costs X plus RR and grants access through your next turn. '
         'Use an affordable X with mana left to use the cards; Unbound Flourishing copies the '
         'spell, revealing another X cards, rather than making the payment free.',
         castable=['Commune with Lava'])
adv.when('Shamanic Revelation counts ALL your creatures, including small tokens and untapped '
         'or uncountered bodies. It is a refill, not a reason to wait for combat or deaths.',
         castable=['Shamanic Revelation'])

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
adv.when('Evolution Witness already has counters: adapt can still be activated but adds none '
         'and therefore returns NO card. Do not spend mana on that activation without a real '
         'counter-removal plan. Fetchland recovery is useful only if another land play is useful.',
         board=['Evolution Witness'], test=lambda p: p.counters('Evolution Witness') > 0)

adv.when('Riker can attack with vigilance and THEN tap to draw two for one mana in main two. '
         'Haste also permits immediate draw on the turn he enters. Activating gives the chosen opponent '
         'two cards too: prefer a trailing player in a real game, not automatically the leader. '
         'Do not station him first when the hand needs cards.',
         board=['Commander William Riker'])
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

adv.when('War Room is an emergency reserve: with this Naya commander its draw costs three '
         'mana, tapping the land, and THREE life. With a thin hand and at least four total mana '
         'available, consider drawing before simply passing. It needs no creatures or counters. '
         'Prefer a useful two-card Riker activation or charged Bankbuster when those are cheaper; '
         'do not let optional adapt/equip/crew consume this last access to new cards.',
         board=['War Room'], test=lambda p: len(p.hand) <= 2 and p.mana >= 4)
adv.when(lambda p: 'Shamanic Revelation currently counts only ' +
         str(sum('pt' in c for c in p.state.get('battlefield', []))) +
         ' creatures. Paying five to draw one or two is not a normal refill. Build the token '
         'ecosystem first if you can; use an independent source while the board is small.',
         castable=['Shamanic Revelation'],
         test=lambda p: sum('pt' in c for c in p.state.get('battlefield', [])) < 3)

adv.when(lambda p: 'Your hand already contains ' + str(len(p.hand)) +
         ' cards. Riker also gives an opponent two cards: do not activate him automatically '
         'while useful spells are waiting in hand or the extra cards will just be discarded. '
         'Spend resources deploying your ecosystem before feeding an opponent unnecessarily.',
         board=['Commander William Riker'], test=lambda p: len(p.hand) >= 6)

advise = adv.advise
