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
| `vendor/forge/` | Java, Forge | Upstream Forge at the pin, with our patch series; its card data is the card pool |
| `cards/` | Forge card scripts | Cards Forge lacks or gets wrong, with provenance (see Local card scripts) |
| `scripts/` | sh | Fetching, patching and building Forge; building the engine |
| `bench/` | Python | Fork fidelity, scenarios and model-reading experiments ([measurements](measurements.md)) |
| deck, plan and pilot (outside) | text + Python | The decklist, and optionally a deck plan and a pilot file, passed by path |

Decisions have to be intercepted inside Forge, so the engine is Java. Everything an agent writes or reads
(pilots, metrics, reports) is Python: that matches Deckmaster's tooling, and it changes without rebuilding
the JVM.

## Decisions: the one seam

Forge asks each player's `PlayerController` everything: 112 abstract methods at the pinned commit. The
agent's seat is `ManualController extends PlayerControllerAi`. Each method it overrides becomes a
`Decision`: a kind, the turn, a short prompt, and numbered options labelled by card name. On the
battlefield, a label also carries what tells copies apart: P/T, counters, tapped, token. Each option's full
text (Oracle text or the whole ability) travels with it for `decision --full`. For a permanent on the
battlefield the text is its abilities as they are now, not as printed: a clone's, gained ones, a land that
used to be a creature (Princess Yue returning as Moon with the abilities of whatever the returning card
copies). The answer is option numbers
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

Forge marks some cards as ones its AI can't play well (`AI:RemoveDeck:All`; Marath, Will of the Wild, is
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
attacks or blocks. Each game thread has its own seeded RNG (`SeededRandom` installed as Forge's `MyRandom`),
so a seed replays the same draws even with games running side by side. Start with `--seed` to compare lines
on the same draws. A game runs until it ends or the agent ends it; `--turns N` is an optional cap.

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
  games that missed a land drop, cumulative spells, damage to opponents), when the commander was cast, and
  mulligans. With a pilot or the model, it also gives the share of decisions each decider made, and the
  model's calls and cost. `--per-game` adds a line per game (open any with `--session gN log`); `--cards`
  adds, per card, how many games saw and played it.

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

The model doesn't count or infer, so facts it would need to are stated: at a mulligan, how many lands the
hand holds, the colours they make, and which cards need a colour they don't, with the keep rule in the
question (two to four lands that make the colours the spells need); at a play decision with a land in
hand, whether the land drop is still there. Deck knowledge stays out of the model: a pilot file may define
`advise(state, decision, this_turn)` and return a line the model reads with the plan ("you have a mana
engine ready"); `examples/pilots/marath_advisor.py` is one. Played-out lines never name a drawn card, and
a line that starts with pass keeps passing that turn, so pass is never dressed up by what Forge's AI did
afterwards.

**Hybrids** (`--hybrid`). Jev works best on concrete outcomes, and Forge's AI already knows how to finish a
line, so the default compares *lines played out by Forge's AI*:

- `outcomes` (default): at each decision of the agent's own turn, Forge's AI's own pick and every option
  (up to ten) are played out, each in a fork of the game (see Forks), by Forge's AI to the start of the next
  turn. The model reads each option's text and the board it leads to (what happened this turn with draws
  unnamed, then lands, mana next turn, cards in hand, mana left unspent, and the nonland permanents), with
  Forge's pick marked as the default selection, in one question. Forks run in parallel, and the game
  itself is never touched.
- `plain`: the model picks from the options' text; nothing is played out.

Since a line runs into the next turn, these batches run the engine two turns past `--turns` and end each
game themselves; reports ignore the extra turns. A fork that doesn't replay into the same game is counted
as drifted and that decision is asked plain. The report counts drifted forks and the decisions asked plain
because of them, and names a game whose forks all failed from some turn on: the game itself left what its
log replays, so the rest of it was played without lookahead.

