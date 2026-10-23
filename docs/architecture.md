# Architecture

```
agent ──shell──▶ bin/goldfish (Python) ──JSON lines, Unix socket──▶ engine (JVM, Forge embedded)
                   │ runs the pilot in automated mode (M2)            │ one thread per game
                   ▼                                                  ▼
             digests, reports ◀───────────── game records (.goldfish/runs/g<N>.jsonl) ◀┘
```

| Path | Language | Owns |
|------|----------|------|
| `engine/` | Java 17, Maven | Forge host: game setup, decision routing, snapshots, overrides, recording facts |
| `goldfish/` | Python 3.9, stdlib only | CLI, engine client, digests; later the pilot runtime, metrics and reports |
| `cards/` | Forge card script | Cards added or corrected, loaded after Forge's own (M3) |
| deck kit (outside) | text + Python | Decklist and `pilot.py`, kept beside the deck in Deckmaster's project folder |

Decisions have to be intercepted inside Forge, so the engine is Java. Everything an agent writes or reads
(pilots, metrics, reports) is Python: that matches Deckmaster's tooling, and it changes without rebuilding
the JVM.

## Decisions: the one seam

Forge asks each player's `PlayerController` everything: 112 abstract methods at the pinned commit. The
agent's seat is `ManualController extends PlayerControllerAi`. Each method it overrides becomes a
`Decision`: a kind, the turn, a short prompt, and numbered options labelled by card name. The answer is
option numbers (or a value for `number`). A decision with only one legal answer is answered as `forced`
and never reaches the agent.

In manual mode, the agent decides:

- `mulligan`, and which cards to bottom;
- `play`: what to do with priority, including pass. Options are only what's legal now and payable, with no
  mana abilities, because payment is automatic.
- `number`: X, and other announced numbers, capped at what can be paid;
- `mode`, `targets` (every targeting part of a spell or trigger), `confirm` (optional "may" and optional
  triggers), and `order` (simultaneous triggers);
- `choose`: cards or players from a set. This covers searches, discards, sacrifices, reveals, scry and
  surveil, optional costs, and the permanents a cost taps or sacrifices.
- `attack`: attackers, each with a defender.

Forge's AI still decides, and nothing records it yet:

- mana payment: which sources tap, and colour choices while paying;
- other cost choices, such as discarding or exiling as a cost, and the unusual tap or sacrifice variants;
- blocks, which never come up against passive opponents;
- choices of colour, type or name, ordering cards put back into the library, new targets for copies,
  piles, votes and dice;
- the rarer prompts no example deck has needed yet.

Surface any of these when a deck needs it, following the pattern in `ManualController`.

Priority stops: by default the agent is asked about priority during its own main phases and whenever
something is on the stack, and only when it has a playable option. `--stops all` asks at every priority.

Casting follows Forge's AI sequence (`ComputerUtil.handlePlayingSpellAbility`), restated in
`ManualController.cast`, so that `ManualCostDecision` can give tap and sacrifice choices to the agent. If a
cast fails, the card goes back where it came from, and the record marks the cast as failed.

In automated mode (M2), a pilot answers the kinds it declares, and Forge's AI (`super`) answers the rest.

## Sessions and processes

One engine process per machine, so the card database (the slow part of Forge's startup) loads once.
`bin/goldfish` builds the engine when its sources change. It starts the engine on first use and speaks one
JSON request per connection over `.goldfish/engine.sock`. `start` restarts an idle engine whose code is
out of date; `goldfish engine stop` ends it and every session in it. Forge's console noise goes to
`.goldfish/engine.log`.

Each game runs on its own thread and parks at each decision. Every CLI command is a short process. Game
state is read or changed only while the game thread is parked or finished, so nothing touches it
concurrently.

## Game setup

Commander at 40 life: the agent's deck (`You`) against three passive opponents (`Opp 1`–`Opp 3`; the count
is configurable). Each opponent is Kozilek plus 99 Wastes: it keeps seven, plays a land each turn, and never
attacks or blocks. Each game thread has its own seeded RNG (`SeededRandom` installed as Forge's
`MyRandom`), so a seed replays the same draws even with games running side by side. Start with `--seed` to
compare lines on the same draws. The game ends when the agent's turn after `--turns` (default 8) begins.

