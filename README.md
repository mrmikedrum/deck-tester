# MTG Goldfish

Agent-driven Commander goldfishing on top of [Forge](https://github.com/Card-Forge/forge). An agent plays a
deck's first turns against passive opponents, either by hand (manual mode, available now) or with a pilot
script it wrote (automated mode, M2), and gets back compact reports on how the deck develops.

- [Vision](docs/vision.md): what this is for, the two modes, and principles
- [Architecture](docs/architecture.md): components, the decision seam, records, and what's measured
- [Roadmap](docs/roadmap.md) and [decisions](docs/decisions.md)
- [AGENTS.md](AGENTS.md): how to work on this repo

## Setup

Needs JDK 17+ (21 recommended) and Maven; then once:

```bash
scripts/bootstrap-forge.sh
```

## Manual mode

```bash
bin/goldfish start examples/decks/eternities-living-worlds-iii.txt --seed 11
```

Every command prints what happened since you last looked, then the decision waiting for you:

```
g1 seed 11
drew Resourceful Defense, Winds of Abandon, Fabled Passage, Felidar Retreat, Forest, Spelunking, Plains
T0 setup mulligan (keep this hand): 1 keep · 2 mulligan
```

| Command | Does |
|---------|------|
| `a 2` / `a 1 3` / `a none` | Answer with option numbers; `[pick 0-2]` on a decision says how many |
| `decision [--full]` | Show the waiting decision again; `--full` adds each option's full text |
| `state [--full]` | Hand, board, mana; `--full` adds graveyard, exile and opponents |
| `log [--decisions] [--turn N]` | One line per turn; your choices; every fact of one turn |
| `cards [--by-turn]` | Cards seen and played, by name |
| `snapshot NAME` / `restore NAME` | Save the game at a play decision and go back to it |
| `override move\|create\|life\|counter\|tap\|untap …` | Correct the game by hand, for example `override counter Ouroboroid +1/+1 2` |
| `end` | End the game; records stay in `.goldfish/runs/` |

A game runs until it ends or you `end` it; `--turns N` ends it after your Nth turn. The three opponents only
play lands. `--mana` sets when you pick which sources pay for a spell: `creatures` (default, when a creature
could pay), `always` or `auto`. `log` names the deck and a hash of its list, so a game stays attributable as
the list changes.
`bin/goldfish --session g3 log` addresses an older game; the default is the last one started.
