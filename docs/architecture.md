# Architecture

```
agent ──shell──▶ bin/goldfish (Python) ──JSON lines, Unix socket──▶ engine (JVM, Forge embedded)
                   │ runs batches, the pilot and the decision model   │ one thread per game
                   ▼                                                  ▼
             digests, reports ◀───────────── game records (.goldfish/runs/g<N>.jsonl) ◀┘
```

| Path | Language | Owns |
|------|----------|------|
| `engine/` | Java 17, Maven | Forge host: game setup, decision routing and logging, forks, snapshots, overrides, recording facts |
| `goldfish/` | Python 3.9, stdlib only | CLI, engine client, digests, batch runner and pilot runtime, reports |
| `cards/` | Forge card script | Cards added or corrected, loaded after Forge's own (M3) |
| deck, plan and pilot (outside) | text + Python | The decklist, and optionally a deck plan and a pilot file, passed by path |

Decisions have to be intercepted inside Forge, so the engine is Java. Everything an agent writes or reads
(pilots, metrics, reports) is Python: that matches Deckmaster's tooling, and it changes without rebuilding
the JVM.

## Decisions: the one seam

Forge asks each player's `PlayerController` everything: 112 abstract methods at the pinned commit. The
agent's seat is `ManualController extends PlayerControllerAi`. Each method it overrides becomes a
`Decision`: a kind, the turn, a short prompt, and numbered options labelled by card name. On the
battlefield, a label also carries what tells copies apart: P/T, counters, tapped, token. Each option's full
text (Oracle text or the whole ability) travels with it for `decision --full`. The answer is option numbers
(or a value for `number`; repeats only where the card allows them). A decision with only one legal answer
is answered as `forced` and never reaches the agent.

In manual mode, the agent decides:

- `mulligan`, and which cards to bottom;
- `play`: what to do with priority, including pass. Options are only what's legal now and payable, with no
  mana abilities, because payment is automatic.
- `number`: X, and other announced numbers, capped at what can be paid;
- `mode` (including modes that may repeat), `targets` (every targeting part of a spell or trigger),
  `confirm` (optional "may" and optional triggers), and `order` (simultaneous triggers);
- `pay`: which mana abilities pay, in order, with a colour where the ability chooses one, when a creature
  could pay (`--mana always` asks for every cast, `--mana auto` never). Answering none leaves it to Forge's
  AI. Chosen abilities are activated, and the rest of the cost is paid from the pool with every source held
  back through the AI's own "held for the next spell" memory;
- `choose`: cards or players from a set. This covers searches, discards, sacrifices, reveals, scry and
  surveil, optional costs, the permanents a cost taps or sacrifices, colours, creature types, card names
  from a short list, and two-way choices such as heads or tails;
- `order`: simultaneous triggers, and cards going back to the library;
- `attack`: attackers, each with a defender.

Every decision passes through one method (`ManualController.decide`), whoever answers it, and is logged with
its options and answer: the agent's, a forced one, Forge's AI's (`by: ai`, including the ones the agent hands
over, with `via` naming who did), and the mana sources Forge's AI tapped when nobody chose them. The log is
what a fork replays (see Forks). Forge's AI weighs its answers on a random sequence of its own, separate
from the game's shuffles.

Forge's AI still decides, recorded `unlogged` so a fork lets it choose again: card names matching a
predicate (too many to list), discard, exile and return costs, and unusual tap or sacrifice cost variants.
It also answers, unrecorded: blocks (which never come up against passive opponents), new targets for
copies, piles, votes, dice, and the rarer prompts no example deck has needed yet. Surface any of them when
a deck needs it, following the pattern in `ManualController`.

Priority stops: the agent is asked about priority during its own main phases and whenever something is on
the stack, and only when it has a playable option; elsewhere priority passes, in every mode. `--stops all`
asks at every priority. What is playable is evaluated as if Forge's AI held no mana back and had cached
nothing, so the options never depend on what its AI was planning.

Casting follows Forge's AI sequence (`ComputerUtil.handlePlayingSpellAbility`), restated in
`ManualController.cast`, so that `ManualCostDecision` can give tap and sacrifice choices to the agent. If a
cast fails, the card goes back where it came from, and the record marks the cast as failed.

## Who answers: agent, pilot, model or Forge's AI

Each session has the set of decision kinds the agent answers; Forge's AI (`super`) answers the rest. A
manual game (`start`) asks every kind; `start --ask mulligan,play` asks only those, and `--ask none` lets
Forge's AI play the whole game. In any decision the agent can answer `ai` to hand just that one over.

