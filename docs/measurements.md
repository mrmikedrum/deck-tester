# Measurements

What has been measured, dated, with the conditions. The newest result in a section is the one that holds;
older ones stay as the baseline they were compared against. [Architecture](architecture.md) describes the
design these numbers shaped.

The two Eternities III decks in `examples/decks` were updated to their ManaBox lists on 2026-11-04 (10 and 12
cards, mostly Star Trek). Results recorded before then used the earlier lists, so compare new runs with each
other, not with those.

## M0: the Forge spike (2026-10-23, Apple Silicon, 10 cores, JDK 21)

Measured with the spike harness, on the Marath deck against three passive opponents. The harness was
removed in M1 and is in git history at `e0e2b7e`.

- **Startup:** 1.8 s with all 34,100 card scripts loaded eagerly (146 MB heap). Lazy loading was slower
  (3.8 s) and saved only memory.
- **Coverage:** Forge knew all 100 cards.
- **Speed:** a game to turn 8 with Forge's AI piloting took about 1.3 s on one thread. 16 games on 8 threads
  took 6.3–7.3 s, so 100 games run in about 40–45 s.
- **Memory:** about 400–480 MB live heap with 8 games in flight; the engine runs with `-Xmx2g`.
- **Snapshots:** `GameSnapshot` copied a mid-game state in 29 ms and restored it in place in 5 ms, exactly.

## M2: automated batches (2026-10-23)

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

## Forks (2026-10-23, rechecked 2026-11-03)

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

Rechecked November 3 on six lists (the four decks plus Deckmaster's two current Eternities builds, which add
Station lands, Spacecraft and Crystalline Crawler), eight seeds, forks at turns 3, 5, 7 and 8. Before this
round's fixes, 30 of 40 forks with Forge's AI answering replayed one at a time, and Deckmaster's two-game
batches lost lookahead on up to 46% of decisions. The fixes were the search-list copies, the mana payment
cases (architecture, Forks) and the id counters. After them, six games at a time: 187 of 187 scripted and
185 of 185 with Forge's AI answering replayed exactly. Four reruns of Deckmaster's batches played out 2,275
lines with none drifted. With payments then recorded as they happen, the same matrix stayed exact and 265 of
265 forks on twelve new seeds, to turn 10, replayed exactly.

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
the process (`GOLDFISH_FORKS` to change it). The 20-game batch under fast mode, below, ran 24 at once.

## Decision model on scenarios (2026-10-23)

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

**Blue Moon built on Yue (2026-11-04).** At a table Blue Moon never made a Moon: three clones copied other
creatures (two of them legends it already had, so they died at once) and Yue, back in the command zone, was
never recast. The plan said "clones are best copying your best creature" and the advisor said so too. The new
plan and advisor say what a Moon is and how it's made; Yue stays a creature and goes to the command zone when
she dies. Metamorphic Alteration and Blade of Shared Souls make Moons too, checked in Forge: the creature made
a copy of Yue returns as itself (Fallowsage as a Moon that draws when tapped, not legendary), and the Blade
does it again with each equip. Machine God's Effigy doesn't: its copy isn't a creature. Labels now mark a
commander on the battlefield, since at the legend rule both read "Princess Yue 3/2". On five scenarios
(`moon-*`, with outcomes, 5 repeats each, against 3 for the old ones), the old plan scored 9 of 12 without
the advisor and 6 of 12 with it (its clone line pulled Vizier ahead of recasting Yue); the new plan 18 of 20
alone, 20 of 20 with the advisor, and the tapped-commander case 5 of 5. Four 8-turn games each, seeds
4001–4004: creature clones copied Yue 6 of 6 times against 3 of 12, with 6 Moons against 3, and the same
development (lands 7.5 against 6.5 at turn 8, power 18.8 against 20.8).

