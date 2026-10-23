# Architecture

```
agent ──shell──▶ bin/goldfish (Python) ──JSON lines, Unix socket──▶ engine (JVM, Forge embedded)
                   │ runs the pilot in automated mode                 │ games on threads
                   ▼                                                  ▼
             digests, reports ◀────────── game records (.goldfish/runs/…) ◀┘
```

| Path | Language | Owns |
|------|----------|------|
| `engine/` | Java 17, Maven | Forge host: game setup, decision routing, snapshots, overrides, recording facts |
| `goldfish/` | Python 3.9, stdlib only | CLI, session client, pilot runtime, metrics, plan checks, digests, reports |
| `cards/` | Forge card script | Cards added or corrected, loaded after Forge's own |
| deck kit (outside) | text + Python | Decklist and `pilot.py`, kept beside the deck in Deckmaster's project folder |

Decisions have to be intercepted inside Forge, so the engine is Java. Everything an agent writes or reads
(pilots, metrics, reports) is Python: that matches Deckmaster's tooling, and it changes without rebuilding
the JVM.

## Decisions: the one seam

Forge asks each player's `PlayerController` everything (112 abstract methods at the time of writing: what to
play, targets, modes, X, scry, sacrifice, mulligan…). `PilotController extends PlayerControllerAi` turns each
call into a decision:

```json
{"id": 41, "game": "g3", "turn": 4, "kind": "scry", "prompt": "Scry 2",
 "options": [{"id": "a", "card": "Forest"}, {"id": "b", "card": "Ouroboroid"}],
 "answer": "top and bottom lists of option ids"}
```

The decision is routed by mode:

- **Manual:** every decision with more than one legal answer goes to the agent, and the game thread parks
  until it's answered. Mana payment is a decision too, with `auto` as one of its answers.
- **Automated:** if the pilot declared this kind, the pilot answers it. When the pilot returns `None`, or the
  kind isn't declared, the decision falls through to Forge's AI via `super`.

Every answer is recorded along with who gave it: agent, pilot, AI, or forced (only one legal answer).

Forge's methods are grouped into about a dozen kinds:

- `mulligan`;
- `play`: what to do with priority, including pass;
- `targets`, `mode`, `number` (X and similar), `confirm` (optional "may");
- `choose`: cards or players from a set, as in search, discard or sacrifice;
- `order`: triggers or cards;
- `scry`, `attack`, `block`, `pay`;
- `name`, `type`, `color`.

The long tail starts as `other`, carrying Forge's own prompt and options, so nothing is out of reach in
manual mode.

## Sessions and processes

