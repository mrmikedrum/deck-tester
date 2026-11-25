# AGENTS.md

Deckmaster is a home for Commander decks on Forge: an engine, a tester agents playtest decks with, a game people
play in a browser, and the agent skills that drive them ([vision](docs/vision.md)). For routine piloting, use the
README; load further detail only when the task needs it. For development or diagnosis, read [vision](docs/vision.md) for purpose,
[architecture](docs/architecture.md) for implementation, and relevant [decisions](docs/decisions.md);
[measurements](docs/measurements.md) hold the evidence and baselines.
[Roadmap](docs/roadmap.md) owns planned work. Reuse guidance already current in context.

## How to work here

- **Forge owns game rules.** Our code routes decisions, records facts and reports; a second rules
  implementation drifts and silently breaks the record. A missing card is a Forge card script, never code.
  The [Forge dependency procedure](docs/architecture.md#forge-dependency) owns support checks and updates.
- **The engine records facts; Python interprets them.** Metrics, plans and digests belong in `deckmaster/`, so
  they change without a JVM rebuild.
- **Agents pay for every byte we print.** Default output is the shortest digest that supports a judgment,
  with detail behind a flag or a follow-up command. Don't add a field to a default view unless an agent
  needs it to decide something.
- **Never hide what the engine didn't do.** Unsupported cards, overrides, and decisions Forge's AI made
  must show up in the record and get flagged in reports.
- **Python stays standard-library only, 3.9-compatible**, so it runs wherever the agents do. Java follows Forge:
  Java 17, Maven. The game client is plain browser JavaScript for now (a TypeScript and Vite migration is
  planned); its tools run on Node with Playwright.
- **One home per idea.** Update the owning doc instead of restating it. Keep these docs short.

## Layout

| Path | What |
|------|------|
| `deckmaster/` | Python package: CLI (`cli.py`), engine client (`engine.py`), record digests (`records.py`), text views (`render.py`), batches and pilots (`batch.py`), batch reports (`report.py`), tables (`table.py`, with the table seats' decider in `table_model.py` and reports in `table_report.py`), the game server (`game.py`) |
| `bin/deckmaster` | CLI entry point |
| `engine/` | Forge host: `Server` (socket), `Session` (one game or one table seat), `ManualController` (decisions), `Recorder` (facts), `Table` (a networked table) |
| `scripts/` | `bootstrap-forge.sh` (fetch, patch and install pinned Forge), `build-engine.sh` (compile; the CLI runs it when needed), `build-forge-client.sh` (the desktop app people join tables with), `forge-patches/` (our patch series, local card scripts included) |
| `vendor/forge` | Pinned Forge checkout with the patch series on its `goldfish` branch, gitignored; card scripts in `forge-gui/res/cardsfolder` |
| `game/client/` | The game client: `live.html` and `live.js` (the page and its prompt, hand and panels), `h.js` (the 3D table), `world.js` and `fx.js` (textures and effects); `offline.html` shows the board on fixtures for the tools |
| `game/tools/` | Recording and judging the client: `reel.js` (frame-exact clips), `packet.js` (review packets and the layout audit), `clips.js`, `boards.js` and `plays.js` (fixtures), the look loop (`look.sh`, `look/`); see [game/LOOK.md](game/LOOK.md) |
| `agent/` | The deck partner: its guidance (`AGENTS.md`), skills (`skills/deckmaster/` routes to the rest; `forge-cards/` is the procedure for the card scripts our series adds to Forge), docs, templates, labs, and the deck audit (`tools/deck-audit/`) |
| `bench/` | Fork fidelity (goldfish and tables), scenarios and decision-model experiments |
| `deckmaster/decks.py` | The deck database: decks from the decks repository (`deck sync`) and imports, with immutable revisions; see the README |
| `tests/` | `unittest` suites; `test_engine.py` plays a real game and skips without Forge; `fixtures/` holds frozen decklists and advisors |
| `.deckmaster/` | Runtime, gitignored: engine and table-engine sockets and logs, game records in `runs/`, the card image cache in `cache/cards/`; the deck database is in `~/.local/share/deckmaster/` |

## Commands

```bash
scripts/bootstrap-forge.sh                # once, and after the Forge pin or patches change (JDK 21, Maven)
python3 -m unittest discover -s tests -v  # all tests; the engine test needs Forge
bin/deckmaster deck sync                  # after decks change in the decks repository
bin/deckmaster doctor                     # toolchain and Forge status
bin/deckmaster engine stop                # after changing engine code with sessions open
bin/deckmaster game                       # serve the game on this machine's network
bin/deckmaster game --fill-cache          # once on a fresh checkout: the client's fixture card images
(cd game && npm ci)                       # once: the client's toolchain and the tools' Playwright
```

Using the CLI is in the [README](README.md). When something misbehaves, `.deckmaster/engine.log` has Forge's
output and stack traces.
