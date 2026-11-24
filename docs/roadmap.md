# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. What has shipped is
described in [architecture](architecture.md).

## The agent

The agent skills and the ManaBox CLI (Node, run as `deckmaster manabox`) move in from the decks repository, which
keeps only deck state; ManaBox's login and catalog state move to `~/.local/share/deckmaster/`, and Drummer's skill
is reinstalled from here. Importing a player's deck from the game client comes later, with multiplayer.

## The game client on TypeScript

Strict TypeScript and Vite, three.js from npm, split by concern out of `h.js` and `live.js`, with the seat layout
as a pure module of its own. Each step keeps recordings equivalent. Its own plan comes first; the
[handoff](game-client-migration.md) holds what is decided, what is open, and how to check a step.

## The game's protocol

Types for the engine's view and decisions as the client's contract, checked against views a real engine game
saves as fixtures, so a shape change breaks the client build.

## Opponents' boards, then the look loop again

A design exploration of how big opponent boards read (several real-world paradigms side by side, judged blind),
then the look loop resumes on the new modules, its lanes on branches with pull requests.

## Browser target handoff

A verified controller fix clears AI-preset targets before a browser-owned cast/activation asks for targets.
The native browser regression casts Marath, chooses his counter mode, explicitly selects Grizzly Bears,
and checks that Bears receives the counter while Marath pays one. It must be loaded at the next engine
restart; the currently running human game is deliberately left untouched until Mike authorizes ending it.

## Manual-play legality regression

- Fix the affordability false negative for Marath with untapped Adagia, Windswept Bastion / Stomping Ground /
  Command Tower. The three sources can pay W/R/G. `ManualController.playable()` rejects the commander through
  `ComputerUtilCost.canPayCost`, with `targetable=true` and `payable=false`. Reproduced independently of
  the live table, before and after adding Cryptic Trilobite; replacing only Tower with a Forest offers
  Marath immediately. No opposing taxes or prior commander casts are required. Diagnose the existing
  Forge mana-payment path rather than implementing a second rules engine. Browser seats now offer real
  mana abilities before casting, so floating Tower's green lets Forge pay Marath from that pool plus
  Adagia's white and Stomping Ground's red. The native manual-mana regression verifies this workaround;
  the automatic matcher false negative remains open.

## M2, the rest

Deck-plan checkpoints, missing-colour and flood flags, resuming an automated game by hand, and a state view
for pilots.

## M3 — Card support workflow

Local card scripts work today ([architecture](architecture.md#local-card-scripts)). Still to build:

- Import a card from a newer upstream snapshot into the series' card patch when it works on our engine,
  with its upstream commit and path as provenance, before writing one ourselves.
- Record verification per card: the scenarios it passed, on which Forge build, and a human sign-off where
  the rules are subtle.
- Let our script override an upstream card that turns out broken; today bootstrap refuses any name upstream
  defines.
- Once the workflow is trusted, offer our scripts upstream as script-only PRs.

## Decision model, next

- More scenarios (`bench/scenarios.py`): the late land drop held in hand (Jev misses more than Forge's AI
  from turn 6), fetch-land timing, rocks versus creatures, counters versus tokens for Marath, draw
  engines; then confirm on 40 games against the baseline in [measurements](measurements.md).
- More advisor roles as decks need them (`deckmaster/advice.py`): sacrifice outlets, untap effects, cost
  reducers; and a scenario for each role that gets a line.
- Confirm the after-line on 40 games against the baseline (it is measured on the bench only).
- An ability Forge offers but that can't be paid (a crew with every creature tapped) fails, and Jev chooses it
  again: nine times in one round at a four-Jev table (measurements, Tables). Saying an option just failed is
  the likely fix; measure it on goldfish too.
- Station: Jev stations past a Spacecraft's threshold (one Atraxa game tapped seven creatures a turn up
  to 44 charge counters); every line looks the same in development terms. A threshold fact in the deck's
  advisor is the likely fix.

## Tables

`deckmaster table` hosts agents with people (architecture, Tables). Next:

- Copy forks that still fail now and then: a rebound spell (Ephemerate) not offered at the copy's upkeep, a token
  missing from a copy's targets, and cards put on the bottom in random order (Dack Fayden), since the table's
  random sequence is shared by every seat.
- Jev's table misses (`bench/table_scenarios.py`, measurements): holding a flash creature at the end of the turn
  before its own, a second activation of an ability already on the stack (Oboro bounced itself seven times in
  one turn at a table), keeping the untapped copy of a tapped commander at the legend rule (once in a Blue Moon
  batch; its scenario is right 5 in 5). More situations: counterspells and other responses to a spell, combat
  tricks after blocks.
- A fork is refused when another player acted after the seat's last stop (blocks after an attacker's combat
  trick, say), and that decision is asked from the text alone: copies taken at the other players' priority
  would let it be played out.
- Retire replaying whole games from the seed once copy forks have held across a few pin bumps.
- Compare Jev with Forge's Monte Carlo AI (`run --ai flatmc`), the AI people meet in the desktop app.

## Overrides

- Princess Yue's death trigger doesn't fire from a `destroy` override (architecture, Overrides).

## Later

- Surface the decisions Forge's AI still makes in manual mode (see architecture) as decks need them, and
  record the ones it keeps.
- Paired comparisons across deck revisions.
- Drop the thread-safe ids patch when Forge moves its id counters into `Game` (upstream issue 11260).