**Commanders in goldfish games never went back to the command zone** until 2026-11-04: the goldfish engine
set the game type to Commander without applying the variant, and Forge's command-zone rule (CR 903.9a)
checks the variant. A dead commander stayed in the graveyard, and Yue's trigger made her a Moon. Tables,
set up through a lobby, were right all along. Goldfish results from before then never saw a commander
recast after dying. With the fix, Princess Yue dying asks; Jev said no (she became a Moon) 4 times in 5
until the advisor said what each answer does, then yes 5 in 5 (`moon-yue-to-command`).

**Stability.** Asked three times, Jev gave the same answer on 45 of 47 labelled situations with outcomes
and 42 of 47 from the text alone, and taking the plurality of three changed accuracy by one point at most
(82% to 83% text-only; 96% either way with outcomes). Repeating a question is not worth its cost here.

**Other forms tried** on the same 47 labelled situations, twice each, against the current design at 96%:
options in reverse order 90% (so there is order bias, and the engine's order, pass first then the hand,
is the better one); pass last 94%; a yes-or-no question per option 89% and a 0–4 score per option 90%,
both with confidence around 0.4 against 0.73 for the single choice; without the deck plan 91%; without
the "this turn so far" line 96%. One choice question, in the engine's order, with the plan, is the form to
keep; the history line could go to save tokens.

**Fast mode (routing on confidence).** On 76 real situations (the scenarios and captured decisions from four
decks, 47 of them labelled), asked three times each from the text alone and three times with the options
played out: a text-only pick with confidence 0.7 or more covered 34 of the 76 and agreed with the played-out
pick in all of them; on the labelled ones, answering those from the text and the rest from outcomes scored
96%, the same as outcomes everywhere. At 0.6 it covers 41 of 76 with 93% agreement and the same 96%; at 0.5,
53 of 76 but 83% agreement and 92%. `run --fast` does this: it asks from the text first and plays the
options out only when the pick is under 0.7, at the price of one extra call on the decisions it still plays
out.

In the 20-game batch, routing covered less than the bench suggested: 232 decisions skipped their forks,
about 18% of the ones that would have been played out, not 45%. The batch took 1,154 s against 1,796 s
unrouted and cost $0.35 against $0.23 (2,473 calls against 1,548). Forks per second rose from 3.2 to 4.2
with the cap and the cheaper fork, which accounts for most of the saving; routing itself removed 16% of
the forks, worth about the same share of the time, for 52% more spent on calls. Development was within
the noise of 20 games (8.3 lands, 14.1 mana, 8.7 spells at turn 8 against 8.9, 13.8 and 8.6; creatures 5.7
against 7.5). Fast mode is off by default: the saving is modest, the calls cost more, and the drop in
creatures and lands, though within the noise of 20 games, is the shape a loss would take. The fork cap
and cost are what moved the time.

## Decision model in full games (2026-10-23)

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

## Copy forks (2026-11-03)

Forks made from a copy of the game (architecture, Copy forks), on Forge `e7020aa1` with the copier patch. On
the six lists and seeds of the forks recheck, then twelve new seeds to turn 10, with Forge's AI answering and
scripted: 94 of 94 and 95 of 95, then 168 of 168 and 170 of 170, then (after the last copier fixes) 139 of 139
and 143 of 143 landed in the same game, the same as replay forks. A copy fork took a median 20-40 ms at every
turn, against a replay's 0.36 s at turn 3 and 1.17 s at turn 8. Before the patch, 76-87% of copies matched
their game and up to 3.8% failed: the stack lost its abilities, the copy lost dungeons, priority, warp and
imprint links, class levels and what entered this turn.

At a four-player table with every seat forking at each play decision (`bench/table_fidelity.py`, four example
decks to turn 7): 172 of 180 at first (abilities whose source was sacrificed to pay for them, two-faced lands),
then 234 of 234, median 16 ms.