Two rules keep the deciders consistent:

- Whoever chooses a play also casts it. If the agent chose the spell, its targets, modes, X and payment
  come to the agent too (an `ai` answer there hands that piece back). If Forge's AI chose it, the targets
  and X it settled on while weighing the play are kept and logged as its answers; everything else about the
  cast is asked the same way.
- Priority outside the agent's stops passes, whoever is in the seat. Forge's AI never acts on its own
  between decisions, so the log holds everything that happened.

Automated mode is the same session with something else in the agent's seat. `goldfish run`
(`goldfish/batch.py`) starts one session per seed, at most `--workers` at once. Each parked decision goes
first to the pilot's function for its kind, then to the decision model if the batch has a plan, then to
Forge's AI. With neither, nothing is asked and games never park. Answers carry who gave them, so the
record and the report show the share each decider took.

Forge marks some cards as ones its AI can't play well (`AI:RemoveDeck:All`; the Marath deck's commander is
one). `start` and `run` name them, because Forge's AI simply never plays them; a pilot's `play` handler or
manual play can.

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
compare lines on the same draws. A game runs until it ends or the agent ends it; `--turns N` is an optional cap.

## Records, digests, metrics

The engine records facts only, one JSON line each, tagged with the agent's turn:

- `start`, `turn`, `end`;
- `start` names the deck, a hash of its played cards (`deck@hash`, from `Decklist.revision`) and the seed;
- `draw`, `land`, `cast` and `activate` (with X, and `failed` when the cast didn't go through), and `paid`
  (the sources that tapped, and who chose them);
- `move` for the agent's cards changing zones, including tokens appearing;
- `life` for any player;
- `look` for cards seen by scry, surveil, reveal or search;
- `decision` (kind, prompt, option count, answer by label, and who answered: agent, pilot, model, forced
  or ai; `p` when the answerer gave its confidence; `via` naming who handed it to the AI; `unlogged` for the
  AI's choices a fork can't replay);
- `eot` at the agent's end step: lands, potential and unspent mana, hand size, creatures, other
  permanents, and the opponents' total life;
- `fork` (the fork's session, and why it failed if it did), `snapshot`, `restore`, `override`. A fork's own
  record starts with `fork` naming its parent and how many decisions it replays.

Cards are named, never numbered. Ids appear only so a card seen twice counts once.

Python derives everything else:

- **Shown after each command:** what happened since the agent last looked, on one line.
- **`goldfish log`:** a header naming `deck@hash` and seed, then one line per turn. `--decisions` adds the
  choices, marking those the agent didn't make with who did (and the model's confidence); `--turn N` lists
  every fact.
- **`goldfish cards`:** cards seen (drawn, scryed, surveilled, revealed; each card once) and cards played
  (lands and spells), by name. `--by-turn` splits them per turn.

Restoring a snapshot drops the abandoned line from these views; `--all` keeps it.

- **`goldfish run` / `report`:** a batch manifest in `.goldfish/batches/b<N>.json` lists its games. The
  report (`goldfish/report.py`) gives per-turn averages (lands, potential and unspent mana, the share of
  games that missed a land drop, cumulative spells, damage to opponents), when the commander was cast,
  and mulligans. With a pilot or the model, it also gives the share of decisions each decider made, and the
  model's calls and cost. `--per-game` adds a line per game (open any with `--session gN log`); `--cards` adds, per
  card, how many games saw and played it.

Not yet: deck-plan checkpoints, missing-colour and flood flags, and resuming an automated game by hand.

## The decision model

`run --guide PLAN` puts a small decision model in the agent's seat (`goldfish/model.py`): TypeSafe's Jev,
through OpenRouter's (Jev 1.14) or Defapi's (Jev 1.13) decisions API, which take the same requests. It
doesn't generate text: it picks one of the named options and returns probabilities, and only input is
billed. The agent's reasoning is spent once, on the plan: a few
plain-language sentences on what the deck wants to do. The model then reads, at each decision:

- the plan and a line describing the table;
- the board view from `state`, plus the text of every nonbasic card in hand, on the battlefield and in the
  command zone;
- this turn so far from the record: what happened, then its latest decisions and who made them, so it can
  see when it is repeating itself;
- the decision, with each option's full text as its criterion.

That is about 2.5–6 KB a decision. A single pick is one `choice` question; attacks compare everything with
nothing. Orderings, repeatable modes, wide X ranges, long lists and mana payment go to Forge's AI. Each
answer is recorded `by: model` with the model's confidence `p`, so `log --decisions` shows how sure it was.

**Hybrids** (`--hybrid`). Jev works best on concrete outcomes, and Forge's AI already knows how to finish a
line, so the default compares *lines played out by Forge's AI*:

- `outcomes` (default): at each decision of the agent's own turn, Forge's AI's own pick and every option
  (up to ten) are played out, each in a fork of the game (see Forks), by Forge's AI to the start of the next
  turn. The model reads each option's text and result (what happened, then mana, damage and permanents
  gained or lost, in words compared with the other options), with Forge's pick marked as the default
  selection, in one question. Forks run in parallel, and the game itself is never touched.
