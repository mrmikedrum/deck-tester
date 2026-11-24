# Seat: what it is for

Design goals for the table, with why. A change may replace how a goal is met (the "now" notes) with something that
meets it better; it may not give up the goal. A finding that a goal itself is wrong goes under "Goal questions".

When goals pull against each other, or a finding offers several fixes, choose whatever gives the player the most clarity.

## Goals
- **Understand the board at a glance.** Clarity over density: open space, instant recognition, a composed tabletop
  rather than a dashboard. *Why:* density is the bane of understandability; Arena is the minimum bar.
- **Never miss what changes.** Whatever just changed (a spell, an attack, a card arriving or leaving, whose turn it is)
  is on screen and drawn to the eye, and nothing that changes is hidden or off screen. *Now:* the turn player's page
  comes forward a little.
- **Focus: one thing at a time may take the table.** Some moments deserve the player's whole attention: the stack,
  a combat, one opponent's board, a pile. A focus is modal: it comes forward over the rest of the table, as large and
  central as reads best, and may cover and dim the rest, because one tap away (or Escape) dismisses it and the whole
  board is back as it was. Inside a focus everything reads fully (the real card image where that helps), and what the
  focus involves (the cards the stack targets, the creatures in a combat) comes up above the dim in its own place on
  the board, never covered. A focus never hides change: when something happens elsewhere it steps aside or shows it.
  *Now:* the stack comes forward and dims the table; tapping away sets it aside small, tapping it brings it back;
  leaning in brings a seat's page forward. Combat could have a focus of its own. *Why:* overlapping or dimming the
  background is fine when it is modal and one-tap dismissible — use it as a tool for clarity.
- **Look closer without getting lost.** A player can look at one seat, a pile or a card closely and get back in one
  tap; the view never needs navigating (no free pan, pinch or orbit). A camera that frames the action is fine if it
  pulls back when something happens elsewhere and lets the player look again.
- **Piles never hide what acts.** A card that attacks, blocks, dies, is targeted or otherwise acts leaves its pile while
  it acts, so the player sees exactly how many and which; it rejoins after. *Why:* a pile acting as a whole can't say
  how many are involved.
- **Gone is visible.** Cards leaving the battlefield go somewhere the player can see and review: exile has a readable
  place of its own, not a heap, and a mass exile or wipe reads as the major event it is.
- **Spatial permanence.** Each opponent always sits in the same place relative to me, boards are never shown from
  their side, and a card that stays on the battlefield stays where it was. *Why:* place is how a player remembers.
- **What matters first.** For opponents: creatures, then artifacts, enchantments and planeswalkers; their lands barely
  matter. Tapped reads instantly. *Now:* creatures stand up; everything else lies flat.
- **A big board reads like a player describing it.** Past a certain size people stop looking at every card on a real
  table too: they shingle creatures, put one token card under a die, push tapped things aside, and say what they have:
  "30 power, 16 of it trample, two fliers, biggest is an 8/8, one deathtouch". When a board outgrows its place, lean on
  that kind of summary, and on hints that answer the player's real question at that moment ("no fliers that can block",
  "your Baloth can block this"), rather than on more, smaller cards. Overlap on purpose (a shingled column, a fanned
  row, a regiment of tokens) is welcome when the group says what it holds and each card can still be told apart or
  opened. *Why:* intentional overlap and summary text/UI hints scale far better than shrinking cards to illegible
  postage stamps — take inspiration from what real players do under real table constraints.
- **Opponents' boards are open to rethinking.** Fixed-size pages were the loop's own fix for wonky mat transitions,
  not a goal. Any paradigm that shows a big opponent board usably and legibly is welcome, if it still feels real: a
  physical mat that simply grows and shrinks doesn't, but other real-world arrangements might.
- **Real objects, behaving like them.** Cards, piles and pages move, pile and stack as things on a real table would;
  realism is a means to legibility, not the goal.
- **One look, not a collage.** *Now:* the Grimoire (vellum pages with ruled borders in the seat colour, bronze mounts,
  brass plaques, scorched ash under standees, a red sigil under a card in danger, wells glowing under lands, a
  crackling arc for aim). Details may change; a consistent world may not.
- **Quiet chrome.** The table shows life only; counts and details go behind a tap. Pop-ups close with ✕, a tap
  outside or Escape.

## Hard limits (measured by tools/packet.js; a change that breaks one is not done)
- **Game behaviour is not this loop's to change.** What the client sends the engine (which decisions it answers, with
  which options, in what order, and when it answers on its own) stays as it is; only how things are shown and offered
  changes. The recordings use a mocked engine, so they can't catch a mistake here: keep the protocol untouched.
- **Nothing on the battlefield is hidden.** Every permanent is either drawn on its page or in a pile with a visible
  count that opens a sift of the cards at full size when tapped.
- **Floor sizes** (card face width on screen at 1180×820, every seat including across): any card or pile 44 px; an
  opponent's creature 56 px; my creatures 72 px. Cards never shrink below these to fit: a board that outgrows its page
  folds into piles instead. Few cards never render small.
- **Tappable.** Every card and pile has at least a 44×44 pt patch that the hit test gives to it (Apple's minimum).
- **Nothing covers what a card says.** No other card, label or panel hides more than a fifth of a card's name strip or
  of its foot (power, toughness, counters), or more than a third of its face. A pile's own cards may overlap each other.
  This is the board at rest: a focus may cover the rest of the table, but never what it involves. The audit measures
  the board with any focus set aside (the stack, and any 3D object marked `userData.focus = true` or HTML element marked
  `data-focus`), then checks that the focus covers none of what it involves (the stack's targets, and the card ids in a
  focus object's `userData.involves`).

## Folding by importance (judged, not measured)
When a board outgrows its place, the least important things fold, overlap or summarise first, and the most prominent
stay out longest. First to go: lands and mana rocks, identical cards (one pile with a count), tapped things, small
creatures and plain tokens. Last to go: the commander, legendary and big creatures, anything evasive or with a keyword
that changes combat (flying, trample, deathtouch, menace, lifelink, first strike, indestructible, hexproof),
planeswalkers, and anything that acts on me or on a creature (auras, equipment, a card targeting or affecting play). A
mixed pile or summary must say what it holds in the terms that matter (count, total power, the keywords in it, the
biggest).