**Fast mode** (`run --fast`): the model is asked from the text first, and the options are played out only
when its pick is under 0.7 confidence. It is off by default: it saved little time and cost more calls
([measurements](measurements.md)).

**Failed calls:** a call the API never answers after six retries hands that one decision to Forge's AI and
is counted in the report (`calls failed`), rather than ending a 30-minute batch, which a single outage did.

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
to pass it on to the model or Forge's AI. Answers are recorded `by: pilot`. A pilot may also define
`advise(state, decision, this_turn)`, returning a line of guidance the decision model reads with the plan,
or `None`; a file with only `advise` is an advisor, deciding nothing itself.

**Writing an advisor.** The deck's designer knows which pieces matter; the advisor is where that knowledge
goes, and the harness parses nothing on its own. `goldfish/advice.py` is the platform: a script declares
the deck's pieces as roles (lists of this deck's cards, optionally also a phrase from card text where a
role is better said that way) and rules of the form "when these cards or roles are in these zones, say
this". Zones are the board, the hand, the graveyard, exile and the command zone, plus what the current
decision offers to cast or activate and from where (`castable`, `castable_from`), which is how a card
castable from the graveyard or exile, or an ability on the board, gets a line of its own. Every listed
piece must be present; `any_of` names a group of which one is enough; `test` takes any further check as a
function of the position (counters, mana, tapped, played this turn); a rule's text may be a function too,
for numbers. The model reads the result as one line with the plan, so:

- say what is true about the position ("a doubler is on the board: tokens and counters come doubled",
  "Marath has 3 counters and you have 3 mana: it can make up to a 3/3 token"), not which line to take; the
  played-out options show what each line does;
- speak only when the rule holds, and keep each rule to one sentence; a line on every decision is noise;
- measure a rule on a scenario (`bench/scenarios.py`, then `bench/try.py --advisor FILE` against the same
  scenario without it) and keep it only if it moves the pick.

`examples/pilots/marath_advisor.py` is the template; `atraxa_advisor.py`, `dack_advisor.py` and
`blue_moon_advisor.py` are the other decks'. A rule may also name what is on the stack (`stack=`), for
advice while a trigger waits to resolve. For an engine that takes several decisions, `bench/playturn.py`
sets up a position with overrides and lets the model play the turn with the advisor, then shows the
decisions it made.

Mana abilities are paid automatically and never offered as plays, with one exception: an ability whose
cost taps another permanent (Springleaf Drum, Holdout Settlement) is a choice with consequences (which
creature taps, and what triggers), so it is offered as a play; its mana waits in the pool for the next
cost. The Blue Moon deck's tap loop is played this way.
`examples/pilots/commander_first.py` casts the commander whenever it's offered. Where pilots live is the
caller's choice; nothing here assumes a location.

## Cards Forge lacks or gets wrong

