# Decisions

One line of reasoning per decision. Replace an entry when it changes; don't append a history.

## Made (2026-10-23)

- **Embed Forge rather than write a rules engine.** The previous homegrown Rust engine, now in
  `../mtg-goldfish-legacy`, modeled cards as closed enums and parsed Oracle text by pattern. On the
  Eternities decks it marked 37% of cards as implemented, and the ones spot-checked were silently wrong.
  Forge scripts nearly every card and exposes every player decision through one interface. The M0 spike
  confirmed it holds: every card known, decisions intercepted, snapshots restored, and about 100 games in
  45 s.
- **Two modes, one engine.** Manual means the agent answers every decision. Automated means a pilot script
  plus Forge's AI. The only difference is who answers.
- **Pilots are Python, falling back to Forge's AI.** The agent's reasoning becomes reusable rules; Forge's AI
  handles the long tail.
- **Evaluation:** standard per-turn metrics, plus a deck plan of checkpoints declared in the pilot.
- **Scale:** about 100 automated games in about a minute, each with a full trace kept for later inspection.
- **Table:** three passive opponents at 40 life who play a land each turn; configurable.
- **Engine records facts, Python derives meaning**, so metrics and reports change without a JVM rebuild.
- **Fresh history.** The old code and its history are in `../mtg-goldfish-legacy` (still pointing at the
  old remotes). This repo starts on `main` with no remote.

## Open

- **GitHub home.** `origin` was `mrmikedrum/mtg-goldfish`, a public fork of `Godrek/mtg`. Force-pushing this
  history there keeps the fork link and needs the default branch changed from `mainline`. A new standalone
  repo avoids both.
- **License.** Forge is GPL-3.0, and the engine links it, so publishing means GPL-3.0.
- **Where pilots live.** Passed by path for now; Deckmaster decides whether they belong with a project.
