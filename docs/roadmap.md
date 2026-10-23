# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. M0 (Forge spike), M1
(manual mode) and the core of M2 (automated batches) shipped on 2026-10-23; what they built is in
[architecture](architecture.md).

## M2, the rest

Deck-plan checkpoints, missing-colour and flood flags, resuming an automated game by hand, and a state view
for pilots.

## M3 — Card fixes

The `cards/` overlay, plus a way to load one card into a small scenario and confirm it behaves.

Done when an agent can fix a misbehaving card without touching Java.

## Later

- Surface the decisions Forge's AI still makes in manual mode (see architecture) as decks need them, and
  record the ones it keeps.
- Paired comparisons across deck revisions.
- Deckmaster's playtest skill calling `goldfish`.