- `plain`: the model picks from the options' text; nothing is played out.

Since a line runs into the next turn, these batches run the engine two turns past `--turns` and end each
game themselves; reports ignore the extra turns. A fork that doesn't replay into the same game is counted
as drifted and that decision is asked plain.

**Loop guard:** a pilot or the model can repeat itself without end (Jev declined a fetch land's search and
then refused to cancel it, over and over). After 100 decisions in one turn, Forge's AI finishes that turn;
the report counts those games and `--per-game` names the turn.

Keys come from `OPENROUTER_API_KEY` or `DEFAPI_API_KEY`, or the files `openrouter.key` and `defapi.key` in
`~/.config/goldfish/`. The first provider with a key is used; `GOLDFISH_DECISION_PROVIDER` picks one and
`GOLDFISH_DECISION_MODEL` another model. `goldfish model` makes one tiny call to check. OpenClaw's own
OpenRouter key can't be used: it's a protected secret, reachable from a subprocess only through OpenClaw's
secret proxy, which covers only commands OpenClaw runs itself.

## Pilots

A pilot is a Python file passed by path, defining functions named after decision kinds (`mulligan`,
`play`, `targets`, `mode`, `number`, `confirm`, `order`, `choose`, `attack`, `pay`). Each gets the decision
as a dict (kind, turn, prompt, options, details, min, max, repeat) and returns option numbers, or `None`
to pass it on to the model or Forge's AI. Answers are recorded `by: pilot`.
`examples/pilots/commander_first.py` casts the commander whenever it's offered. Where pilots live is the
caller's choice; nothing here assumes a location.

## Cards Forge lacks or gets wrong

`goldfish start` refuses a deck with cards Forge doesn't know, and names them. Fixes are Forge scripts in
`cards/` (M3); engine bugs go upstream as Forge pull requests. Until something is fixed, overrides keep the
game honest, and each one is recorded.

## Forks: a game replayed from its seed

`fork` makes a new session from a parked one: the same deck, seed and settings, answering every decision
from the parent's log instead of asking. Nothing weighs anything during the replay, so it is only Forge
resolving the same actions in the same order: a turn-8 position replays in about a second and a half. It
then checks it reached the same decision in the same state (a fingerprint: turn, life, mana pools, every
zone of the agent's in order, each permanent's tapped, sick, damage, counters and P/T, the stack) and
parks there, a game of its own. A mismatch ends the fork and the request fails with the first difference;
the parent is never touched. This is the only lookahead mechanism; the in-place restore it replaces
(`snapshot`/`restore`, kept for manual play) could not be made exact.

Replaying exactly needed Forge's AI kept out of the game's state, each found by a drifted fork:

- its weighing draws from the one shared random sequence (`MyRandom`), which also shuffles, so
  `SeededRandom` gives the AI a second sequence while the controller marks it as thinking;
- it decides with a time budget (`Game.AI_TIMEOUT`, 5 s), so what it does can differ between runs, which
  is why forks never let it think;
- it remembers mana sources it means to hold back, and caches costs it found unpayable, both outside the
  game state and both consulted when checking what can be paid for; the controller clears them around
  that check;
- it leaves the X it weighed on the ability; the controller resets X before listing plays;
- it takes triggers out of the list it is given while ordering them; the controller hands it a copy;
- it makes scratch cards while weighing, so later card ids differ; the fingerprint ignores ids and sorts
  the stack, whose triggers may be ordered by id;
- it caches evaluations in a process-wide map that only its own play choice clears; the controller clears
  it at every priority, or games whose plays are chosen by others leak every card they ever saw. The map
  also compared cards by id across games, so games running side by side read each other's evaluations: a
  patch in `scripts/forge-patches/` makes it per thread;
- it answers one decision by asking the controller another (proliferate chooses its permanents through a
  further choice); choices made while the AI is answering are part of its answer and aren't logged;
