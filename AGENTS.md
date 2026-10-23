# AGENTS.md

MTG Goldfish lets agents playtest Commander decks by goldfishing, with Forge as the rules engine. Read
[vision](docs/vision.md) for what it's for, [architecture](docs/architecture.md) for how it fits together,
and [roadmap](docs/roadmap.md) for what comes next. [Decisions](docs/decisions.md) holds what's settled and
what's open.

## How to work here

- **Never implement game rules ourselves.** If a card or interaction is wrong, fix it as a Forge card script
  in `cards/`, or upstream in Forge. Our code only routes decisions, records facts, and reports. A rule
  written in our code drifts from Forge's and silently breaks the record.
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
| `goldfish/` | Python package: CLI, decklist parsing, later the session client, pilots, metrics and reports |
| `bin/goldfish` | CLI entry point |
| `engine/` | Forge host, Java 17 and Maven; today the M0 controllers and `Spike` measurement harness |
| `scripts/` | `bootstrap-forge.sh` (fetch and install pinned Forge), `spike.sh` (rerun the M0 measurements) |
| `vendor/forge` | Pinned Forge checkout, gitignored; card scripts in `forge-gui/res/cardsfolder` |
| `cards/` | Forge card-script overlay (arrives in M3) |
| `examples/decks/` | Real decklists used as fixtures and spike inputs |
| `tests/` | `unittest` suites |

## Commands

```bash
python3 -m unittest discover -s tests -v   # all Python tests
scripts/bootstrap-forge.sh                  # once, and after moving the Forge pin (JDK 21, Maven)
scripts/spike.sh                            # engine smoke run: one game, snapshot, 16 parallel games
bin/goldfish doctor                         # toolchain and Forge status
bin/goldfish deck check examples/decks/eternities-living-worlds-iii.txt
```

The previous Rust engine lives in `../mtg-goldfish-legacy` for reference only. Don't port code from it.
