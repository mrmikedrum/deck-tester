# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. M0 (Forge spike) and
M1 (manual mode) shipped on 2026-10-23; what they built is in [architecture](architecture.md).

## M2 — Automated mode

Pilot SDK, settled against the decisions M1 surfaces. Forge AI fallback, `run` batches across threads with
per-game seeds, standard metrics, deck-plan checkpoints, a batch report, and `cards` across a batch.

Done when 100 games of eight turns finish in about a minute (a benchmark; game length is the caller's choice) and
the report fits on one screen.

## M3 — Card fixes

The `cards/` overlay, plus a way to load one card into a small scenario and confirm it behaves.

Done when an agent can fix a misbehaving card without touching Java.

## Later

- Surface the decisions Forge's AI still makes in manual mode (see architecture) as decks need them, and
  record the ones it keeps.
- Paired comparisons across deck revisions.
- Deckmaster's playtest skill calling `goldfish`.