`goldfish start` refuses a deck with cards Forge doesn't know, and names them. A missing card comes from a
newer Forge pin or a local card script, and a card that misbehaves mid-game can be corrected with an
override; see [Forge dependency](#forge-dependency) and Overrides. Each override is recorded.

## Forks: a game replayed from its seed

`fork` makes a new session from a parked one: the same deck, seed and settings, answering every decision
from the parent's log instead of asking. Nothing weighs anything during the replay, so it is only Forge
resolving the same actions in the same order: a turn-8 position replays in about a second and a half. It
then checks it reached the same decision in the same state (a fingerprint: turn, life, mana pools, every
zone of the agent's in order, each permanent's tapped, sick, damage, counters and P/T, the stack) and
parks there, a game of its own. A mismatch ends the fork and the request fails with the first difference;
the parent is never touched. This is the only lookahead mechanism; the in-place restore it replaces
(`snapshot`/`restore`, kept for manual play) could not be made exact.

Replaying exactly needs Forge's AI kept out of the game's state:

- its weighing draws from the one shared random sequence (`MyRandom`), which also shuffles, so
  `SeededRandom` gives the AI a second sequence while the controller marks it as thinking;
- it decides with a time budget (`Game.AI_TIMEOUT`, 5 s), so what it does can differ between runs, which is
  why forks never let it think;
- it remembers mana sources it means to hold back, and caches costs it found unpayable, both outside the
  game state and both consulted when checking what can be paid for; the controller clears them around that
  check;
- it leaves the X it weighed on the ability; the controller resets X before listing plays;
- it reorders or empties the lists it is given (triggers while ordering them, search results while picking
  one), and a fork, which never asks it, sees them as Forge left them; the controller hands it copies;
- it makes scratch cards while weighing, so later card ids differ; the fingerprint ignores ids and sorts the
  stack, whose triggers may be ordered by id;
- Forge numbers triggers, abilities, static abilities and replacement effects from process-wide counters,
  compares them by those numbers, and sets the trigger counter back each time a game starts, which with
  games side by side hands a running game numbers its own triggers already have, so one of them is lost. A
  patch in `scripts/forge-patches/` makes the counters atomic and lets a reset only raise them; each game
  also builds from its own copy of the deck;
- it caches evaluations in a process-wide map that only its own play choice clears; the controller clears it
  at every priority, or games whose plays are chosen by others leak every card they ever saw. The map also
  compared cards by id across games, so games running side by side read each other's evaluations: a patch in
  `scripts/forge-patches/` makes it per thread;
- it answers one decision by asking the controller another (proliferate chooses its permanents through a
  further choice); choices made while the AI is answering are part of its answer and aren't logged;
- an ability activated before keeps the list of what paid for it last time, which Forge's human play path
  clears and its AI path doesn't; the controller clears it;
- Forge decides every part of a cost before paying any, so replayed mana must be produced when the mana part
  is paid, after the other parts' choices, or a sacrifice choice sees lands tapped that weren't in the
  original; a patch adds a `beforePayingMana` hook to Forge's cost decision maker for that.

Forge's AI's payment is logged as its `pay` answer from what actually happened: a patch in
`scripts/forge-patches/` tells the controller each time a mana ability makes mana, with the mana it made,
and every activation of a listed ability becomes an option, in order, one per colour where it chooses. That
covers sources that paid another mana ability's cost through the pool (a Station land's "{G}, {T}: Add {G}
for each creature") and an ability activated more than once (Crystalline Crawler). A fork activates exactly
those, abilities that cost mana last so they pay from the pool, then pays the spell from the pool.

A drift is caught as a decision or fingerprint mismatch, named in the error and in the parent's record,
and that decision is asked plain. `GOLDFISH_TRACE=1` in the engine's environment logs every priority and
attack for tracing a new one. `bench/fidelity.py` forks games at fixed turns and counts exact replays,
with Forge's AI answering (`ai`) or with every decision answered by rule (`scripted`, so a drift repeats);
run it on a deck with new mechanics before trusting comparisons on it.

## Snapshots and overrides

Snapshots use forge-game's `GameSnapshot`, the copy behind Forge's own experimental undo. They also save the
game's random sequence, so a restored line shuffles and draws exactly as before. Snapshots are taken and
restored only at a `play` decision. A restore puts the copy back into the running game, then the parked
decision is asked again from the restored state.

Forge's restore reuses cards that still exist and resets only some of their state. Three gaps made
restored games differ from the snapshot, and each is closed:

- counters and damage on surviving cards weren't put back (a patch to Forge in
  `scripts/forge-patches/`, which `bootstrap-forge.sh` applies, offered upstream);
- static abilities weren't recomputed, so a commander cast in the abandoned line couldn't be cast from the
  command zone again (`Session.restore` rechecks them);
- Forge's AI remembers cards between decisions outside the game state (`Session.restore` clears it).

Abilities put on the stack after a snapshot aren't taken back by a restore, so restore only to a snapshot
taken with an empty stack, and from a state whose stack is empty.