What the model reads: at every play decision of four Living Worlds and four Assimilation games to turn 6
(`bench/forks_compare.py`), every option was played out in a replay fork and in a copy fork and its result
line compared. 202 of 204 decisions read identically; the 2 that didn't also differ between two replay
forks, where Forge's AI plays the line out differently. A Jev batch (4 games to turn 6) took 27 s with copy
forks against 82 s with replay forks, 19 ms a fork against 645 ms; Jev's own picks vary between runs (seed
302's opening hand: mulligan at p 0.3 one run, keep at p 0.14 the next), so batches don't match game for game.

**Forge's Monte Carlo AI** (`run --ai flatmc`), 20 games to turn 8, seeds 1-20, one at a time: Living Worlds
7.6 lands and 9.6 mana with the plain AI, 8.4 and 11.7 with Monte Carlo; Assimilation 7.3 and 13.0, 7.5 and
12.3, commander median turn 5 and 4. About three times the time (71 s against 22 s). Its rollouts swap Forge's
global random object, so games beside each other would disturb each other's draws.


## Tables (2026-11-04)

**Copy forks at a table** (`bench/table_fidelity.py`, the four example decks to turn 8, every seat forking at
each play and block decision, the first seat activating Marath for tokens so the others meet it on the stack):
364 of 364 landed in the same game, 6 of them at blocks, median 16 ms. On the way, copies had lost a modal
ability's chosen mode (Marath on the stack), the AI memory that decides what can be paid (a waterbend cost's
tapped creatures), and a Saga or dungeon whose last chapter or room was still on the stack (state-based
actions ran before the stack was copied).

**Table situations** (`bench/table_scenarios.py`): thirteen hand-built positions in a three-player table, each
with an answer fixed before any run, decided by a Jev seat as at a table (forks, then the model), with Forge's
AI's own pick (the default line) scored the same way. Three runs each: Jev 32 of 39, Forge's AI 36 of 39. Both
right every time: blocks (a good block, no chump at 40 life, a chump to survive, surviving three attackers at
6 life), Swords on a lethal attacker and on the biggest threat, finishing a player at 3 life, not attacking
into two 6/4s, holding back when the crack-back is lethal. Jev only: attacking the open player rather than the
one with a blocker (Forge's AI doesn't attack). Jev's misses: blocking a deathtouch 1/1 with a 6/4 at 40 life
(0 of 3), and at the end of the turn before its own, holding Restoration Angel (0 of 3) and once Secure the
Wastes (2 of 3). On these basics Jev is right most of the time and doesn't beat Forge's AI.

