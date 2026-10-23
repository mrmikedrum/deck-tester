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

Snapshots use `GameCopier` from forge-ai's simulation package. If its fidelity falls short, the fallback is
replaying the seed plus the recorded answers. Overrides are explicit commands on game objects: move between
zones, set life, add or remove counters of any type, tap or untap, create a token, attach.

## Forge dependency

Built from a pinned upstream commit into `vendor/forge` (gitignored) and installed into the local Maven
repository: forge-core, forge-game and forge-ai, with no GUI modules. Card scripts come from its
`res/cardsfolder`, then from `cards/`. Moving the pin is a deliberate change, for example to pick up a new
set. There's no long-lived fork.

## Not yet verified (M0)

- Headless startup time and memory.
- How fast a game to turn 8 plays.
- Running several games at once in one JVM. Forge has static state; the fallback is a few engine
  processes.
- How faithful `GameCopier`'s copies are.
- Forge's coverage of the example decks' cards.
- How passive opponents fit Forge's Commander deck validation.
