# Deckmaster

A home for Commander decks on [Forge](https://github.com/Card-Forge/forge): agents playtest decks by goldfishing
them or at a table of model-piloted seats, and people play those tables from a browser. Goldfishing an agent's deck
plays its first turns against passive opponents, either by hand (manual mode) or with a pilot script and the
decision model (automated mode), and returns compact reports on how the deck develops.

- [Vision](docs/vision.md): what this is for, its parts, and principles
- [Architecture](docs/architecture.md): components, the decision seam, records, forks, the game server and Forge
- [Measurements](docs/measurements.md): speed, fork fidelity and decision-model results
- [Roadmap](docs/roadmap.md) and [decisions](docs/decisions.md)
- [The game](game/README.md): playing a table in the browser
- [AGENTS.md](AGENTS.md): how to work on this repo

## Setup

Needs JDK 17+ (21 recommended) and Maven; then once:

```bash
scripts/bootstrap-forge.sh
bin/deckmaster deck sync      # read the decks repository (../mtg-decks) into the deck database
```

## Decks

Decks are state, not part of Deckmaster. In the decks repository, any folder can hold a `deckmaster/` folder with a
manifest per deck, `<slug>.json`: its name and, relative to the manifest, its `list` (a text decklist or a Forge
`.dck`), its `plan` (what the decision model reads) and its `advisor` (a Python file built on
`deckmaster/advice.py`), the last two optional. `deck sync` reads them all into the deck database
(`~/.local/share/deckmaster/`); a change to a list, plan or advisor adds a revision, and every game records the
revision it played. `deck import FILE` adds a decklist or a `.dck` on its own, `deck list` shows them, and every
command that takes a deck takes its slug or a decklist file. The decks repository is `../mtg-decks` unless
`~/.config/deckmaster/config.json` names another (`{"decks": PATH}`). Local CLI plugins can also be registered there
under `"plugins": {"<name>": "/path/to/executable"}` so `bin/deckmaster <name>` dispatches to them.

## Manual mode

```bash
bin/deckmaster start eternities-living-worlds-iii --seed 11
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
| `end` | End the game; records stay in `.deckmaster/runs/` |

A game runs until it ends or you `end` it; `--turns N` ends it after your Nth turn. The three opponents only
play lands. `--mana` sets when you pick which sources pay for a spell: `creatures` (default, when a creature
could pay), `always` or `auto`. `log` names the deck and a hash of its list, so a game stays attributable as
the list changes. `--ask mulligan,play` asks only those kinds and lets Forge's AI do the rest.

## Automated mode

A deck from the deck database brings its plan and advisor: the decision model plays by the plan, outcomes mode
plays candidate actions forward, and the advisor adds position-specific facts, not deterministic choices.
`--pilot FILE` puts another pilot in the advisor's place.

```sh
bin/deckmaster run eternities-living-worlds-iii --games 2 --turns 8
bin/deckmaster run eternities-assimilation-iii --games 2 --turns 8
```

Check the manifest's `pilot` and `hybrid`, and the report's model line. A fork that doesn't replay into
the same game is dropped and that decision is picked from the text alone; the report counts drifted forks
and names any game that lost lookahead from some turn on. On a new deck, `python3 bench/fidelity.py ai
DECK` checks that its forks replay before you trust comparisons. The advisor's facts reach the model
either way.


```bash
bin/deckmaster run eternities-living-worlds-iii --games 100 --seed 1000
```

A report (this one is older, from before decks were piloted by their plan, with Forge's AI playing):

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

Real-deck runs need a deck with a plan (for Jev) or `--pilot FILE` with a manual `play` handler. Stock
Forge-AI mode is reserved for passive goldfish opponents, not the deck being tested. Existing hybrid
fallbacks within an agent/Jev pilot remain allowed and recorded. Pilot functions are named after decision
kinds (`mulligan`, `play`, `targets`, `mode`, `number`, `confirm`, `order`, `choose`, `attack`, `block`,
`pay`); returning `None` hands that one decision to the ordinary fallback.

| Option | Does |
|--------|------|
| `--games N`, `--seed N` | How many games; game N uses seed+N, so any game can be replayed with `start --seed` |
| `--turns N` | Turns per game (default 8; 0 for no limit) |
| `--pilot FILE` | Answer some decision kinds yourself, in place of the deck's advisor; a pilot may also define `advise(state, decision, this_turn)` to give the model a line of deck guidance. With a plan, the decision model (Jev) plays the rest: each option is played out in a fork of the game and the model picks (see architecture) |
| `--hybrid plain` | With a plan: the model picks from the text alone, nothing played out |
| `--fast` | With a plan: a confident text-only pick skips the forks; quicker, more calls, possibly worse play (off by default) |
| `--forks replay` | With a plan: play options out in forks replayed from the seed instead of made from a copy of the game (the default, about 30 times quicker) |
| `--ai hybrid\|sim\|flatmc` | Forge's other AIs: `flatmc` is its Monte Carlo layer, as its desktop app plays; `hybrid` and `sim` are older lookahead, slower and no better (see measurements) |
| `--per-game`, `--cards` | Add a line per game; add how often each card was seen and played |
| `report [bN]` | Show a batch's report again, with the same flags |

`mana` is everything that could tap; `unspent` is what was left untapped at the end step.
`bin/deckmaster --session g3 log` addresses an older game; the default is the last one started.

## Tables: agents and people

`deckmaster table` hosts a Commander game over Forge's network play: agent seats (Jev, with each deck's plan and
advisor) and open seats for people, who join from the Forge desktop app built at the engine's version.

```sh
scripts/build-forge-client.sh ../forge   # once per Forge build: the desktop app people join with
bin/deckmaster table eternities-living-worlds-iii eternities-assimilation-iii blue-moon-combat-revision --people 1
```

It prints the address to join (Online Multiplayer, Join) and plays until the game ends; Ctrl-C ends it.
On macOS the firewall must allow incoming connections for the engine's Java (`$(/usr/libexec/java_home -v 21)/bin/java`),
or a join drops at once; on the hosting machine itself, joining at `127.0.0.1` works either way. A seat's
deck needs a plan or a play pilot; a bare list is rejected rather than silently stock-piloted.
When it ends it prints a report: life by round and, per agent seat,
who decided, its lookahead and its development; `bin/deckmaster table-report [tN]` shows it again.