What moved the results, each measured on the situation's own context before adopting it: one instruction for
every moment of another player's turn made Jev pass at end of turn (0 of 6); naming the moment (end of turn,
attacked, responding) made it play (5 of 5 on the token spell). Forks can't show the crack-back, since the
others pass in them, so a line states it: "the others' creatures could attack you for Bo 6" held Jev back 5 of
5 where "others' creature power: Bo 6" did 0 of 5. Lines also had to stop at the same point (the engine ends a
fork at the seat's next first main phase; before, a line with nothing to decide ran on for turns) and name what
each player lost (a block line didn't say the attacker died).

**A four-Jev table** (the example decks and plans, no people): Jev 2 (Assimilation) won in round 13, 31 minutes,
431 model calls, $0.15; 1,998 forks, 57 failed: an Incubator token's transform on the stack after another had
resolved (the copy described the entry from the token as it is now), and a goaded creature Dack Fayden gave
away (the copy dropped goad), both fixed since. Two plays it showed: an all-out attack that left Jev 1 open to
a 30-point crack-back (now stated in the lines), and the same token transformed six times in a row.
A second four-Jev table after those fixes, stopped in round 7: 994 forks, none failed or refused, Dack Fayden
cast. One of Jev 3's turns took about 40 minutes for 17 decisions and 51 forks: its forks never ended, because a
goaded creature's controller that declared no attack was asked again forever (Forge re-asks until the attack is
legal). Fixed since, and a fork that neither asks nor ends within 15 s is now recorded as stalled.

**Blocks left to Forge's AI, and token copies fixed** (2026-11-04, Forge `e7020aa1-da26829a`): fourteen
situations, two runs each, 26 of 28 right, Forge's AI 26 of 28. Blocks, now Forge's AI's at table seats, 10 of 10
(deathtouch included). A token copied without its paper card couldn't transform, so Jev's lines showed an
Incubator's transform doing nothing and the second activation looked as good as passing; with the fix, Jev
passes instead of activating it again (2 of 2). Jev still holds a flash creature at the end of the turn before its
own (0 of 2); Forge's AI still doesn't attack the open player. Saying "ends the same as pass, with 2 less mana"
on the line raised confidence in passing from 0.59 to 0.70 offline (5 contexts, 2 runs each); not adopted, as a
small gain that would also change goldfish. Copy benches on that build: 210 of 210 table copies (median 15 ms) and
48 of 48 goldfish copies landed in the same game.

**A four-Jev table to the end** (Forge `e7020aa1-d34a479b`): the first try froze in round 9, when Jev 3 lost: Forge
keeps a departed player's effects working from another player's command zone, the copier couldn't place them,
and the crash stopped Forge's game thread while the table waited. Fixed in the copier; a failed copy now costs
only that stop's lookahead, and a dead game thread ends the table. The rerun went to the end: Jev 2 (Assimilation)
won in round 17, three players knocked out on the way, 24 minutes, 735 model calls, $0.24. 3,184 forks, 15
failed: 14 when Dack Fayden's reveal put cards on the bottom in random order (the table's random sequence is
shared by every seat, so a fork's order can differ; the fingerprint check caught each), and one Forge AI block
search stalled. No refused attacks. One play it showed: Jev 1 chose Recon Craft Theta's crew nine times in a round
when it couldn't be paid, each one failing.

## Current-list piloting audit (2026-11-21)

Fresh ManaBox exports, not the older example fixtures: Living Worlds `4fa7041f`, Assimilation
`5815cfea`, both 100 cards. Python advisors and current-list scratch guides were supplied with
Jev 1.13 outcomes lookahead. Batch b226 kept a one-land and a seven-land nature opening despite
the guide; it is exploratory evidence, not a representative development baseline. Batches b231
and b233 used explicit opening-hand checks (decisions recorded as pilot). London bottom choices
were still model-made and can discard needed commander colors.

The records still show material strategy errors despite useful candidate rollouts: Marath spent
counters on incidental player damage instead of building tokens, a Commune with Lava was cast
with X=0, an ordinary noncreature Cornucopia entered with zero charges in a list with no independent
charge seeder, fetches took redundant basics while Atraxa colors were missing, and b231 cast Sunfall
on its own board against passive opponents. Repeated crew/activation attempts also recur. b233
reported 26/1511 failed forks, six decisions without lookahead and one turn handed to the loop guard.
These are piloting/protocol limits, not reasons to cut the cards or claim deck power from aggregate
board totals. A good opening filter is not sufficient strategic validation; inspect actual decisions
and record any manual intervention separately.

### Piloting repair and exact reconstruction (2026-11-21)

Replayed the original current-list hashes/seeds in an isolated runtime, with every prior parked
choice matching: g90764's actual T7 Sunfall choice after 58 decisions, g90761's first T4 Marath
mode after 17, and g92576's T6 Commune X choice after 33. Both b226 extreme opening hands also
reproduced. Captured states, choices and fresh forks live in `bench/situations/eternities-audit-*`.
These reconstruct the position, not the original random model sample: historical request bodies
and fork results were not retained, and Forge's AI continuation can vary.

Concrete protocol defects repaired in the shared goldfish/table decider:
- A hard-coded "win fast" goal competed with the supplied engine-development plan. Goldfish now
  follows the plan and names the absence of opposing nonland targets; tables keep their own goal.
- London cards are already bottomed when Forge asks keep, despite its "then bottom" prompt.
  Keep advice now evaluates the actual remaining hand. The existing two-to-four-land opening
  rule is enforced above four cards, with an explicit four-card floor. These deterministic
  choices record `by: policy`, not model or forced. All London subsets (at most 35) are model
  choices, rather than silently giving multi-card bottoms to Forge's AI. They are not rolled
  out, which would reveal the next draw.
- Failed actions were omitted by the successful-play turn digest. They now reach the model.
  Independently of model obedience, an engine-rejected play is excluded while its observed
  position is identical; any state change permits retry. This is failure feedback, not another
  implementation of card legality or a card-specific ban.
- Outcome boards now show counters, including counter-bearing lands, and explicitly attribute
  lost own engines. Wide X samples retain zero, one and both bounds. Exile counts are visible,
  explicitly *not* claimed to be playable cards: permissions may outlast the one-turn horizon.

On the exact reconstructed Sunfall position, three fresh Jev 1.13 calls per presentation moved
from sacrificing Cankerbloom 3/3 to passing 3/3; Sunfall probability fell from 15–16% to 3–4%.
This is a small offline presentation check, not a deck-performance result. Both extreme b226
hands were still kept 3/3 under either presentation, motivating deterministic opening policy
rather than another wording-only fix. A native regression verifies the actual London sequence
of kept-hand sizes 7, 7, 6, 5, 4 and the final logged policy keep.

**Not solved:** the reconstructed Marath mode still preferred returning counters to itself over
making a token (3/3 old and new); Commune still chose X=0 (3/3 each), including when the exile
count was shown. Its X=0 fork builds more immediate mana, whereas larger X retains cards in
exile for the following turn, beyond the evaluation horizon. Fetch colour selection, conditional
engine assembly and longer-range strategy remain model limitations. Fresh current-list guides
were supplied to these games, so stale example guides are not their cause; the example guides
must not be assumed to describe later ManaBox edits. No deck or provider/model changes were made.

Verification: 118 tests passed in an isolated HOME/socket, including native London ordering;
the final model-only suite passed 28 tests after the additional impulse-outcome and captured-hand regressions.
Shared goldfish and table servers were not restarted by this repair.

## Interactive table latency — 2026-11-22

Read-only investigation of the live four-player bridge game (parents g260–g262). No live pilot, game state, or mode was changed. Across the observed parent fork records there were zero stalled-fork failures; six earlier failures were Tempt with Discovery replay drift. One TimeoutException in the accumulated table log belonged to the previous evening, not this game. A recent 97-fork snapshot had a median file lifetime of 12.31s and maximum 50.38s (filesystem birth-to-modification times, not pure compute timings). The current Marath board was the outlier: its 282 observed fork files summed to about 1,228s, versus about 80s for 395 Atraxa forks and 66s for 194 other-Marath forks. Parallel work means these sums are not game wall time. A live JVM sample caught a fork inside Forge combat prediction and mana-source evaluation.

The table pilot unconditionally uses outcomes mode, evaluating candidate continuations through the next turn before requesting a Jev pick. Every eligible response/activation can repeat that work; there is a per-engine-wait timeout, but no overall decision wall-time budget. Thus a succession of successful slow simulations can stall the visible board for minutes without recording a timeout. Three independent current-provider probes with retries disabled succeeded in 0.96s, 0.47s, and 0.59s. These are small prompts, not proof that historical real-game calls never retried. Those retries were not separately counted. Added api_retries, api_timeouts, and api_wall_seconds telemetry to close that gap for newly loaded pilots, plus a browser bridge diagnostics endpoint. Do not restart a human game just to load diagnostics.

## The physical table's frame — 2026-11-25

The render bench (`game/client` workbench, `workbench.html?only=render`) on the design pass's turn-15 table (91 cards
drawn, four seats), 1180 x 820 at 2x, each frame drawn and finished on the GPU (one pixel read back), 240 frames a
moment after a warm-up; WebKit headless on an Apple M4 Mac (Playwright). Not the iPad: the bench sends its results from
there (Send to Mac) and those numbers decide.