Overrides are commands on cards named by the agent: move between zones, create a card, set life, add or
remove counters of any type, tap, untap, destroy. Use `Name#2` for the second card of that name. Triggers
are suppressed during an override, because a correction states how the game should be; it shouldn't set
off new effects. `destroy` is the exception, asked for so that what dies triggers, though Princess Yue's
death trigger doesn't fire from it: the trigger looks back at what she was, which needs more than the
last-known-state refresh the override does. A waiting `play` decision is asked again afterwards, so its
options match the corrected board, and overrides are logged so a fork makes them too.

## Forge dependency

`scripts/bootstrap-forge.sh` sparse-fetches a pinned upstream commit into `vendor/forge` (gitignored),
applies our patch series as commits on its `goldfish` branch, and installs forge-core, forge-game and
forge-ai into the local Maven repository, with no GUI modules. Headless startup (`engine/.../Forge.java`)
is the card-data part of forge-gui's `FModel.initialize`, reading card scripts from
`vendor/forge/forge-gui/res/cardsfolder`. Engine and card data always come from the same commit.

### Engine patches

`scripts/forge-patches/` is a `git format-patch` series, applied in order with `git am -3`. Each message
says why the patch exists and, in a `Goldfish-Upstream:` trailer, whether it is offered upstream
(`offer`), needs rework first, or is a hook only this host needs (`local`). Patches never implement a
card. To change one, commit on `vendor/forge`'s `goldfish` branch (amend or rebase as usual), then export
the whole series again:

```bash
rm scripts/forge-patches/*.patch
git -C vendor/forge format-patch -N --zero-commit --no-signature -o "$PWD/scripts/forge-patches" \
  "$(sed -n 's/^FORGE_COMMIT=//p' scripts/bootstrap-forge.sh)..goldfish"
```

Bootstrap refuses to rebuild over uncommitted edits or unexported commits there. A build is named by
the pin and a hash of the series (`cec1aaea-01284e96`) and installed as its own Maven version, so a
candidate never replaces the live build; `.goldfish/forge-build` records what is installed. The engine
compiles against that version, refuses to start when it isn't the checkout's (`goldfish doctor` shows
both), and every game record's `start` fact carries it as `forge`.

### Local card scripts

A card Forge lacks or gets wrong is written as an ordinary Forge card script, using only mechanics the
engine already has. Scripts live in `cards/`; `cards/manifest.json` gives each one's card name and
provenance (the upstream script it was modelled on, where its rules text came from, the upstream commit
checked). At engine start, `goldfish/card_resources.py` installs them into
`cardsfolder/goldfish-local`, where Forge's normal reader finds them; there is no second card parser.

Upstream wins. If the pinned Forge defines a card with the same name, the installer stops and names both
paths: compare the two, check upstream's with the same scenarios, then remove our entry. A script dropped
from the manifest is moved to `.goldfish/retired-cards/`, never deleted, and the installer also stops on
an installed file it didn't write or that was edited in place. Rules scenarios for the local cards are in
`tests/test_trek_cards.py`. Game records carry the local scripts available (`local_cards`, with a hash),
and record headers show them.

[`skills/forge-cards/SKILL.md`](../skills/forge-cards/SKILL.md) owns the procedure for adding, checking
and retiring cards.

### Updating upstream support

Card support and the engine move together: a newer pin, never newer card data on an older engine.

1. Check what is missing: the exact card names against the installed pin and a specific upstream commit
   (including `cardsfolder/upcoming`). A file being present is not a passing rules test.
2. Change `FORGE_COMMIT` and run bootstrap. The candidate gets its own Maven version, so the live engine
   doesn't change while it is evaluated. A patch that no longer applies stops bootstrap in `git am`:
   resolve it there and export the series again. Drop a patch only when upstream now contains it.
3. Run the tests, a seeded baseline (manual decisions, a batch, forks, snapshot and restore) and
   `bench/fidelity.py ai` on the decks in use, then the rules scenarios for any newly supported cards.
4. Install only while the engine is idle, and keep the previous pin's build to roll back to if the
   baseline regresses.
