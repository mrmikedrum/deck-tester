# Seat: what it is for

Mike's goals for the table, with why. A change may replace how a goal is met (the "now" notes) with something that
meets it better; it may not give up the goal. A finding that a goal itself is wrong goes under "For Mike".

When goals pull against each other, or a finding offers several fixes, choose whatever gives the player the most clarity.

## Goals
- **Understand the board at a glance.** Clarity over density: open space, instant recognition, a composed tabletop
  rather than a dashboard. *Why:* density is the bane of understandability; Arena is the minimum bar.
- **Never miss what changes.** Whatever just changed (a spell, an attack, a card arriving or leaving, whose turn it is)
  is on screen and drawn to the eye, and nothing that changes is hidden or off screen. *Now:* the stack comes to the
  middle and dims the table; the turn player's page comes forward a little.
- **Look closer without getting lost.** A player can look at one seat, a pile or a card closely and get back in one
  tap; the view may move to show activity, but never in a way that hides activity elsewhere, and never needs
  navigating (no free pan, pinch or orbit). *Now:* leaning in brings a page forward; a camera that frames the action is
  equally fine if it pulls back when something happens elsewhere and lets the player look again.
- **Piles never hide what acts.** A card that attacks, blocks, dies, is targeted or otherwise acts leaves its pile while
  it acts, so the player sees exactly how many and which; it rejoins after. *Why:* a pile acting as a whole can't say
  how many are involved.
- **Gone is visible.** Cards leaving the battlefield go somewhere the player can see and review: exile has a readable
  place of its own, not a heap, and a mass exile or wipe reads as the major event it is.
- **Spatial permanence.** Each opponent always sits in the same place relative to me, boards are never shown from
  their side, and a card that stays on the battlefield stays where it was. *Why:* place is how a player remembers.
- **What matters first.** For opponents: creatures, then artifacts, enchantments and planeswalkers; their lands barely
  matter. Tapped reads instantly. *Now:* creatures stand up; everything else lies flat.
- **Real objects, behaving like them.** Cards, piles and pages move, pile and stack as things on a real table would;
  realism is a means to legibility, not the goal.
- **One look, not a collage.** *Now:* the Grimoire (vellum pages with ruled borders in the seat colour, bronze mounts,
  brass plaques, scorched ash under standees, a red sigil under a card in danger, wells glowing under lands, a
  crackling arc for aim). Details may change; a consistent world may not.
- **Quiet chrome.** The table shows life only; counts and details go behind a tap. Pop-ups close with ✕, a tap
  outside or Escape.

## Hard limits (measured by tools/packet.js; a change that breaks one is not done)
- **Nothing on the battlefield is hidden.** Every permanent is either drawn on its page or in a pile with a visible
  count that opens a sift of the cards at full size when tapped.
- **Floor sizes** (card face width on screen at 1180×820, every seat including across): any card or pile 44 px; an
  opponent's creature 56 px; my creatures 72 px. Cards never shrink below these to fit: a board that outgrows its page
  folds into piles instead. Few cards never render small.
- **Tappable.** Every card and pile has at least a 44×44 pt patch that the hit test gives to it (Apple's minimum).
- **Nothing covers what a card says.** No other card, label or panel hides more than a fifth of a card's name strip or
  of its foot (power, toughness, counters), or more than a third of its face. A pile's own cards may overlap each other.
- **Folding order** as a board grows: identical cards pile with a count; opponents' lands are one pile; mana rocks join
  the lands; then like noncreatures fan into a named pile ("Artifacts 5"); only then, and only when the page is at its
  largest, do unlike creatures share a "+N" pile. A mixed pile hides what it holds, so it is the last resort, never a
  way to meet another limit: no creature sits in a mixed pile while a noncreature on its page still lies on its own.
  Legendary and commander cards stay out of piles as long as anything else can fold.