| Moment | Frame median / p90 / worst (ms) | Draw calls | Shadow map redrawn |
|---|---|---|---|
| At rest | 11 / 13 / 14 | 68 | never |
| Highlight (6 cards out of the light, 0.3 scrim) | 15 / 16 / 19 | 73 | never |
| A creature flying to the graveyard and back | 12 / 13 / 16 | 77 | every frame in flight |

Every frame held the display's 60 fps pace (a 17 ms interval). Cards draw in 2 to 3 instanced batches (32 faces an atlas
page) and the contact shades and pools in 4 to 6, against 700 to 1200 calls for the render study's per-mesh build; the
count includes every pass (shadows when drawn, the table, the focus, bloom, output). In headless Chromium the CPU's share
was negligible: the frame waits on the GPU. A highlight costs about 3 ms over rest whatever its dim, the focus pass's
second render into the multisampled target (the stack's focus already drew so). WebKit's clock is 1 ms, so medians are
rounded; the means were 11.2, 14.8 and 11.8 ms.

The same table at rest with one post-processing setting changed (a second run, so the baseline moved to 12.8 ms mean):
the composer at 1.0x, 10.6 ms; at 1.5x (the policy's), 12.3; bloom off, 11.6 (55 calls); MSAA off, 11.5; all three,
9.2. On the M4 none of them dominates: the lit table itself is most of the frame. The iPad's run decides.

On iPad Safari after PR #14 and the sprite glow change, the bench's fixed 1180 × 820 viewport at DPR 2 measured
10/12 ms at rest, 11/12 in a highlight and 11/12 in flight (median/p90), with 55, 60 and 64 draw calls respectively.
The earlier baseline recorded 13/14, 16/18 and 13/17 ms (median/worst). Rest variants (median/p90) were 9/10 at 1.0×,
10/12 at 1.5×, 9/11 at 1.5× without MSAA, 8/10 at 1.0× without MSAA, and 12/13 at native DPR with MSAA.
The highlight at 1.5× with MSAA measured 13/15 ms.

On the Mac, paired WebKit runs used the same turn-15 fixture at 1180 × 820 and 2×, with 240 timed frames per moment.

| Moment | Before median / p90 / worst (ms) | After median / p90 / worst (ms) | Draw calls before → after |
|---|---|---|---|
| Rest | 12 / 13 / 15 | 11 / 13 / 14 | 68 → 55 |
| Highlight | 14 / 15 / 16 | 12 / 14 / 15 | 73 → 60 |
| Flight | 12 / 13 / 15 | 12 / 13 / 15 | 77 → 64 |

## planTable with every opponent's leaf on the engine — 2026-11-26

`game/tools/bench-plan.mjs` (Node 24, the inputs planned at the iPad held in landscape, 1210 × 834; a loaded Mac, load
average about 18, so worst cases are noisy), median / p90 / worst ms per `planTable`, as the app plans:

| Input | This baseline | Main (back to back, the same viewport) |
|---|---|---|
| The design pass's turn 15 | 0.99 / 1.22 / 2.16 | 0.89 / 1.07 / 1.65 |
| Dense (four seats, 40 permanents each, a stack of four) | 1.43 / 1.60 / 2.07 | 1.28 / 1.50 / 3.29 |
| 40 distinct names | 0.76 / 0.81 / 1.12 | 0.70 / 0.82 / 1.18 |
| A combat of twelve | 0.79 / 0.91 / 1.32 | 0.74 / 0.86 / 1.37 |
| 30 snapshots in sequence | 1.67 / 2.56 / 5.53 | 0.85 / 1.01 / 1.46 |

A snapshot that changes one seat rebuilds that seat's leaf only (the others are kept by their whole input; a test holds
it). The sequence's generator changes every seat in nearly every snapshot (in 29 snapshot pairs the left and across
seats change 29 times, the right 28), so it rebuilds three leaves a plan, where main rebuilt one; a leaf rebuilt from
scratch costs about 0.3 ms. No timing gate runs in CI (shared runners and a loaded Mac make wall-clock gates flaky). The
iPad's run (`workbench.html?only=bench`, held in landscape, "Send to Mac") decides the 8 ms budget.

