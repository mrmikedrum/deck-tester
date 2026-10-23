# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships.

## M0 — Forge spike

Build Forge headless from a pinned commit. Play `examples/decks/eternities-living-worlds-iii.txt` against
three passive opponents to turn 8 with Forge's AI. Prove that `PilotController` can intercept a decision
and park the game thread, and that `GameCopier` round-trips a mid-game state.

Done when the unverified list in [architecture](architecture.md) has measured answers. The decision to
build on Forge holds or is revisited on those answers.

## M1 — Manual mode

Engine server and `bin/goldfish` session commands. Compact state view, every decision surfaced, overrides,
snapshots, records, and `show` digests.

Done when an agent can play the example deck to turn 8 entirely by hand and read the trace afterwards.

## M2 — Automated mode

Pilot SDK, settled against real decisions from M1. Forge AI fallback, `run` batches across threads,
standard metrics, deck-plan checkpoints, batch report.

Done when 100 games to turn 8 finish in about a minute and the report fits on one screen.

## M3 — Card fixes

The `cards/` overlay, plus a way to load one card into a small scenario and confirm it behaves.

Done when an agent can fix a misbehaving card without touching Java.

## Later

Paired comparisons across deck revisions, and Deckmaster's playtest skill calling `goldfish`.
