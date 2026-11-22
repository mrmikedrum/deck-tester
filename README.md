# MTG Goldfish

Agent-driven Commander goldfishing on top of [Forge](https://github.com/Card-Forge/forge). An agent plays a
deck's first turns against passive opponents, either by hand (manual mode, available now) or with a pilot
script or Forge's AI (automated mode), and gets back compact reports on how the deck develops.

- [Vision](docs/vision.md): what this is for, the two modes, and principles
- [Architecture](docs/architecture.md): components, the decision seam, records, forks and Forge
- [Measurements](docs/measurements.md): speed, fork fidelity and decision-model results
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
| `a 2` / `a 1 3` / `a none` / `a ai` | Answer with option numbers; `[pick 0-2]` on a decision says how many; `ai` lets Forge's AI decide this one |
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
the list changes. `--ask mulligan,play` asks only those kinds and lets Forge's AI do the rest.

## Automated mode

For the current Eternities exports, attach the Python advisor **and** its strategy guide. Outcomes mode
plays candidate actions forward; an advisor adds position-specific facts, not deterministic choices:

```sh
bin/goldfish run /tmp/eternities-nature.txt --games 2 --turns 8 --pilot examples/pilots/marath_advisor.py --guide examples/plans/living-worlds.txt --hybrid outcomes
bin/goldfish run /tmp/eternities-assimilation.txt --games 2 --turns 8 --pilot examples/pilots/atraxa_advisor.py --guide examples/plans/assimilation.txt --hybrid outcomes
```

Check the manifest's `pilot` and `hybrid`, and the report's model line. A fork that doesn't replay into
the same game is dropped and that decision is picked from the text alone; the report counts drifted forks
and names any game that lost lookahead from some turn on. On a new deck, `python3 bench/fidelity.py ai
DECK` checks that its forks replay before you trust comparisons. The advisor's facts reach the model
either way.


```bash
bin/goldfish run examples/decks/eternities-living-worlds-iii.txt --games 100 --seed 1000
```

```
b4 · eternities-living-worlds-iii@56fe6c23 · 100 games · seeds 1000-1099 · Forge AI · to turn 8 · 40.9s
Forge's AI doesn't play: Marath, Will of the Wild (a pilot or manual play can)
turn          1     2     3     4     5     6     7     8
lands       1.0   2.1   3.1   4.1   5.0   5.9   7.0   8.1
mana        1.2   2.5   3.7   5.0   6.3   7.8   9.9  11.9
unspent     0.7   0.7   0.7   0.9   1.1   1.6   2.3   3.1
missed %      0     1     9    17    25    30    41    45
spells      0.2   0.8   1.7   2.6   3.7   4.9   6.1   7.3
damage      0.0  -0.1   0.2   1.7   4.8  10.6  19.7  33.0
commander never cast in 100 games
mulligans: 0 in 84, 1 in 11, 2 in 4, 3 in 1
```

Real-deck runs require `--guide PLAN` for Jev or `--pilot FILE` with a manual `play` handler. Stock
Forge-AI mode is reserved for passive goldfish opponents, not the deck being tested. Existing hybrid
fallbacks within an agent/Jev pilot remain allowed and recorded. Pilot functions are named after decision
kinds (`mulligan`, `play`, `targets`, `mode`, `number`, `confirm`, `order`, `choose`, `attack`, `block`,
`pay`); returning `None` hands that one decision to the ordinary fallback.

| Option | Does |
|--------|------|
| `--games N`, `--seed N` | How many games; game N uses seed+N, so any game can be replayed with `start --seed` |
| `--turns N` | Turns per game (default 8; 0 for no limit) |
| `--pilot FILE` | Answer some decision kinds yourself; a pilot may also define `advise(state, decision, this_turn)` to give the model a line of deck guidance |
| `--guide PLAN` | Put the decision model (Jev) in the seat with this plain-language deck plan; each option is played out in a fork of the game and the model picks (see architecture) |
| `--hybrid plain` | With `--guide`: the model picks from the text alone, nothing played out |
| `--fast` | With `--guide`: a confident text-only pick skips the forks; quicker, more calls, possibly worse play (off by default) |
| `--forks replay` | With `--guide`: play options out in forks replayed from the seed instead of made from a copy of the game (the default, about 30 times quicker) |
| `--ai hybrid\|sim\|flatmc` | Forge's other AIs: `flatmc` is its Monte Carlo layer, as its desktop app plays; `hybrid` and `sim` are older lookahead, slower and no better (see measurements) |
| `--per-game`, `--cards` | Add a line per game; add how often each card was seen and played |
| `report [bN]` | Show a batch's report again, with the same flags |

`mana` is everything that could tap; `unspent` is what was left untapped at the end step.
`bin/goldfish --session g3 log` addresses an older game; the default is the last one started.

## Tables: agents and people

`goldfish table` hosts a Commander game over Forge's network play: agent seats (Jev, with a deck plan and advisor)
and open seats for people, who join from the Forge desktop app built at the engine's version.

```sh
scripts/build-forge-client.sh ../forge   # once per Forge build: the desktop app people join with
bin/goldfish table examples/decks/eternities-living-worlds-iii.txt,examples/plans/living-worlds.txt,examples/pilots/marath_advisor.py \
  examples/decks/eternities-assimilation-iii.txt,examples/plans/assimilation.txt,examples/pilots/atraxa_advisor.py \
  examples/decks/blue-moon-combat-revision.txt,examples/plans/blue-moon.txt,examples/pilots/blue_moon_advisor.py --people 1
```

It prints the address to join (Online Multiplayer, Join) and plays until the game ends; Ctrl-C ends it.
On macOS the firewall must allow incoming connections for the engine's Java (`$(/usr/libexec/java_home -v 21)/bin/java`),
or a join drops at once; on the hosting machine itself, joining at `127.0.0.1` works either way. A seat
needs a Jev plan or manual play pilot; a bare deck is rejected rather than silently stock-piloted.
When it ends it prints a report: life by round and, per agent seat,
who decided, its lookahead and its development; `bin/goldfish table-report [tN]` shows it again.

