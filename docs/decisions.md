# Decisions

One line of reasoning per decision. Replace an entry when it changes; don't append a history.

## Made

- **Embed Forge rather than write a rules engine.** An earlier homegrown Rust engine prototype
  modeled cards as closed enums and parsed Oracle text by pattern. On real
  Commander decks it marked 37% of cards as implemented, and the ones spot-checked were silently wrong.
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
- **Lookahead forks into a game of its own, never by restoring in place.** Restoring Forge's snapshot in place
  kept drifting (counters, AI memory, static abilities, the stack). A goldfish game forks by replaying its
  logged decisions from the seed; a fingerprint check proves the fork landed in the same game, and the parent
  is never touched, so forks run in parallel.
- **Forks start from a copy of the game.** A copy is 20-40 times quicker than replaying from the seed, and
  needs no record of other players' decisions, which a table with people can't have. Forge's copier is patched
  until a copy matches the game it copies, the same checks apply, and what the decision model reads from a
  copy fork matched a replay fork's at every decision measured. In a fork the other players pass. Replay
  stays available as a cross-check while the copier patch proves itself across pin bumps.
- **Tables are hosted by the engine over Forge's network play.** The agents' seats need the game in-process for
  lookahead, so the engine hosts and people join with the stock Forge desktop app (built at the engine's
  version); Forge itself keeps no agent code beyond a lobby hook.
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
- **Cards Forge lacks or gets wrong are Forge card scripts, never engine code.** They are one patch of the
  series, in Forge's own card folder, so every Forge built from it has them, the desktop app people join
  tables with included (an installer into the engine's copy alone left that app without them). Upstream's
  version wins once it checks out, and ours is dropped.
- **Forge is an upstream pin plus a small labelled patch series, not a maintained fork.** A handful of
  patches doesn't justify a second codebase; the series rebases with git's three-way merge, and every game
  record names its build, so results from different engines are never mixed. General fixes are offered
  upstream from a GitHub fork of Forge; hooks only this host needs stay local.
- **One product, Deckmaster, in one repo.** The goldfish tool, the networked tables and the game
  client grew into one product: an engine, a tester, a game and the agent skills, named for what they do. They stay
  in one repository because the client reads the engine's view directly, so one change can cover both sides.
  Card images stay out of git (Wizards' images): they are fetched into a runtime cache the game server fills.
- **The agent lives in Deckmaster; decks and private integrations don't.** The deck partner's guidance, skills and
  generic tools are Deckmaster's agent part, so they change with the engine and tester they drive; the decks repository
  keeps only state (personal taste and playgroup preferences included), and private/external-app integrations stay out
  of this public repo behind the local plugin hook in `~/.config/deckmaster/config.json`.
- **Decks are state, not part of Deckmaster.** Each deck's vision, notes, list, plan and advisor live in the decks
  repository (loosely coupled: a documented folder format), and Deckmaster reads them into a deck database of its
  own, so decks from elsewhere (players at a table) fit the same way. A deck's advisor and plan come with it, so
  there is no `--guide`; Deckmaster's tests use frozen fixture decks, not the live ones.
- **The game client moves to TypeScript and Vite.** Agents write nearly all of it, and a type checker catches the
  mistakes they make; three.js comes from npm rather than a CDN. Python stays stdlib-only; Node is for the client and its
  tools.
- **GPL-3.0.** Forge is GPL-3.0, the engine links it, and the patch series and card scripts derive from it.

## Real-deck pilot mode

Real decks are piloted manually (human or agent) or by Jev with the deck plan/advisor. Stock Forge AI
is a mode only for passive goldfish opponents, not for a real-deck seat. This does not ban the existing
recorded Forge fallbacks inside the Jev/manual pipeline. Missing plans must fail explicitly, never
silently select stock-AI mode. Browser mana abilities are optional controls on permanents: they are
not counted in play/response menus and do not by themselves hold otherwise empty priority windows.
