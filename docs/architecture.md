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
| `vendor/forge/forge-gui/res/` | Forge resources | Upstream-maintained cards, tokens and editions at the engine pin |
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
cost. Without this the Blue Moon deck's tap loop could not be played on purpose.
`examples/pilots/commander_first.py` casts the commander whenever it's offered. Where pilots live is the
caller's choice; nothing here assumes a location.

## Cards Forge lacks or gets wrong

`goldfish start` refuses a deck with cards Forge doesn't know, and names them. The support check and update
path live under [Forge dependency](#forge-dependency). Overrides keep the
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
- it reorders or empties the lists it is given (triggers while ordering them, search results while picking
  one), and a fork, which never asks it, sees them as Forge left them; the controller hands it copies;
- it makes scratch cards while weighing, so later card ids differ; the fingerprint ignores ids and sorts
  the stack, whose triggers may be ordered by id;
- Forge numbers triggers, abilities, static abilities and replacement effects from process-wide counters,
  compares them by those numbers, and sets the trigger counter back each time a game starts. With games
  side by side, a running game was handed numbers its own triggers had and lost one of them (Maturation
  Chamber stopped counting casts; Warp Speed's enters trigger never fired), so the original game left what
  its log replays and every later fork failed. A patch in `scripts/forge-patches/` makes the counters
  atomic and lets a reset only raise them; each game also builds from its own copy of the deck;
- it caches evaluations in a process-wide map that only its own play choice clears; the controller clears
  it at every priority, or games whose plays are chosen by others leak every card they ever saw. The map
  also compared cards by id across games, so games running side by side read each other's evaluations: a
  patch in `scripts/forge-patches/` makes it per thread;
- it answers one decision by asking the controller another (proliferate chooses its permanents through a
  further choice); choices made while the AI is answering are part of its answer and aren't logged;
- an ability activated before keeps the list of what paid for it last time, which Forge's human play path
  clears and its AI path doesn't; the controller clears it, or the logged payment grows every activation;
- Forge decides every part of a cost before paying any, so replayed mana must be produced when the mana
  part is paid, after the other parts' choices, or a sacrifice choice sees lands tapped that weren't in the
  original; a patch adds a `beforePayingMana` hook to Forge's cost decision maker for that.

The mana abilities Forge's AI activated to pay, in order and with the colours they made, are logged as its
`pay` answer (the spell's own list of them, which Forge's AI path never clears between activations of the
same ability, so the controller does), and a fork activates exactly those, then pays from the pool. Two
cases needed more than the spell's list. A mana ability that costs mana (a Station land's "{G}, {T}: Add
{G} for each creature") may be paid from the pool by a source no list names, so the mana it spent supplies
that source, and a fork activates such abilities last, from the pool. An ability activated twice in one
payment (Crystalline Crawler's "add one mana of any colour") remembers only its last colour, so each
activation takes its colour from the mana spent.

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
remove counters of any type, tap, untap, destroy. Use `Name#2` for the second card of that name. Triggers
are suppressed during an override, because a correction states how the game should be; it shouldn't set
off new effects. `destroy` is the exception, asked for so that what dies triggers; as of now Princess Yue's
death trigger still doesn't fire from it (open: the trigger's look at what she was needs more than the
last-known-state refresh the override does). A waiting `play` decision is asked again afterwards, so its
options match the corrected board, and overrides are logged so a fork makes them too.

## Forge dependency

`scripts/bootstrap-forge.sh` sparse-fetches a pinned upstream commit into `vendor/forge` (gitignored) and
installs forge-core, forge-game and forge-ai into the local Maven repository, with no GUI modules. Card
scripts come only from `vendor/forge/forge-gui/res/cardsfolder`; the live `Forge.start` has no custom-card
reader. Headless startup (`engine/.../Forge.java`) is the card-data part of forge-gui's `FModel.initialize`.
There is no long-lived engine fork. Prefer Forge-maintained scripts; Mike's November 2 instruction
also permits native, script-only card contributions using existing engine mechanics and analogous
upstream cards, with behavior tests and verified replacement when upstream catches up.

### Script-only card additions

Mike's November 2 instruction supersedes the October 31 prohibition on locally authored card scripts.
[`skills/forge-cards/SKILL.md`](../skills/forge-cards/SKILL.md) owns the maintenance procedure. Native
scripts live in `cards/`, with provenance in its manifest; `goldfish.card_resources` synchronizes them
into the ordinary upstream resource reader at idle startup. It stops on duplicate upstream names or
edited/unmanaged destination files. Retired installed files are preserved, not deleted. No Forge engine
changes were introduced for these cards; pre-existing host-integration patches remain separate.
Game records carry `local_cards` availability and record headers expose it. This is not a claim that
every available script was used in that game.

### Updating upstream support

1. Inventory the exact missing cards in the requested export. Check the installed pin and a specific
   official [release or snapshot commit](https://github.com/Card-Forge/forge), including `upcoming`.
   A newer tag alone is not evidence of support. Record full commit, source paths and card names;
   filename presence is not a passing rules test. Keep unsupported previews out of claimed playtests;
   do not silently cut or substitute cards in Mike's list.
2. Default to engine and all resources from the same commit. The bootstrap pins them together; the
   official `AutoUpdater` distributes versioned release/snapshot packages, not a card-only compatibility
   contract. This headless host has no supported independent card-data updater. A proposed data-only
   import would need an exact upstream source revision, its tokens/editions/keywords and engine feature
   compatibility proved in isolation; do not copy latest cards into an older engine on assumption.
3. Prepare a clean candidate checkout, preserving the dirty live tree and every existing Forge patch.
   Inventory vendor status, patch hashes and engine dependencies first. Change `FORGE_COMMIT` deliberately;
   build candidate Forge into an isolated Maven repository and compile the host against that repository,
   so shared snapshot artifacts and the live engine cannot change during evaluation. Verify each patch
   still applies or is demonstrably upstream; never drop one merely to make the build pass.
4. Run the existing engine tests, a seeded known-supported baseline (manual decisions, batch, fork and
   snapshot/restore), then starts of the original exports and focused native-rule scenarios for newly
   supported cards. Record unknown cards, parser failures and untested behavior separately. These scenarios exercise the upstream-maintained
   resources. Failure or incomplete coverage leaves the current pin installed.
5. After candidate review, back up changed files and the working dependency checkpoint. Install only
   reviewed changes when the simulator is idle; do not end somebody else's game. Rebuild and verify the
   original failing exports before declaring recovery. Roll back to the prior pin, resource tree, patches
   and compiled dependencies if the baseline or required behavior regresses; retain game records.

### Checked October 31, 2026 (inventory, not rules acceptance)

Installed `b13b6c822a7bc54e3150d0ff4899f1f8fe60346c`: all thirteen names below are absent.
Official tree `9b31ac1a8733d57cc395c613ec0916f3e09f42a4` (complete, not truncated):

- **Present upstream only, not installed or behavior-verified:** Captain Pike, Fullness of Time,
  `forge-gui/res/cardsfolder/upcoming/captain_pike_fullness_of_time.txt`.
- **Absent upstream:** Locutus of Borg; Co-Option Adjutant; Borg Scout Sphere; Hit It; Final Frontier;
  U.S.S. Discovery, at Black Alert; Conquest Mission; Warp Speed; Genesis Device; Maturation Chamber;
  Stable Wormhole; U.S.S. Voyager (not unrelated cards with “Voyager” in their name).

Latest tagged `forge-2.0.15` was published September 28, older than the installed October 23 pin.
Neither upgrading blindly nor importing Pike alone unblocks the two full Trek exports. Keep those
exports blocked honestly; existing supported lists can still be tested. The previous local eleven-card
candidate is uninstalled, superseded evidence, not an update source; its failed-repair brake still stands.
Recheck upstream for a new requested test or deliberate upgrade, not with a new polling job.

Sources: [complete tree](https://api.github.com/repos/Card-Forge/forge/git/trees/9b31ac1a8733d57cc395c613ec0916f3e09f42a4?recursive=1),
[latest release](https://api.github.com/repos/Card-Forge/forge/releases/latest),
[official updater](https://github.com/Card-Forge/forge/blob/9b31ac1a8733d57cc395c613ec0916f3e09f42a4/forge-gui/src/main/java/forge/download/AutoUpdater.java).
The installed support list must be rechecked after any pin change.

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
with Forge's AI answering replayed exactly, across all four decks. Before the isolations it was 21 of 32.

Rechecked November 3 on six lists (the four decks plus Deckmaster's two current Eternities builds, which
add Station lands, Spacecraft and Crystalline Crawler), eight seeds, forks at turns 3, 5, 7 and 8. Before
this round's fixes, 30 of 40 forks with Forge's AI answering replayed one at a time, and Deckmaster's
two-game batches lost lookahead on up to 46% of decisions. The fixes were the search-list copies, the
mana payment cases under Forks and the id counters. After them, six games at a time: 187 of 187 scripted
and 185 of 185 with Forge's AI answering replayed exactly. Four reruns of Deckmaster's batches played out
2,275 lines with none drifted. Each drift is caught (a decision or fingerprint mismatch, named in the error
and the parent's record) and that decision is asked plain. `GOLDFISH_TRACE=1` in the engine's environment
logs every priority and attack for tracing a new one. A `scripted` mode of `bench/fidelity.py` answers
every decision by rule, so games repeat exactly and a drift there is reproducible.

Memory: after 93 games with forks, a forced GC left 8 cards on the heap (150 MB used). Before clearing
Forge's AI cache at each priority, the same run leaked 78,000 cards and ran out of a 2 GB heap.

**Where a fork's time goes** (`bench/forkbench.py`, turn 8, 84 decisions replayed, one at a time, with
stack samples of the game thread): about 1.0 s. A third is Forge recomputing static abilities as the
replay resolves actions; a quarter is the controller's own check of what is playable at each stop (a test
payment per ability); a fifth is building the game (400 cards for four decks); the rest is resolving.
Evaluating playable options only at the agent's stops, not at every priority, took 11% off. Playing a line
out after the fork costs about 0.2 s more, nearly all Forge's AI thinking, so an engine-side rollout would
save little.

**Scaling:** 1.0 forks/s one at a time, 3.1 four at a time, 4.0 eight at a time, and no more with sixteen
(each fork then just waits twice as long). The decider caps forks in flight at eight across every game in
the process (`GOLDFISH_FORKS` to change it). The 20-game batch above ran 24 at once.

## Measured on scenarios (2026-10-23)

`bench/capture.py` saves real decisions from a game, with every option played out, as situations (48 of
them, from the four decks at seed 3002; an earlier set captured with Forge's inflated mana estimate is
kept in `bench/situations/stale/`, out of the bench). `bench/scenarios.py` builds nine positions with one
right answer that depends on sequencing (Sol Ring
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

**The after-line.** 20 of the 48 recaptured situations have an answer worth defending (one castable card
and nothing else to do; a rock that pays for the rest of the turn; the land that makes the colour a spell
needs; a fetch never finding nothing; X at its largest), each labelled with its reason in the file. On
those 20 and the nine scenarios, three times each, an option's result as the board it leads to in absolute
terms ("after: 2 lands, 4 mana next turn, 2 cards in hand; 0 mana unspent; board: Sol Ring") scored 89%,
against 82% for the comparative words ("the most mana next turn of these options") and 80% for the text
alone. It fixed X at its largest, casting the one castable card instead of passing, and the doubler
scenario; it lost one Voltaic Key case. The decider now sends the after-line.

**The advisor.** On a board with Doubling Season and Marath holding three counters, Jev picked Marath's
token 3 times in 5 without advice and 5 in 5 with the advisor's lines ("a doubler is on the board: tokens
and +1/+1 counters you make come doubled; Marath has 3 counters and you have 3 mana: it can make up to a
3/3 token"). A fact about the board, not an instruction, is enough.

**A whole engine turn** (`bench/playturn.py`, the Blue Moon deck on turn 5 with Minamo, Deserted Temple,
Matoya, Tui and La, Springleaf Drum, Wake Thrasher and Princess Yue on the board, Phantasmal Image and Of
One Mind in hand, with `blue_moon_advisor.py`): Jev tapped Tui and La with the Drum (a card and a mana),
untapped her with Minamo (a counter), untapped Minamo with Deserted Temple, untapped her again, cast Of
One Mind, then Phantasmal Image as a copy of Princess Yue so the legend rule killed the copy and it
returned as the land Moon, choosing which Yue stays and the Moon correctly. Before the Drum's ability was
offered as a play it could not tap her on purpose at all, and before the advisor's fact that untapping an
untapped permanent does nothing it untapped her first. 14 calls, 65 lines played out.

**The Moon line itself.** The deck's real trick: a clone of Princess Yue dies to the legend rule, and the
clone card returns as the land Moon entering as a copy of another creature, so a land with that creature's
abilities that Deserted Temple and Minamo untap. Driven by hand, Forge does all of it: with Phyrexian
Metamorph the returning card became "Moon, Legendary Land" with Tui and La's two triggers and "{T}: Add
{C}", Deserted Temple untapped it, and the untap trigger put a +1/+1 counter on the land. With Phantasmal
Image the copy keeps its "sacrifice when targeted" clause, so the Temple's untap killed it: Forge right,
and worth knowing. The state view shows the land as it is, with its current abilities. At the crux, the
"Choose a card (Moon)" decision (`scenario-moon-copy`), Jev copied Princess Yue again 5 times in 5 without
advice (a land that only scries) and Tui and La 5 times in 5 with the advisor's line about what the choice
makes; Forge's AI's default was Wake Thrasher.

**Stability.** Asked three times, Jev gave the same answer on 45 of 47 labelled situations with outcomes
and 42 of 47 from the text alone, and taking the plurality of three changed accuracy by one point at most
(82% to 83% text-only; 96% either way with outcomes). Repeating a question is not worth its cost here.

**Other forms tried** on the same 47 labelled situations, twice each, against the current design at 96%:
options in reverse order 90% (so there is order bias, and the engine's order, pass first then the hand,
is the better one); pass last 94%; a yes-or-no question per option 89% and a 0–4 score per option 90%,
both with confidence around 0.4 against 0.73 for the single choice; without the deck plan 91%; without
the "this turn so far" line 96%. One choice question, in the engine's order, with the plan, is the form to
keep; the history line could go to save tokens.

**Fast mode (routing on confidence).** On 76 real situations (the scenarios and captured decisions from four decks,
47 of them labelled), asked three times each from the text alone and three times with the options played
out: a text-only pick with confidence 0.7 or more covered 34 of the 76 and agreed with the played-out
pick in all of them; on the labelled ones, answering those from the text and the rest from outcomes
scored 96%, the same as outcomes everywhere. At 0.6 it covers 41 of 76 with 93% agreement and the same
96%; at 0.5, 53 of 76 but 83% agreement and 92%. `run --fast` does this: it asks from the text first and
plays the options out only when the pick is under 0.7, at the price of one extra call on the decisions it
still plays out.

In the 20-game batch, routing covered less than the bench suggested: 232 decisions skipped their forks,
about 18% of the ones that would have been played out, not 45%. The batch took 1,154 s against 1,796 s
unrouted and cost $0.35 against $0.23 (2,473 calls against 1,548). Forks per second rose from 3.2 to 4.2
with the cap and the cheaper fork, which accounts for most of the saving; routing itself removed 16% of
the forks, worth about the same share of the time, for 52% more spent on calls. Development was within
the noise of 20 games (8.3 lands, 14.1 mana, 8.7 spells at turn 8 against 8.9, 13.8 and 8.6; creatures 5.7
against 7.5). Fast mode is off by default: the saving is modest, the calls cost more, and the drop in
creatures and lands, though within the noise of 20 games, is the shape a loss would take. The fork cap
and cost are what moved the time.

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

**40 games** (seeds 1–40, after hidden draws, honest pass lines, the land-drop fact and the Marath advisor;
35 min, $0.36, 10,480 forks at 1.1 s, 3.4% drifted):

| at turn 8 | Forge's AI | Jev with the plan |
|---|---|---|
| lands, mana, unspent | 7.9, 10.4, 2.8 | 8.2, 11.7, 1.3 |
| games that missed a land drop that turn | 35% | 43% |
| spells cast, cards in hand | 7.9, 3.4 | 8.7, 3.1 |
| creatures, other permanents | 4.3, 2.7 | 6.5, 1.4 |
| commander cast | never | 38 of 40, median turn 4 |

Jev is ahead on lands, mana, mana used, spells, creatures and the commander, behind on missed land drops
late and on noncreature permanents (it casts creatures over rocks and enchantments). On the first 20 seeds
this round's changes moved lands up (8.9 to 9.2) and mana and creatures down (13.8 to 12.1, 7.5 to 6.4),
within what 20 games can tell. Missed land drops late in the game, with a land in hand by a rough count
about as often as Forge's AI, are the next scenario to build.

