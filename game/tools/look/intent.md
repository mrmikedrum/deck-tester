# Design intent

- **Clarity over density.** Keep the table open and let players find the important information where
  they expect it. At a glance they should know whose turn it is, what changed and what they can do.
- **A physical, steady table.** Give cards real proportions, warm light and real shadows so they
  feel like objects on the surface. Mats keep their size and place. The table makes room only when
  a game object moves into the middle. Seats stay put relative to the player, with side seats facing
  square to the viewer. Familiar positions let players find a card again without searching.
- **Light directs attention.** The stack and its targets can step out of realism over a light dim.
  A lamp-coloured rim and ember show usable cards in place. Tapped cards are greyed and slightly
  tilted so players can read their state without following their movement.
- **One card size.** Keep the same physical scale as the board fills. Put overflow in piles, and
  give each pile a clear way to open its cards. Keep acting cards identifiable and cue relevant
  cards inside a pile. Spread and pile sheets can bring cards nearer and page to preserve legibility.
- **Commanders and seats are distinct at a glance.** A waiting commander is a portrait on its
  nameplate. A commander on the field has a distinct name treatment and shares the other cards'
  frame. Top nameplates use the old Grimoire serif and its own icons: sword for power, mana gem
  for mana, cards for hand. A tap opens the seat's focus and zones, including graveyard and exile.
  Fixed panels fit their space without scrolling.
- **The corner hand fan holds the printed cards.** Players know their cards from the frame, art
  and type. Show cost changes next to them with teal ↓ for a reduction and red ↑ for an increase.
- **Quiet chrome from the same world.** Use dark-bronze Grimoire buttons with the fewest words the
  game's terms allow. Pop-ups close with ✕, a tap outside, or Escape, so a closer look is easy to undo.
- **Crisp at iPad size.** Soft or faint text fails. Judge the table held in landscape at 1210×834 CSS
  pixels, DPR 2, with the full-size stills. Portrait is outside the loop.

## Hard limits

- Preserve the engine contract, including which answers the client sends, their option numbers,
  order and automatic timing. The scripted recordings cover presentation. Use behaviour tests
  and inspect the diff for protocol changes.
- Every permanent is reachable, on the table or through an obvious pile. The drawn-table audit
  checks face widths of at least 44 CSS px for every card or pile, 56 for an opponent's standing
  creature and 72 for my standing creature, at 1180×820 and scaled by the design unit elsewhere.
  A creature lying (tapped, in a pile, in the back) is held to 44, and a turned card is measured
  unturned: a turn is not a smaller card. Each piece has a 44×44 CSS px tap patch.
- A card's name or stats strip can lose at most 20% to another piece or panel, and its face at
  most 35%. A focus can cover the background while keeping its subjects readable. Table labels
  are at least 11 CSS px and clear of other labels, names and stats.
- A regression in look, taste or legibility blocks the round and goes to the owner, even if the
  change improves other findings.