One long-lived engine process per machine, so the card database (the slow part of Forge's startup) loads
once. `bin/goldfish` starts it on first use and speaks JSON lines over a Unix socket under `.goldfish/`.

- **Manual:** `goldfish start` creates a game and prints its first decision. Each later command (`state`,
  `answer`, `snapshot`, `restore`, `override`) is its own short process; the engine holds the parked game
  in between.
- **Automated:** `goldfish run` holds one connection, plays games on engine threads, and answers the pilot's
  decision kinds from Python as they arrive. Only declared kinds cross the socket.

A game can switch modes at any decision: open an automated game in manual mode, or hand a manual game to a
pilot.

## Game setup

Commander at 40 life: the agent's deck against three passive opponents (the count is configurable). Each
passive opponent has 99 basics, keeps seven, plays a land each turn and does nothing else. Shuffles are
seeded, so a game can be replayed and a deck revision tried on the same seeds.

## Records, metrics, reports

The engine records facts only, one JSON line each: turn and phase starts, land plays, casts with the mana
paid, resolutions, zone changes, damage and life, counters, every decision with its answerer, and every
override. Records live at `.goldfish/runs/<run>/<game>.jsonl`.

Python derives everything else, so changing a metric never touches Java:

- **Standard per-turn metrics**, for example land drop made, mana available versus spent, spells cast, the
  turn the commander was cast, colours missing for cards in hand, and flags for screw, flood and stalls.
- **The deck plan:** checkpoints the pilot declares (for example "commander on the battlefield by turn 3"),
  reported as a hit rate and the turn each one was met.
- **Digests:** a batch report is the plan and metrics table plus one line per game.
  `goldfish show <game> [--turn N] [--decisions]` opens the full trace.

## Pilots

A pilot is one Python file beside the deck: handlers for the decision kinds that express the deck's plan,
and the deck's `PLAN`. A handler sees a read-only state view and returns an option id, or `None` to defer to
Forge's AI. The SDK's shape is settled in M2 against real decisions, not designed in advance.

## Cards Forge lacks or gets wrong

`goldfish deck check` lists cards Forge doesn't know, plus cards whose scripts mark them as hard for its AI
(those are the ones a pilot should handle). Fixes are Forge scripts in `cards/`; engine bugs go upstream
as Forge pull requests. Until something is fixed, manual overrides keep the game honest, and each one is
recorded.

## Snapshots and overrides

Snapshots use forge-game's `GameSnapshot`, the copy behind Forge's own experimental undo: copy the game, and
later restore it into the running game in place. Where its fidelity falls short, the fallback is replaying
the seed plus the recorded answers. Overrides are explicit commands on game objects: move between zones, set
life, add or remove counters of any type, tap or untap, create a token, attach.

## Forge dependency

`scripts/bootstrap-forge.sh` sparse-fetches a pinned upstream commit into `vendor/forge` (gitignored) and
installs forge-core, forge-game and forge-ai into the local Maven repository, with no GUI modules. Card
scripts come from `vendor/forge/forge-gui/res/cardsfolder`, then from `cards/`. Headless startup
(`engine/.../Forge.java`) is the card-data part of forge-gui's `FModel.initialize`. Moving the pin is a
deliberate change, for example to pick up a new set. There's no long-lived fork.

## Measured in M0 (2026-10-23, Apple Silicon, 10 cores, JDK 21)

Measured with `scripts/spike.sh`, on the Marath deck against three passive opponents.

- **Startup:** 1.8 s with all 34,100 card scripts loaded eagerly (146 MB heap). Lazy loading was slower
  (3.8 s) and saved only memory, so loading stays eager.
- **Coverage:** Forge knew all 100 cards and marked none as hard for its AI.
- **Speed:** a game to turn 8 with Forge's AI piloting took about 1.3 s on one thread. 16 games on 8 threads
  took 6.3–7.3 s with no failures, so 100 games run in about 40–45 s. Several games in one JVM worked.
- **Memory:** about 400–480 MB live heap with 8 games in flight; the process peaked near 3 GB under the
  JVM's default maximum, so the engine should set `-Xmx`.
- **Decisions:** overriding `PlayerControllerAi` methods intercepts mulligans and priority. A game thread
  parked on a `SynchronousQueue` until another thread answered, then carried on, and handing the rest of
  the game back to the AI worked.
- **Snapshots:** `GameSnapshot` copied a mid-game state in 29 ms and restored it in place in 5 ms. The
  restored state matched the copy exactly, and the game carried on from it. `GameCopier` wasn't needed.
- **Determinism:** seeding Forge's shared RNG (`MyRandom.setRandom`) gave identical games when run one
  after another. With games in parallel the RNG is shared, so per-game seeding needs a per-thread RNG.
- **Opponents:** Kozilek plus 99 Wastes passed Forge's Commander setup. The opponents only played lands,
  and the AI pilot attacked them.

M1 has to handle what the spike showed:

- Forge prints noise to stdout, so the engine sends Forge's output to a log and keeps its own channel clean.
- Forge's list of legal plays includes spells the player can't pay for, so the agent's options need an
  affordability filter.
- Option labels from Forge carry full Oracle text; they need compact labels.
- Cast events include abilities and triggers, so records come from game objects, not UI views.