The iPad (Chrome on iPadOS, held in landscape, build 6acb81f), median / p90 / worst ms per `planTable`:

| Input | As the app plans | Every engine leaf changed each plan | `mat` alone |
|---|---|---|---|
| The design pass's turn 15 | 6 / 8 / 9 | 10 / 13 / 13 | 6 / 8 / 9 |
| Dense | 8 / 11 / 11 | 13 / 15 / 16 | 7 / 8 / 9 |
| 40 distinct names | 6 / 8 / 8 | 9 / 11 / 12 | 6 / 7 / 8 |
| A combat of twelve | 6 / 8 / 9 | 10 / 12 / 13 | 6 / 8 / 9 |
| 30 snapshots in sequence | 11 / 13 / 14 | 11 / 13 / 14 | 7 / 9 / 11 |

Against the last gate run (Nov 25: dense 7 / 9, the combat of twelve 92 / 98), the combat is 15 times faster and the
dense board about 2 ms slower at worst; both still miss the 8 ms worst case by 1 to 3 ms, as `mat` alone does (9).
Most of a plan is still `mat` (my side and the rest), which steps 9 and 12 replace. Planning runs on a snapshot, not
on every frame, so a miss costs one late frame on that snapshot.

## planTable with my side on the engine — 2026-11-26

