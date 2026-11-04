# Decisions

One line of reasoning per decision. Replace an entry when it changes; don't append a history.

## Made

- **Embed Forge rather than write a rules engine.** The previous homegrown Rust engine, now in
  `../mtg-goldfish-legacy`, modeled cards as closed enums and parsed Oracle text by pattern. On the
  Eternities decks it marked 37% of cards as implemented, and the ones spot-checked were silently wrong.
  Forge scripts nearly every card and exposes every player decision through one interface. The M0 spike
  confirmed it holds: every card known, decisions intercepted, snapshots restored, and about 100 games in
  45 s.
- **Two modes, one engine.** Manual means the agent answers every decision. Automated means a pilot script
  plus Forge's AI. The only difference is who answers.
- **Pilots are Python, falling back to the decision model, then Forge's AI.** The agent's reasoning becomes
  reusable rules; the model and Forge's AI handle the long tail.
- **Evaluation:** standard per-turn metrics, plus a deck plan of checkpoints declared in the pilot.
- **Scale:** about 100 automated games in about a minute, each with a full trace kept for later inspection.
- **Table:** three passive opponents at 40 life who play a land each turn; configurable.
- **Engine records facts, Python derives meaning**, so metrics and reports change without a JVM rebuild.
- **Lookahead forks the game by replaying it from the seed, never by restoring in place.** Every decision
  at the agent's seat is logged with its answer, whoever gave it, and Forge's AI never acts between
  decisions or weighs anything during a replay. Restoring Forge's snapshot in place kept drifting (counters,
  AI memory, static abilities, the stack); a replay only resolves the same actions again, and a fingerprint
  check proves it landed in the same game. The parent game is never touched, so forks can run in parallel.
- **The decision model picks; it doesn't plan.** Jev chooses among named options, reading each one played
  out by Forge's AI. The agent's reasoning is spent once, on a few sentences of deck plan.
- **Deck knowledge lives in the deck's advisor script.** The harness parses no card text for strategy; a
  script declares the deck's pieces and the facts worth saying about them, and the model reads those as
  one line.
- **Decision-model design is measured, not argued.** What Jev reads is chosen on a bench of captured
  situations with answers fixed before testing, and confirmed on full games scored by development (lands,
  mana, board, cards in hand), not damage.
- **Record what Forge's AI did, never reconstruct it.** A fork can only replay what the log holds, so
  choices the AI makes, its mana payments included, are captured as they happen.
- **Cards Forge lacks or gets wrong are Forge card scripts, never engine code.** They live in `cards/` with
  their provenance and rules scenarios. Upstream's version wins once it checks out, and ours is retired.
- **Forge is an upstream pin plus a small labelled patch series, not a maintained fork.** A handful of
  patches doesn't justify a second codebase; the series rebases with git's three-way merge, and every game
  record names its build, so results from different engines are never mixed. General fixes are offered
  upstream from a GitHub fork (`mrmikedrum/forge`); hooks only this host needs stay local.
- **Fresh history in a standalone repo.** This repo lives at `mrmikedrum/deck-tester`, not as a fork of
  the old `mrmikedrum/mtg-goldfish`. The old code and its history stay in `../mtg-goldfish-legacy`.
- **GPL-3.0.** Forge is GPL-3.0, the engine links it, and the patch series and card scripts derive from it.

## Open

- **Where pilots live.** Passed by path for now; Deckmaster decides whether they belong with a project.
