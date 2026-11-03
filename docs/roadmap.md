# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. M0 (Forge spike), M1
(manual mode) and the core of M2 (automated batches) shipped on 2026-10-23; what they built is in
[architecture](architecture.md).

## M2, the rest

Deck-plan checkpoints, missing-colour and flood flags, resuming an automated game by hand, and a state view
for pilots.

## M3 — Upstream card support

The [Forge dependency procedure](architecture.md#forge-dependency) owns updates and compatibility.
Done when a tested, reproducible upstream engine/resource pin supports the requested cards.

## Decision model, next

- More scenarios (`bench/scenarios.py`): the late land drop held in hand (Jev misses more than Forge's AI
  from turn 6), fetch-land timing, rocks versus creatures, counters versus tokens for Marath, draw
  engines; then confirm on 40 games against the baseline in architecture.
- More advisor roles as decks need them (`goldfish/advice.py`): sacrifice outlets, untap effects, cost
  reducers; and a scenario for each role that gets a line.
- Confirm the after-line on 40 games against the baseline (it is measured on the bench only).
- Fork drift under parallel load (architecture, "Measured: forks"): find the remaining shared state in
  Forge that games running side by side disturb; sequential replay is exact.

## Later

- Surface the decisions Forge's AI still makes in manual mode (see architecture) as decks need them, and
  record the ones it keeps.
- Paired comparisons across deck revisions.
- Deckmaster's playtest skill calling `goldfish`.
