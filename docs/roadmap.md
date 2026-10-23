# Roadmap

Each milestone ends with something an agent can use. Delete a milestone when it ships. M0, the Forge spike,
shipped on 2026-10-23; its measurements are in [architecture](architecture.md#measured-in-m0-2026-10-23-apple-silicon-10-cores-jdk-21).

## M1 — Manual mode

Engine server and `bin/goldfish` session commands. Compact state view, every decision surfaced (affordable
options only, with short labels), overrides, snapshots, records, and `show` digests.

Done when an agent can play the example deck to turn 8 entirely by hand and read the trace afterwards.

## M2 — Automated mode

Pilot SDK, settled against real decisions from M1. Forge AI fallback, `run` batches across threads with
per-game seeds, standard metrics, deck-plan checkpoints, batch report.

Done when 100 games to turn 8 finish in about a minute and the report fits on one screen.

## M3 — Card fixes

The `cards/` overlay, plus a way to load one card into a small scenario and confirm it behaves.

Done when an agent can fix a misbehaving card without touching Java.

## Later

Paired comparisons across deck revisions, and Deckmaster's playtest skill calling `goldfish`.
