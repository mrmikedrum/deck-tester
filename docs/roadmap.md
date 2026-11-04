# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. What has shipped is
described in [architecture](architecture.md).

## M2, the rest

Deck-plan checkpoints, missing-colour and flood flags, resuming an automated game by hand, and a state view
for pilots.

## M3 — Card support workflow

Local card scripts work today ([architecture](architecture.md#local-card-scripts)). Still to build:

- Import a card from a newer upstream snapshot into `cards/` when it works on our engine, with its upstream
  commit and path as provenance, before writing one ourselves.
- Record verification per card: the scenarios it passed, on which Forge build, and a human sign-off where
  the rules are subtle.
- Let our script override an upstream card that turns out broken; today the installer refuses any name
  upstream defines.
- Once the workflow is trusted, offer our scripts upstream as script-only PRs.

## Decision model, next

- More scenarios (`bench/scenarios.py`): the late land drop held in hand (Jev misses more than Forge's AI
  from turn 6), fetch-land timing, rocks versus creatures, counters versus tokens for Marath, draw
  engines; then confirm on 40 games against the baseline in [measurements](measurements.md).
- More advisor roles as decks need them (`goldfish/advice.py`): sacrifice outlets, untap effects, cost
  reducers; and a scenario for each role that gets a line.
- Confirm the after-line on 40 games against the baseline (it is measured on the bench only).
- Station: Jev stations past a Spacecraft's threshold (one Atraxa game tapped seven creatures a turn up
  to 44 charge counters); every line looks the same in development terms. A threshold fact in the deck's
  advisor is the likely fix.

## Overrides

- Princess Yue's death trigger doesn't fire from a `destroy` override (architecture, Overrides).

## Later

- Surface the decisions Forge's AI still makes in manual mode (see architecture) as decks need them, and
  record the ones it keeps.
- Paired comparisons across deck revisions.
- Drop the thread-safe ids patch when Forge moves its id counters into `Game` (upstream issue 11260).