- an ability activated before keeps the list of what paid for it last time, which Forge's human play path
  clears and its AI path doesn't; the controller clears it, or the logged payment grows every activation.

The mana abilities Forge's AI activated to pay, in order and with the colours they made, are logged as its
`pay` answer (the spell's own list of them, which Forge's AI path never clears between activations of the
same ability, so the controller does), and a fork activates exactly those, then pays from the pool.

## Snapshots and overrides

Snapshots use forge-game's `GameSnapshot`, the copy behind Forge's own experimental undo. They also save the
game's random sequence, so a restored line shuffles and draws exactly as before. Snapshots are taken and
restored only at a `play` decision. A restore puts the copy back into the running game, then the parked
decision is asked again from the restored state.

Forge's restore reuses cards that still exist and resets only some of their state. Three gaps made
restored games differ from the snapshot, and are fixed:

- counters and damage on surviving cards weren't put back (a patch to Forge in
  `scripts/forge-patches/`, which `bootstrap-forge.sh` applies, until it is fixed upstream);
- static abilities weren't recomputed, so a commander cast in the abandoned line couldn't be cast from the
  command zone again (`Session.restore` rechecks them);
- Forge's AI remembers cards between decisions outside the game state (`Session.restore` clears it).

Abilities put on the stack after a snapshot aren't taken back by a restore, so restore only to a snapshot
taken with an empty stack, and from a state whose stack is empty.

Overrides are commands on cards named by the agent: move between zones, create a card, set life, add or
remove counters of any type, tap, untap. Use `Name#2` for the second card of that name. Triggers are
suppressed during an override, because a correction states how the game should be; it shouldn't set off
new effects. A waiting `play` decision is asked again afterwards, so its options match the corrected board.

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

## Measured in M2 (2026-10-23)

- **Batches:** 100 games of the Marath deck to turn 8 with Forge's AI piloting, 8 at a time: 40.9 s. The
  engine held about 810 MB resident afterwards.
- **Seeds:** the same seed gives the same draws. Forge's AI evaluates some choices on time-limited worker
  threads, so its games can still differ slightly: rerunning 6 seeds gave 5 identical games and one with
  different combat damage.
- **Forge's lookahead (`--ai`):** Forge's AI is rule-based and greedy by default (it casts the most
  expensive spell its rules approve, re-deciding at each priority). It has two experimental modes:
  - `hybrid` keeps the rules but simulates each candidate play once as a safety check. On 40 matched seeds
    it was 45% slower (28.2 s against 19.4 s) and no better: 7.0 lands and 11.9 mana at turn 8, against
    7.7 and 13.0.
  - `sim` searches up to three actions ahead within the turn, copying the game for each branch. It ran out
    of a 2 GB heap by turn 3–5 even one game at a time. With 6 GB, one game took 77 s to reach turn 3 and
    then crashed inside Forge's simulation (on a passive opponent's Wastes). It did cast Marath, which the
    default rules never do. Not usable for batches.

## Measured: forks (2026-10-23)

Four decks (the two Eternities decks, Dack cEDH, Blue Moon), four seeds each, forked at the first play
decision of turns 3, 5 and 8, in three modes: Forge's AI answering every parked decision, explicit answers
at single picks, and every kind parked and handed to the AI (`bench/fidelity.py`).

| | exact | drifted | replay at T3 / T5 / T8 (median) |
|---|---|---|---|
| Forge's AI answers | 41 | 3 | 0.36 s / 0.64 s / 1.42 s (8 / 19 / 56 decisions) |
| explicit answers | 39 | 5 | 0.27 s / 0.49 s / 0.97 s |
| every kind parked | 39 | 5 | 0.26 s / 0.52 s / 1.25 s |