## Records, digests, metrics

The engine records facts only, one JSON line each, tagged with the agent's turn:

- `start`, `turn`, `end`;
- `draw`, `land`, `cast` and `activate` (with X, and `failed` when the cast didn't go through);
- `move` for the agent's cards changing zones, including tokens appearing;
- `life` for any player;
- `look` for cards seen by scry, surveil, reveal or search;
- `decision` (kind, prompt, option count, answer by label, and who answered);
- `snapshot`, `restore`, `override`.

Cards are named, never numbered. Ids appear only so a card seen twice counts once.

Python derives everything else:

- **Shown after each command:** what happened since the agent last looked, on one line.
- **`goldfish log`:** one line per turn. `--decisions` adds the agent's choices; `--turn N` lists every fact.
- **`goldfish cards`:** cards seen (drawn, scryed, surveilled, revealed; each card once) and cards played
  (lands and spells), by name. `--by-turn` splits them per turn.

Restoring a snapshot drops the abandoned line from these views; `--all` keeps it.

Still to come in M2: standard per-turn metrics (land drop made, mana available versus spent, commander
turn, missing colours, screw and flood flags), and deck-plan checkpoints from the pilot, reported as hit
rates.

## Pilots

A pilot is one Python file beside the deck: handlers for the decision kinds that express the deck's plan,
and the deck's `PLAN`. A handler sees a read-only state view and returns an option number, or `None` to
defer to Forge's AI. The SDK's shape is settled in M2 against the decisions M1 surfaces.

## Cards Forge lacks or gets wrong

`goldfish start` refuses a deck with cards Forge doesn't know, and names them. Fixes are Forge scripts in
`cards/` (M3); engine bugs go upstream as Forge pull requests. Until something is fixed, overrides keep the
game honest, and each one is recorded.

## Snapshots and overrides

Snapshots use forge-game's `GameSnapshot`, the copy behind Forge's own experimental undo. Snapshots are
taken and restored only at a `play` decision. A restore puts the copy back into the running game, then the
parked decision is asked again from the restored state.

Overrides are commands on cards named by the agent: move between zones, create a card, set life, add or
remove counters of any type, tap, untap. Use `Name#2` for the second card of that name. Triggers are
suppressed during an override, because a correction states how the game should be; it shouldn't set off
new effects.

## Forge dependency

`scripts/bootstrap-forge.sh` sparse-fetches a pinned upstream commit into `vendor/forge` (gitignored) and
installs forge-core, forge-game and forge-ai into the local Maven repository, with no GUI modules. Card
scripts come from `vendor/forge/forge-gui/res/cardsfolder`, then from `cards/`. Headless startup
(`engine/.../Forge.java`) is the card-data part of forge-gui's `FModel.initialize`. Moving the pin is a
deliberate change, for example to pick up a new set. There's no long-lived fork.

## Measured in M0 (2026-10-23, Apple Silicon, 10 cores, JDK 21)

Measured with the spike harness, on the Marath deck against three passive opponents. The harness was
removed in M1 and is in git history at `e0e2b7e`.

- **Startup:** 1.8 s with all 34,100 card scripts loaded eagerly (146 MB heap). Lazy loading was slower
  (3.8 s) and saved only memory.
- **Coverage:** Forge knew all 100 cards.
- **Speed:** a game to turn 8 with Forge's AI piloting took about 1.3 s on one thread. 16 games on 8 threads
  took 6.3–7.3 s, so 100 games run in about 40–45 s.
- **Memory:** about 400–480 MB live heap with 8 games in flight; the engine runs with `-Xmx2g`.
- **Snapshots:** `GameSnapshot` copied a mid-game state in 29 ms and restored it in place in 5 ms, exactly.