`game/tools/bench-plan.mjs`, Node 24, the inputs planned at 1210 × 834, 200 plans each, median / p90 / worst ms per
`planTable` as the app plans; main and this branch back to back on the Mac (load average 4 to 5):

| Input | Main (my side on `mat`) | My side on the engine | And the speedups |
|---|---|---|---|
| The design pass's turn 15 | 0.92 / 1.16 / 5.64 | 0.88 / 1.18 / 2.57 | 0.59 / 0.69 / 1.47 |
| Dense | 1.50 / 1.73 / 2.78 | 1.34 / 1.48 / 1.95 | 0.62 / 0.68 / 1.70 |
| 40 distinct names | 0.77 / 0.82 / 1.18 | 0.72 / 0.75 / 1.36 | 0.44 / 0.46 / 1.35 |
| A combat of twelve | 0.82 / 0.88 / 1.32 | 0.64 / 0.68 / 1.52 | 0.51 / 0.64 / 1.82 |
| 30 snapshots in sequence | 1.66 / 2.52 / 5.46 | 1.89 / 3.16 / 6.12 | 1.63 / 2.42 / 5.44 |

Moving my side off `mat` saved a little; most of a dense plan was the stack's focus searching for room (a third of it:
it sorted every 12 px grid point of the screen and rebuilt its box at each) and the table's audit. The speedups change
no plan: the search scans once for the nearest point that fits, `bounds` lost its `map` and spread, the rev formats by
integer rounding. Node's worst cases are single garbage-collection outliers. Each sequence snapshot changes every
seat, so it arranges four containers a plan (a real snapshot usually changes one).

On the iPad, earlier runs went 6 to 9 times Node's p90 (its clock is 1 ms, so its worst is about its p90): the dense
board should come to about 4 to 6 ms worst and the combat of twelve about 5 to 6, under the 8 ms budget; the sequence
stays over it (about 13). The owner's run (`workbench.html?only=bench`, held in landscape) decides.

After the review (my mana lying in front of my field, mana by kind, zones on my nameplate), the same bench at load
average about 17, as the app plans: turn 15 0.61 / 1.12 / 2.83; dense 0.84 / 0.93 / 1.31; 40 distinct names 0.45 /
0.47 / 0.98; the combat of twelve 0.49 / 0.52 / 1.31; the sequence 1.61 / 2.34 / 4.94. Within the noise of the run above.