After the isolations listed under Forks, with games one at a time: 45 of 45 scripted forks and 43 of 44
with Forge's AI answering replayed exactly, across all four decks. Four at a time: 44 of 45 scripted, and
about 38 of 44 with Forge's AI answering, so the drift left is cross-game interference between games that
run side by side and the AI's own payment side effects under it, not anything a deck does. Before the
isolations it was 21 of 32. Each drift is caught (a decision or fingerprint mismatch, named in the error
and the parent's record) and that decision is asked plain. `GOLDFISH_TRACE=1` in the engine's environment
logs every priority and attack for tracing a new one. A `scripted` mode of `bench/fidelity.py` answers
every decision by rule, so games repeat exactly and a drift there is reproducible.

Memory: after 93 games with forks, a forced GC left 8 cards on the heap (150 MB used). Before clearing
Forge's AI cache at each priority, the same run leaked 78,000 cards and ran out of a 2 GB heap.

## Measured on scenarios (2026-10-23)

`bench/scenarios.py` builds nine positions with one right answer that depends on sequencing (Sol Ring
before a colourless one-drop; the land before the spells it pays for; the untapped land over the tapped
one; spend all the mana; X at its largest; the commander over removal the plan says to hold; keep or
mulligan), each set up with overrides in a real game and played out in forks like the decider does, with
the answer fixed in the file before any run. `bench/try.py --scenarios --repeat 5 --by-case` asks Jev each
one five times under a variant of what it reads. Jev's picks were stable across repeats, so a miss is a
design fault, not noise:

- With outcomes worded only as "most mana next turn", Jev picked X = 1 for Walking Ballista and the Elves
  over Rampant Growth. Saying what each line leaves unspent ("spends all its mana this turn" / "leaves 2
  mana unspent") and naming a creature's size ("adds Walking Ballista 2/2") fixed both: 5 of 5 each.
- Jev kept a hand of seven spells and no land every time, even told "Lands in hand: 0 of 7" and with the
  answers described. A rule in the question ("keep a hand with two to four lands; mulligan the rest") fixed
  it: 9 of 10 with Forge's pick marked, 10 of 10 without. It doesn't count, and it doesn't infer rules; it
  follows them when stated.
- Marking Forge's AI's pick as the default selection changed nothing on these nine: its own pick was pass
  in three of them (it never casts Marath, and passed on a turn-1 Sol Ring).
- A played-out line can mislead. Forge's AI mana estimate, which the board line and the outcomes used,
  counts a land that makes one of two colours as three mana, so the tapped dual land "made the most mana
  next turn"; the engine now counts for itself.

With all of that (outcomes in words with unspent mana and sizes, the mulligan rule, the engine's own mana
count) Jev got 9 of 9 scenarios right five times out of five, with or without the default mark; text alone
with the mark got 8 of 9. That is what `goldfish/model.py` now sends.

## Measured with Jev (2026-10-23)

Jev 1.13 on Defapi, the Marath deck with `examples/plans/living-worlds.txt`, matched seeds:

| | Forge's AI + commander pilot | Jev with the plan |
|---|---|---|
| 20 games to turn 8 | 11.6 s, free | 116 s, $0.22 (0.45 s and about 1.6k tokens a call) |
| lands, mana at turn 8 | 8.2, 12.7 | 6.8, 11.2 |
| spells by turn 8, damage | 9.7, 52 | 8.2, 30 |
| commander cast | 20/20, median T3.5 | 15/20, median T3 |

Jev plays legal, plan-shaped games and finds some lines Forge's AI doesn't (recasting Marath from the
graveyard with Exploration Broodship), but develops worse: it rarely uses draw engines such as Tome of
Legends, and spends Marath's counters one at a time. Its confidence on plays is mostly 20–40%.

With forks (`--hybrid outcomes`, 4 games to turn 6, 4 at once), before the scenario work: 305 s, 343
calls, $0.047; 1,299 lines played out at 1.1 s a fork, 4 of which drifted. Jev decided 90% of decisions
and developed worse than Forge's AI alone (4.5 lands and 8.0 mana at turn 6 against 5.9 and 8.1 on 40
seeds), missing land drops and looping on an activation in 2 of 4 games until the loop guard stepped in.

After it (unspent mana and sizes in the outcomes, the mulligan rule, the engine's mana count), 20 games to
turn 8 on seeds 1–20, 4 at a time, against Forge's AI alone on the same seeds:

| at turn 8 | Forge's AI | Jev with the plan |
|---|---|---|
| lands, mana, unspent | 7.9, 11.0, 3.1 | 8.9, 13.8, 1.8 |
| games that missed a land drop | 47% | 29% |
| spells cast, cards in hand | 7.9, 3.5 | 8.6, 2.5 |
| creatures, other permanents, power | 4.3, 2.2, 17.1 | 7.5, 1.4, 36.1 |
| commander cast | never (Forge's AI won't) | 20 of 20, median turn 4 |
| damage | 25.9 | 28.8 |
| time, cost | 10 s | 30 min, $0.23 (1,548 calls, 5,798 forks at 2.1 s under that load) |

Jev now develops better than Forge's AI on every row but cards in hand, which it spends. Caveats: one game
hit the loop guard, two ended early in an engine error (a choice from an empty list read as a number
decision; fixed since), 307 forks (5%) drifted under the parallel load and were asked plain, and forks
took twice as long as when run alone. One game won on turn 7.

