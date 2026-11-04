# AGENTS.md

MTG Goldfish lets agents playtest Commander decks by goldfishing, with Forge as the rules engine.
For routine piloting, use Deckmaster's goldfish skill and the [README](README.md); load further detail
only when the task needs it. For development or diagnosis, read [vision](docs/vision.md) for purpose,
[architecture](docs/architecture.md) for implementation, and relevant [decisions](docs/decisions.md);
[measurements](docs/measurements.md) hold the evidence and baselines.
[Roadmap](docs/roadmap.md) owns planned work. Reuse guidance already current in context.

## How to work here

- **Forge owns game rules.** Our code routes decisions, records facts and reports; a second rules
  implementation drifts and silently breaks the record. A missing card is a Forge card script, never code.
  The [Forge dependency procedure](docs/architecture.md#forge-dependency) owns support checks and updates.
- **The engine records facts; Python interprets them.** Metrics, plans and digests belong in `goldfish/`, so
  they change without a JVM rebuild.
- **Agents pay for every byte we print.** Default output is the shortest digest that supports a judgment,
  with detail behind a flag or a follow-up command. Don't add a field to a default view unless an agent
  needs it to decide something.
- **Never hide what the engine didn't do.** Unsupported cards, overrides, and decisions Forge's AI made
  must show up in the record and get flagged in reports.
- **Python stays standard-library only, 3.9-compatible**, like Deckmaster's tools. Java follows Forge:
  Java 17, Maven.
- **One home per idea.** Update the owning doc instead of restating it. Keep these docs short.

## Layout

| Path | What |
|------|------|
| `goldfish/` | Python package: CLI (`cli.py`), engine client (`engine.py`), record digests (`records.py`), text views (`render.py`), batches and pilots (`batch.py`), batch reports (`report.py`) |
| `bin/goldfish` | CLI entry point |
| `engine/` | Forge host: `Server` (socket), `Session` (one game), `ManualController` (decisions), `Recorder` (facts) |
| `scripts/` | `bootstrap-forge.sh` (fetch, patch and install pinned Forge), `build-engine.sh` (compile; the CLI runs it when needed), `forge-patches/` (our patch series) |
| `vendor/forge` | Pinned Forge checkout with the patch series on its `goldfish` branch, gitignored; card scripts in `forge-gui/res/cardsfolder` |
| `cards/` | Local Forge card scripts and their manifest; installed into `cardsfolder/goldfish-local` |
| `skills/forge-cards/` | Procedure for adding, checking and retiring local cards |
| `bench/` | Fork fidelity, scenarios and decision-model experiments |
| `examples/` | Real decklists used as fixtures, deck plans, pilots and advisors |
| `tests/` | `unittest` suites; `test_engine.py` plays a real game and skips without Forge |
| `.goldfish/` | Runtime, gitignored: engine socket and log, game records in `runs/` |

## Commands

```bash
scripts/bootstrap-forge.sh                  # once, and after the Forge pin or patches change (JDK 21, Maven)
python3 -m unittest discover -s tests -v   # all tests; the engine test needs Forge
bin/goldfish doctor                         # toolchain and Forge status
bin/goldfish engine stop                    # after changing engine code with sessions open
```

Using the CLI is in the [README](README.md). When something misbehaves, `.goldfish/engine.log` has Forge's
output and stack traces.

The previous Rust engine lives in `../mtg-goldfish-legacy` for reference only. Don't port code from it.
