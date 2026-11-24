---
name: commander-goldfish
description: Goldfish Commander lists in Forge to test development, mana, sequencing and engine assembly during exploration or refinement, including staged drafts before publication.
---

# Goldfish

Use this within [exploration](../commander-explore/SKILL.md) or [refinement](../commander-refine/SKILL.md), or for a requested test. A staged draft can be exported and played before publication. Let the question and project vision guide the lines you test and how long to play.

Deckmaster's own engine plays it: Forge provides the rules, and the three opponents only play lands. From the Deckmaster checkout, pass a synced deck slug or any text/Forge `.dck` list (side and maybe boards are ignored) and play it:

```sh
bin/deckmaster start /tmp/<deck>.txt --seed 1
bin/deckmaster a 2
```

A deck Deckmaster already plays has a `deckmaster/` folder in its project (decks repository) with its plan and advisor; after `bin/deckmaster deck sync`, `bin/deckmaster start <slug>` and `bin/deckmaster run <slug>` use them, and `run` plays a batch with the decision model following the plan ([README](../../../README.md)).

If `start` names unknown cards, use the [Forge dependency procedure](../../../docs/architecture.md#forge-dependency) for the support check, reporting contract, tested updates and rollback.

Each command prints what just happened and the decision waiting; answer with option numbers (`a none` for no pick). Decisions cover the mulligan, plays, targets, modes, X, searches, attacks, and which creatures tap for mana.

Use the returned decision directly. Request full text or board state when needed to choose accurately; a short response does not require a second read by default. This skill and the simulator's README cover routine piloting; architecture and engine source are for development or diagnosis. Independent games can be advanced in one tool call with explicit session IDs; each answer still follows its own returned decision.

Options for `start`:

- `--seed N` replays the same draws for the same list.
- `--turns N` ends the game after your Nth turn; otherwise it runs until you `end` it.
- `--mana always|auto` asks which sources pay for every spell, or never; by default it asks when a creature could pay.
- `--stops all` gives you priority at every step, not just your main phases and when something is on the stack.
- `--opponents N` changes the table size from three.
- `--ask KINDS` answers only those decision kinds (comma-separated: mulligan, play, targets, mode, number, confirm, order, choose, attack, pay), or `none`; Forge's AI makes the rest. `a ai` hands a single decision to Forge's AI.

During a game:

- `decision --full` gives each option's full text; `state --full` adds graveyard, exile and opponents to the board view.
- `snapshot NAME` and `restore NAME` save and return to a point, with the same draws afterwards.
- `override` corrects a card the simulator got wrong (move, create, life, counter, tap, untap). Overrides are recorded and set off no triggers.

For many games at once, `run` plays a seeded batch in parallel and prints per-turn averages (lands, mana, unspent mana, missed land drops, spells, damage), when the commander was cast, and mulligans:

```sh
bin/deckmaster run <slug> --games 20 --seed 1000
```

- A real deck is piloted by the decision model following its plan, with its advisor's facts; a list without a plan needs `--pilot FILE`, a Python file whose functions, named after decision kinds, return option numbers (or `None` to hand that one back). Deckmaster's `deckmaster/pilots/commander_first.py` casts the commander whenever it can.
- The report names cards Forge's AI won't play (Marath, for one); cover those with a pilot or manual games.
- `--turns N` sets game length (default 8, `0` for none); `--per-game` adds a line per game and `--cards` how often each card was seen and played. `report [bN]` shows a batch again.
- Any batch game can be read with `--session gN log`, or replayed by hand with `start --seed` and the same seed.

Afterwards, `log` gives the deck revision, seed and a line per turn (`--decisions` adds the choices, marking the few Forge's AI made); `cards` lists what was seen and played. Game records stay in Deckmaster. Bring consequential observations back into [refinement](../commander-refine/SKILL.md); try more than one seed before generalizing, and distinguish deck, pilot and tool problems. Goldfishing does not establish social fun or resilience to real opposition.
