# The arrangement engine

One modular, responsive engine decides how cards are grouped, ordered and placed in space wherever the game client lays
out cards, with its rules swappable without touching the rest of the UI (the owner's decision of Nov 25: "given an
arbitrary container size, an arbitrary number of cards, and their states, it decides how to order them"). It sits
under the combined visual direction (the table rests, the Grimoire lifts what matters; "the visual spec" below), which
owns how everything looks; this page says where things are, which cards form a unit, what a tap on each does, which
facts each unit carries, and when something hidden matters.

Code: `game/client/src/layout/arrange/` (paths below are under `game/client/src/` unless they say otherwise). Read with
[the client's architecture](game-client-architecture.md) ("layout"), [the design goals](../game/tools/look/intent.md),
and today's layout code it replaces in steps (`layout/seat.ts`, `layout/plan.ts`, `layout/seat/{fit,fold,geometry,mat}.ts`,
`layout/focus.ts`, `layout/combat.ts`, `play/reach.ts`, `scene/stage/pick.ts`, `model/predicates.ts`).

**Status:** the first slice's steps 1 to 6 are built (§6.1), and steps 8 to 10 (§6.2): every opponent's leaf and my
side are drawn, tapped and audited through the engine on the no-middle template (two to four seats), the mats part for
duels and the stack, a fight is gathered as the clash or as duels (the combat part of step 11, brought forward), and
moments light the table in place. The focuses are still the old layout's. What building changed from this design, and
why, is in "Round 3" to "Round 8" below; where they differ, the code and those rounds win.

## Changes after review

### Round 1: Codex's review

Codex reviewed the first draft (verdict: revise before the full migration). Every
finding is taken; where I take it differently or disagree, it says so.

| # | Finding | Now |
|---|---|---|
| 1 | Finite space needs an overflow contract | §1.5: a container has a minimum usable region and a guaranteed entry (its plate); `arrange` returns a verified fit or a typed `Overflow` (who, why, what it asks for). Paging is explicit, offered cards come first in a choosing focus, and concurrent visibility has stated bounds (§1.5, now settled). Tests within bounds require no overflow; the last resort no longer excuses violations. |
| 2 | The facts cannot express the policies | §1.2: `controller`, an arrival sequence, combat edges (attacker → defender incl. planeswalkers and battles, ordered blockers), homes for cards away from their container. §2.1: explicit order keys and *formations* (linked columns, aligned pairs). Acting cards may share a formation in which each stays visible and pickable; they never fold into a face. Pages are input and output. |
| 3 | Reach is an interaction contract | §1.6: ordered pick targets with stable ids, regions, paint precedence, membership stamps for stale taps, and explicit actions (select, open a focus at a page, inspect, seat). Offered attachments get targets. Play's rules (`onTable`, `reached`) stay the arbiter, so game behaviour does not change. Interaction tests run through the real gesture-to-protocol path. |
| 4 | No progress bound, no shown 8 ms | §5.1: the ladder compiles to a finite canonical edit list on stable group ids, each edit consumed once; candidates, steps, growth and global rounds are bounded; the full audit runs on final candidates only. §7.3: a measurement plan on Node and on the iPad, with named inputs, recorded counts, and a gate. |
| 5 | Usable space is discarded | §5.2: a row holds disjoint intervals from swept projected envelopes against keepouts; occlusion is by depth from the eye; geometry on an orthonormal surface frame. "Fit" means the first admissible packing under the row heuristic, stated. Used bounds are returned. |
| 6 | Scale 1.85 checks three widths, not a layout | §4 remeasured: places, the far tapped card and the margins. The tapped far card is settled by giving a card its place as its target (§1.6, §4.3); capacity is measured (§4.4). A focus keeps the card mesh at table size and moves the frame nearer. |
| 7 | Determinism of a call ≠ stability of frames | §3: worst-case envelopes per slot; named structural moves; lineage rules; arrival sequence distinct from id; policy selection kept apart from policy memory; deadbands; one memory snapshot per plan. Tests for fixed points, jitter, resize in flight, settle cycles, nested partitions. |
| 8 | The adapter goes before its consumers | §6: the review's slice is adopted: one opponent leaf end to end (drawing, picking, audit, interaction) with Ready/Tapped and Works through the same renderer and gesture path; old seat views stay for every consumer not yet moved. |
| 9 | The boundary and audit need witnesses | §1.3 returns the frame, per-card frames, paint order, targets and caption bounds. §2.2 validates policy output with a defined rejection. §7.2: exact fan-strip and caption checks, and independent witnesses in recordings, proven by planted failures. |

Where I differ from the review:

- **Closed vocabularies are intended** (finding 9). `UnitFacts` and `CaptionKind` are a closed set on purpose: the
  owner asked for swappable *rules*; a new kind of words should pass narrative and the designer, not ride in with a
  policy. A policy needing one is a two-file change (narrative and metrics), stated as such.
- **Dressing stays out of a looked-at pile** (finding 3) unless a decision offers it.
- **The review's first slice is the right proof** (finding 8), adopted as is: two policies through one renderer,
  picker and audit on real decisions is exactly the owner's requirement; two containers at once would double the
  cutover without telling us more about swapping rules.

### Round 2: the visual spec and the owner's answers (Nov 25)

| Source | Decision | Where |
|---|---|---|
| Designer §7.1, owner | **Standing means "presented"**, whatever the type, assigned by the policy. Constraints, enforced by validation: a tapped card never stands; a noncreature mana source never stands; on my side every untapped creature and planeswalker stands unless folded; an acting card stands, out of any pile. | §2.2, §2.4–2.6 |
| Owner | **Posture never changes with the moment; light carries the answer.** `emphasis` is light only; postures, places and units are moment-invariant. (The designer's §7.1 "laid flat for down" is superseded; it is revising.) | §2.3 |
| Designer §7.2 | **No labels at rest.** Facts always travel with a unit; captions exist only inside a focus. Stacks carry a *count marker* (the dice, for now) placed on the surface in a reserved strip. | §1.3, §5.2 |
| Owner | **A nameplate container.** The seat's summary attaches to its plate as icons at rest; a tap opens the plate focus: the summary in words, and that seat's graveyard, exile, hand (opponents) and library. The read leaves the table. | §1.1, §2.8 |
| Owner | **Never hide relevant information.** A container reports every hidden card that matters (a threat, something that can hurt me, an offered or aimed card) on the unit that hides it, so the visual layer can cue "look here". | §1.3, §1.4 (10), §2.1 |
| Designer §7.3 | **Tapped**: a quarter turn in standing tiers (the slot a card's height wide), a notch elsewhere. The far quarter-turned card is reached through its place (§4.3). | §2.4, §4.3 |
| Designer §7.4 | **The gathering is a focus when I am in the combat**, at table size between opponents. | §2.8 |
| Owner | **No reserved empty middle at rest.** The composer makes room for combat or the stack by a table pose (a camera or mat shift). Rest arrangements are planned to hold under every pose, so a pose never refolds a board. | §1.1, §5.3 |
| Owner | **Re-sort**: front rows re-sort at the start of every turn, and at any phase change if the ranking changed past the margin; tapped turns in place and re-deals at its controller's untap. | §2.4, §3 |
| Owner | **One card size: yes**; the two-size fallback is gone. `S_table` = 1.85 at 1180×820, the designer's number, verified by the exact audit. | §4 |
| Owner | **A policy per seat from the battlefield only.** | §2.5 |
| Owner (a playtest bug) | **Classification follows each card's current types every plan.** Types are non-exclusive flags from the card's current type line; nothing caches a classification; a card whose types change moves at once (a stationed spacecraft to the creatures, an animated land, a crewed vehicle). | §1.2, §3, §7.1 |
| Owner | **No implementation-detail questions.** The far tapped card, visibility bounds, focus steps and side-leaf places are settled here. | §1.5, §4 |

### Round 3: the first slice as built (Nov 25)

The slice follows this design's intent; where building it, or the visual spec's revision (second round, the same day),
asked for something different, the code does the following. Sections below keep the original text.

| What | Built | Why |
|---|---|---|
| **Rows come from the space** (§1.1, §2.1, §5.2) | The engine assumes no number of rows or places. A policy's tiers say only how cards are presented (`TierSpec { id, posture, markers?, proud? }`); consecutive tiers of one posture form a **band**, laid from the anchor edge in the policy's order, and each band takes as many rows as its units need and the space allows, keeping room for the first row of every later band that holds something. A row exists only where its cards meet their floor (checked across the row, so a turned leaf's far end ends an interval) and its far edge is on screen. A standing band's rows are grids of places, the nearest row first, each centre-out; a lying band packs its units in tier order. A place is band-relative (`SlotRef.row` is the row within its band). | Owner, Nov 25: seats come and go during a game, so containers change size; "two standing rows per leaf" is an outcome at turn 15, not a rule. `space.test.ts` varies leaf sizes, depths, viewports and one to six seats, with memory carried as seats change. |
| **The turn horizon** | Measured, not assigned: a standing row is inside it while a card lying a quarter turn there reads at least 40 px deep (design px). Inside, tapped is a quarter turn and a place is a card's height wide; past it, a notch and a notched card's width. The across leaf's front row reads 43, the row behind it 36, at every supported viewport. | The visual spec's horizon (its §7.3), as geometry. |
| **The leaf** (§2.4, §4.4) | The visual spec's revised leaf: standing rows, a lying band (rest, works, lands in that order) and a **far strip** (library, graveyard, exile, the waiting commander; a frame keepout, the builder's). Plates are chrome at the top of the screen over their leaf: a screen keepout 44 px tall, 330 wide. The leaf reaches toward my creatures (its front row at z ≈ −3.9 across): `layout/arrange/leaf.ts` builds it from today's slot until the no-middle template (step 8) owns it. At turn 15 the across leaf comes out as the spec drew it: a front row of four (quarter turns), a second of four (notches), a lying row. | No reserved middle (owner). |
| **Policies** (§2.4, §2.5) | `ready-tapped`'s tiers: `ready` (stands), `rest`, `works`, `lands` (lie). `works` uses the same tiers and differs in who earns a standing place (engines compete with bodies by its weights), so a swap keeps the leaf's shape. | What both policies needed; no row counts in either. |
| **The ladder walk** (§5.1) | The edit list is compiled as designed, but an edit **runs only while the band it frees still overflows** the rows the space gives it (a fold that ran last plan needs a whole place to spare before it undoes); each edit is still considered once, in order, and an audit that finds a band crowded holds back one place there for the next walk. `demote` may send creatures and the rest to different tiers. Spent copies split as a sibling stack (`spend-split`). The last-resort summary sits at the anchor (the first band), so a container always has one target for everything. | A plain prefix would demote every standing group before any fan could run. |
| **Their well** | A group may start squared (`Group.squared`): their lands are one block from the first land, with a marker and well facts. `Group.copies` is `stacks` (may square into a block). | The visual spec's lands are one block, lit while any are open. |
| **Fans** | Two degrees per card about the top's foot-left corner, six edges shown; its slot is what it reaches across (`fanExtent`), and fans reserve a proud strip behind their row. | Six edges fit a notched card's slot. |
| **Current types** (§1.2, guarantee 11) | Classification is from current types every plan, as designed. When a card's tier changes, its **posture follows at once where it is** (it stands up or lies down in its place, as its own unit, `ArrUnit.retyped`), and it **moves rows at the next re-sort**, which the change itself triggers at the next phase change. A crewed Vehicle fights from where it stands and lies back down without travelling. Memory keeps the tier each card was seated by (`bases`), only for this; nothing caches a classification. | The visual spec's rule (its §5): the playtest bug was the card looking and lying like a work; its look and posture never wait. **A change from "moves the same plan"; flagged for the owner's eye.** |
| **Notable members** | A fan or summary reports up to two hidden members that matter (`ArrUnit.notable`, with a cue: act, threat, answer, news), by importance, for the scene to draw proud and lit. "News" (arrived since I last opened it) waits for the spread focus. | The visual spec's attention cue. |
| **Hidden** (§1.3, guarantee 10) | Every member of a fan but its top counts as hidden (spines are blank). Copies under a stack's top are not cued for what they are (the top and the die say it), only when offered or aimed. | Visual spec §2, §4. |
| **Poses** (§5.3, guarantee 12) | A pose is the frame slid along its `away` (`FramePose { id, shift }`), the camera unchanged. The solver audits each pose only when asked (`ArrangeInput.auditPoses`: goldens, design measurements) and **reports** it (`report.poses`); it does not fold for a pose, so a plan the player sees does not pay for it. | Measured: parted by two card heights, the second standing row's creatures are 53 px (floor 56) and the lying row's patches go under the plates and off the screen's top at 1.85 (and at 1.95). No fold can fix that: the parting and the leaf's depth need to change, which is the template's and the designer's (step 8). |
| **Scale** (§4.2) | `S_table` stays 1.85. On the across leaf at rest the front row reads 63 px, the standing row behind it 58, the lying row 52 (floors 56, 56, 44); a third standing row would be under 56 with today's camera, so the space gives two. `tableScale` measures the floors exactly; my field's row is taken at z ≈ 1.5 until step 9 places it. | Measured in `test/layout/arrange/frame.test.ts` and the goldens. |
| **Floors** | A turned card's floor is measured on the same card unturned at the same place (as today's audit measures the upright face). | A quarter turn is not a smaller card. |
| **Targets** (§1.6) | A target's region is its slot's box on screen (the feet, a block's height, a standing card's top), widened to hold every corner. | A raised block's corners spread past the feet's line in perspective. |
| **Acting** | An acting card is presented, but a tapped one lies turned in its place (tapped never stands). The `away` mode and the gathering wait for their step. | The two constraints meet on a tapped attacker. |
| **Attachments** | Each attachment rides with its displayed root (an Aura on an Equipment on a creature rides with the creature); its immediate host stays on the card. An attachment that acts leaves its host as its own unit; an offered one is cued on its host, whose target opens the focus. | Review of the slice. |
| **Choosing from a block** (§1.6) | Only a block of copies is one target that selects; a block of distinct choices (a mixed well) opens its focus with them offered. For every decision, a tap or drag on a group commits only when what it does cannot hang on which card was meant: every member's gesture alone does the same (the action ignores that end), or the members it could mean are twins (all the client knows of each card but its identity is equal, what is attached compared the same way however deep, and so are its options) and the kind's reading of the group does the same whichever twin the group lists first. Not "each twin alone does the same": a second tap on a well of Mountains pays with the next one, where the picked one alone would be taken back. Otherwise the group's sift opens, nothing is committed, auto-pass holds, and the gesture (both ends) completes with the card chosen; a card refused there keeps it waiting, and one that has left the group is refused, as is any card chosen in a chooser that is gone (each chooser has a revision its taps carry); the sift and the gesture go together (a new decision, Escape, the group gone, a snapshot that moves one of its cards). Its cards are keyboard controls named with what sets each apart (model `asides`), and a payment's List offers every source's every option without the table (`play/resolve.ts`, `app/update.ts` `choosing`). | Review: one Forest target could never choose the Island under it. |
| **Re-sort and choice timing** | A phase change is measured from the phase the last plan saw (`PolicyMemory.seen`), not the last re-sort's; the policy choice `policyFor` made is what memory keeps (`ArrangeInput.selection`), so it holds all turn. | Review: a card crewed mid-phase moved at once; a choice could switch mid-turn. |
| **Lineage** (§3) | A vanished unit's id goes first to the part holding its old top, then by overlap and arrival, never by key order. | Review. |
| **What is kept between plans** (§7.3's remedies) | `arrange` is kept by its whole input (`memo.ts`: a hash of every field, memory hashed once per memory object), so a container whose input is unchanged costs its key; rows are kept per container geometry, audits per drawn arrangement. All are pure memoization: a kept answer is the one computing it gives, and a test holds it. The walk reuses units and layouts until an edit runs, and moves groups out of an overflowing standing band in one batch (a test shows it changes nothing). | The iPad's first numbers (§7.3). |
| **Interfaces** | `Policy.tidy` is a function of the clock, the turn and phase the last plan saw and whether the ranking changed; `Policy.seat` takes no moment; `order` and `formation` wait for the containers that need them. `Container` adds `safe` and `floors.tapPx`; `Row` adds `quarter`; `Arrangement` adds `policy` and `report.{policyInvalid, violations, poses}`; `PolicyMemory` adds `bases`, `held` and `folds`. An overflow of actors names every card no place could hold. | What the slice used. |

### Round 4: the across leaf drawn, and the gathering (Nov 25)

| What | Built | Why |
|---|---|---|
| **Step 6 as an adapter** | The arrangement becomes the across seat's plan (`layout/arrange/adapter.ts`), so the scene, picking, the table's audit, the lean-in and the combat row read it unchanged. Each unit carries the engine's pose for its top card (its own axes, untapped, and its turn: 1 a quarter, 1/6 a notch, drawn by the renderer's tap turn) and its place as its hit quad at rest. Play reaches through those hit groups with its existing rules (a pile's tap opens today's sift or lean-in). The engine's memory rides in the layout memory; the table never refolds the engine's leaf. | One seam for every consumer, and the player-facing switch kept small. Not yet: posing every card from its `CardPlace` (a fan is drawn as today's pile; a stack's thickness is the renderer's: a lying unit rests on the page and its cards ride its block, and the engine layers at the scene's card thickness, `TH`), the count markers (dice), captions and the spread. |
| **The far strip** | Plate, zone piles and the waiting commander stand along the far strip's near edge; further back they leave the screen's top. A zone pile meets the floor as it is drawn (propped up, not flat) and stands clear of the one before by its width. | Plates as chrome on a rail (the visual spec) belong to the no-middle template (step 8). |
| **The gathering** (§2.8, step 11's combat part) | `layout/arrange/gathering.ts`: formations (an attacker with its blockers in front, between it and who it attacks), in the order the attackers stood on their page. When I am in the combat (fighting, or attacked: a planeswalker attacked is its controller's, so before the first block too) it is a focus on a plane carried toward the eye (the largest of steps 2 to 1.2 at which every formation fits one tier, then two; it stands at least 2.4 over the table), reached over everything but the plates, and audited apart from the table it covers, so it never triggers fold rounds. Otherwise, and between opponents, table size in the open middle, audited with the table, covering no page. One placement; what has no room fights from its page, audited and reached there: only what the gathering placed is raised. A fighter the leaf left in its entry summary comes out as its own unit when it has room. No paging yet. `mat`'s combat row stays for a table without the engine. | The iPad: `mat`'s row cost about 91 ms on the combat of twelve (14 full audits, six fold rounds). |
| **The stack at rest** | The engine's leaf reaches nearer than `mat`'s page, so the open middle is shorter: on the dense board three of the four stack cards have no room at rest (reached as the focus and through the sheet). The leaf's page now starts at its front row's feet, which keeps the top card clear. | A regression until the mats part for the stack (step 8). |

### Round 5: the clash (Nov 26)

The combat design (the owner's still of Atraxa's six attacking redone) replaces Round 4's gathering. The client's
architecture page ("layout", combat) states the result; what changed here and why:

| What | Built | Why |
|---|---|---|
| **One picture** | The gathering serves every table (`mat`'s combat row is gone). A clash stands fighters upright, ends above my field row, puts each blocker on its controller's side of its attacker (three rows when an attack splits between me and an opponent), and one tier only (steps 1.8 to 1.1, then "more"). | A still must say who fights whom, what is unblocked and how much; lying attackers, a covered field row and blockers beside attackers did not. |
| **The table form** | Before blocks, my attack and a fight between opponents move nothing: lanes, trunked per attacking seat and defender. A fight between opponents with a block raises the clash until duels in the parted middle are built (the pose of §5.3 is not). | The spec's build order: duels and the pose last. |
| **The calm ground** | Under the clash a soft panel of the page's tone covers its picture, over a light shade (0.24): nothing behind the fight shows through, and the table is not darkened. | The owner found a deep shade far too dark; the sketches' fragments behind the brands competed. |
| **Chrome marks** | Brands, clasps, plaques and tallies are HTML at the gathering's screen positions, not scene decals; no column strips. | Crisp figures at every size, and strips read as debug outlines. |

### Round 6: the side seats and the parting (step 8, Nov 26)

The combat spec's section 4 (the parting, computed) and its duels are built with the side leaves. What changed, and why:

| What | Built | Why |
|---|---|---|
| **One front line** | Every leaf is square to me (`leafFrame` ignores a slot's turn) with its front row's feet at z −3.9 (`TableTemplate.leaf`), so all three fronts stand on one line across the table. | Turned as `mat`'s slots are, a side leaf's back row reaches under its plate as the mats part, and its lying band lost half its places (Marath's turn 15 folded to a summary). Square, every leaf keeps two standing rows of four and a back row at 1180×820, 1210×834, 1024×768 and 1366×1024. |
| **Poses hold by construction** | A row exists only where its floors, its far edge on screen and its keepouts hold at rest and under every pose (`rows.ts`); `report.poses` still audits on request and is clean on the design pass. `posed` draws a decided arrangement again slid along its `away` (units, slots and memory the same). | Round 3 only reported the parted audit; guarantee 12 asks for it. |
| **The top stays clear** | Every leaf keeps clear of the chrome along the top (`reservations.ts` `topChrome`: the nameplates' row and 8 px under it, the log strip at its least), at rest and parted. The parting goes at most 0.15 card heights (`TableTemplate.part`), by 0.05. | The owner's "far-back cards gunk up a table": nothing may sit half under a plate or be cut at the screen's edge. Under that band a dense leaf keeps two standing rows and its back row only up to 0.15; at 0.35 it lost its second row. |
| **Graveyard and exile** | Off the leaves: the nameplate's focus holds them (its heading, "more" and each card picked up open the zone in full; the sift reads the zone from the model, pages, and serves a choice), and a card bound there flies to the plate. A waiting commander stands at table size behind the rows in use, as deep as keeps it wholly clear of the top chrome at rest and at the full parting; where none does, the nameplate's focus shows the command zone. | The far strip sat under the plates and off the top on the dense board. |
| **Duels** | The table form stands each blocked fight in a row across the middle at table size, leaning from the table as every table card does: the attacker (turned a quarter when tapped, so its place is a card's height wide), a clasp, its blockers; 6 px inside a duel, 18 between. The row's feet are 6 px over my field row's tops; the mats part by the least step at which nothing on a leaf under the row (feet, a stack's dice) reaches within 3 px of its top, the row sliding across the table to where it needs least. All or nothing: duels that do not fit raise the clash (`TablePlan.crowded`; set aside, everyone stays home). | The spec's rule, computed, with cards of the table (88 px tall leaning, 94 upright), which is what fits the 0.15 parting. Dice count, so the dense turn-15 board holds two duels, not the spec's estimate of seven; lighter boards hold more. On the table posture stays fact, so a tapped attacker is turned, not stood up as in the clash. |
| **The stack** | Set aside, the stack takes the whole parting. | On main, 13 of the corpus's tables left stack cards with no room at rest (Round 4's regression); parted, none does. |
| **Target regions** | A standing grid row's regions run up their slots' own edges (feet to the standing top) and tile; the `place` check asks that a region hold its face's middle and 85% of its area. | On a side leaf perspective skews a place, and widening each region to hold every corner made neighbours overlap by 38 px (a 40 px patch). |
| **Unit ids, chrome** | A table unit's id carries its seat (`u:frest@Marath`) unless it is a card's own; the chrome's plates keep their leaves' order; the log strip under the Game button narrows to keep clear of the cards under it, never under its heading. | Three leaves each had a `u:frest`; the plates' packing swapped two seats to clear a card, against spatial permanence; and the left leaf now reaches the top-left, where the strip at its widest covered its back row. |
| **Seats that leave** | The template is tuned for 1 to 4 seats: the near place is the camera's (the perspective, out or not), and fewer opponents share the width the three leaves span, equal slots in the seats' order; with none left the table is the near place alone. A seat out of the game is not laid out; its nameplate is a small grey chip ("Out") that opens its focus, and plates keep the seats' order. | The owner: seats leave mid-game, and the engine assumes almost nothing about seat count. |
| **Picking, the decision, the rev** | A tap reaches the topmost face under it before any wider place; a stack's place reaches over the count strip in front of it (its die). An attachment the decision offers is reached through its host: the host's group carries the solver's `open` target (host and attachment), whose chooser holds both. The app hands the planner the decision in hand and keys the plan on it. The plan's rev covers unit frames and turns, fixtures, faces, the stack at rest and as the focus, the gathering (tallies and column powers included) and the parting. A card bound for a graveyard or exile off the table flies to its owner's plate. | Review: a tap on a turned card in a back row reached its neighbour; a target prompt on an unchanged board reused the old plan; the stack's focus could move without a new rev. |
| **Lanes and aims** | Only an attack I am in draws a lane. A set-aside spell's aim at a card on an opponent's leaf runs level along the open middle to the target's own column, then up it. | A line across other seats' cards read as clutter and as a false link to them; between opponents the attackers' light, a duel's clasp and the defender's tally say who fights whom. |
| **Not built** | The leaves' timing (open 300 ms before the duels walk out, close 400 ms after): the scene eases a parting as any reflow. | |

### Round 7: my side (step 9, Nov 26)

| What | Built | Why |
|---|---|---|
| **Two tiers** | My field stands on the template's field line (`TableTemplate.mine.field`, its feet at z 0.8, where `mat`'s field stood: no middle held back at rest), the container's last band laid there (`Container.facing`); eleven places at 1210×834, 1180×820, 1024×768 and 1366×1024, faces over their floor (72). In front of it, from just over my nameplate, my mana lies in the space the hand and the prompt leave: they are keepouts by their shapes, not a band (the hand holds only the screen's left third), which gives three lying places at every supported viewport, where `main` put my mana. The parting slides my side toward me as it slides the leaves away (its one pose). §2.6's band of works, rocks and lands in front: only my mana lies there; my works share the field. | A first build treated the hand as a band across the screen and put everything in the field: turn 15 piled nine creatures while the space right of the hand stood bare. |
| **One centred block** | While my field has room its units are one block, centred: works at its left, what stands in its middle (dealt by rank at a re-sort, the heaviest in the middle; `TierSpec.from`: the side a tier keeps to). A newcomer joins its side of the block (what stands between the works and the mana, nearest the middle of what stands); where no free place keeps the order, the block's units take their places in order. A phase change re-sorts when a seated unit now outranks one dealt above it past the promotion margin. | A first build filled works and mana from the row's ends: an early board crowded the right and left the left half empty. |
| **The policy** (`mine`) | Tiers from my edge: my mana lying by kind (`rocks`, `lands` for utility lands, `basics` as one block per kind, `pool` for all of it), then `field`, `muster` and `works`, standing. Engines (a card that binds the table, counters, legendary, a planeswalker or battle: `works`'s rule) stand with the creatures, so a creature-light side needs no second policy. Ladder: stack copies; what my mana tier cannot hold lies in my field's free places at the block's right (`spill`), while the field has room (a demote with `ifRoom`: only where the band it goes to has room for it); fan rocks, then utility lands; only a mana tier still full gathers all my mana into one well (`Selector.gather`); fan works; stack creatures; the lightest that stand go to a muster, which fans (a demote into a tier of its own band is judged with that tier fanned), only when my field is full. | My mana says what it is: the wells sign themselves ("Island ×8 · 3 tapped", "Rocks 6 · 1 tapped", "Lands 6 · 2 tapped"; the one well "Lands 14 · + 6 rocks · 6 tapped"). |
| **Re-sort** | The owner's rule (the start of a turn; a phase change when the ranking or a card's types changed): §2.6's "order by arrival, no tidy" is superseded. Tapped cards turn in place. | The owner's decision binds both sides. |
| **Zones off the table** | My graveyard and exile and a commander waiting in the command zone are not drawn: my nameplate counts them (headstone, exile frame, crown); a tap on the graveyard or exile count opens that zone, a tap elsewhere on my plate means my commander (cast it) or the nameplate's focus; a card bound there flies to the plate. The page ends just behind my row. | Drawn at table size beside the hand they read as cards in play. |
| **Duels are fights between opponents** | A fight I am in, its clash set aside, stays home. | My cards in the middle at table size are under my floor. |
| **Card data arriving** | `ArrCard.provisional` (a face not catalogued yet, not a token): memory keeps no place for it, so once its data lands it is placed by what it is; when many cards' data lands at once (a table loading) the row is dealt afresh, as at a re-sort, judged by an explicit record of the cards placed on the snapshot's facts alone (`PolicyMemory.guessed`), consumed once. A unit that inherited a card's id carries its seat on the table (`tableUnitId`). | The first plans have only the snapshot's facts: a rock read as a work held the wrong side until a re-sort, and a loading row came out scattered. A pile on my side inherited the id of a card that had changed controller. |
| **Regions** | A grid place's count strip extends the place's own edges down (`draw.ts`). | A spent stack lying a quarter turn in my row fell out of a region whose sides ran from the strip's corners. |
| **Offered and usable** | While I choose, the groups the decision offers are exempt from fans, the muster and the summary: they step out of my piles in place. All or nothing: where the row cannot hold them all (a payment offering every land), they fold as at rest and their pile opens with them lit. What a priority decision offers is usable, not offered: light and a cue on its pile, never moved, so my row holds still at every stop (a usable card inside a pile is a tap on the pile, then one on the card; a usable attachment is reached through its host, whose chooser holds it). What a decision offers may spill into my field's free places, before anything else does. | A payment from a pile took two taps a land; stepping some out but not others would need the walk to know free places ahead (left for step 10). With my mana tier full (three places), the mana a payment does not offer spills into my field's free places, so the offered stay out. |
| **Not built** | Named lands overlapped showing name strips (they lie singly, then pile as "Lands n"); the acting rank. | Step 10. |

### Round 8: moments (step 10, Nov 26)

| What | Built | Why |
|---|---|---|
| **Nothing rest shows moves** | The moment's cards (what a decision offers on my side, what the stack aims at anywhere) step out of piles only where every card rest shows (alone, on top, or in a block of its copies, the moment's own included) is still drawn where it was; only what rest hides under a pile's top or in a summary is ranked. They take whole free places after what rest shows, which keeps its centre, so a centred row needs a whole place free past its end; within a step they go after what goes back where it sat last plan. Round 7's all-or-nothing, and its offered-first that pushed what rest spilled into a pile, are gone. | The owner: the table does not rearrange for a moment. Offered-first gathered my mana into one well and hid the Island block; re-centring a row slid every pile half a place. |
| **The acting rank** | An order, not a row: which of the moment's cards take the free places (what rest hides among unlike cards first, then the policy's importance, then the oldest). The longest prefix that fits steps out, by halving (at most log₂ n + 2 attempts, only while a moment has such cards). The rest stay in their pile, lit and cued, which opens with them. | The row in front of a leaf's front exists only while a pose parts the mats, and a moment never parts them. |
| **Aimed** | What the stack aims at and does not fight is `Acting.aimed`, not `involved`: lit where it is. Guarantee 9 holds for fighters. | As an actor it took a standing card's place and pushed that card into a pile. |
| **Light** | `emphasis` reaches the scene (`Unit.light`, in the plan's rev): forward is warm lamp gold on the card's edge (a soft, still rim, under the ember) and a gold pool where it stands; down loses its pool and greys a little. Attackers between opponents are forward (they were null); the stack's targets are forward whatever decision is up. A unit hiding what answers the moment, a lone host's offered or aimed attachment included, carries a cue (`Unit.cue`: act, threat, answer) from its attention; what matters only at rest (a big creature, a card that binds me) is not cued yet. | A pool under a lying card drew over it: half-real. The rim is the ember's mechanism in the lamp's colour. |
| **News** | What another player puts onto the battlefield is news (the narrative's `arrived`, until the next arrive or the turn): the lamp's edge and a mote where it lands, on its pile or its host. | A card entering, seen after it lands. |
| **Targets through piles** | A target or card choice stays on the table when an option hides in a pile (play's `onTable`): the pile steps out in highlight mode with the options, and its tap asks which card (resolve.ts's rule), or, on a well of twins, picks its next option not yet picked (with every one picked, the last comes back off). The opened pile keeps each card's mark. List offers every option. | The owner: highlight mode for picking targets, on the table. Review: a second tap on a well took the first twin back. |
| **Highlight mode** | Dims: the stack 0.16 (was 0.3), choosing targets 0.12 (was 0.22). Not used for priority, payments or combat: those are light on the physical table. | The owner: much lighter than the render study's. |
| **The spill holds** | A demote into a standing tier takes first what sat there last plan. | My equal-weight lands swapped their spill places on every plan (step 9). |
| **Not built** | Offered cards on an opponent's leaf step out (they stay in their pile, lit); cues for what matters only at rest. | |

## 0. Shape of the thing

Three pure stages. Only the middle one is swappable.

```
 cards, relations ─┐
 moment, acting ───┤     ┌──────────┐  intent    ┌─────────────┐  candidate   ┌────────┐
 container ────────┼───▶ │  policy  │ ─────────▶ │   solver    │ ───────────▶ │ audit  │──▶ Fit | Overflow
 memory, page ─────┘     │ (rules)  │  groups,   │ (space)     │  rows, units │(limits)│    + memory
                         └──────────┘  order,    │ edit list,  │  targets     └────────┘
                          validated    formations│ bounded     │◀── next edit ────┘
                                       ladder,   └─────────────┘
                                       matters
```

- The **policy** decides what matters and how things may collapse: which cards may share a unit, explicit order where
  order means something, importance, tier, what is presented (stands), the fold ladder, what matters if hidden, and
  how a moment changes emphasis. It knows nothing about pixels or world units. Its output is validated before use.
- The **solver** decides how much fits where: rows in space with their usable intervals, the fold ladder compiled to
  a finite list of edits, slots, memory, hysteresis, pick targets, count markers and attention. It alone enforces the
  guarantees.
- The **audit** measures the final candidate as drawn and accepts it or sends the solver to its next edit. When the
  edits run out, the result is a typed overflow, never a silent pass.

The engine is called once per **container**: an opponent's leaf, my side, a seat's spread, a pile of mine, combat's
gathering. `planTable` composes containers into the table as it composes seats today. **Scope** (the owner, Nov 26): the
engine lays out the table's permanents. The hand fan and the plate focus's zone grids are chrome, not containers: the
corner hand fan is its own UI element, and the grids are flat lists of printed cards. They may share the engine's
ordering (offered first), not its layout or grouping.

## 1. The contract

### 1.1 The container (what the caller gives)

```ts
export type ContainerRole = "rest" | "spread" | "pile" | "gathering";

export interface Container {
  readonly id: ContainerId;                // "rest:<seat>", "spread:<seat>", "pile:<unit>", "gathering"
  readonly role: ContainerRole;
  readonly owner: SeatId | null;           // whose cards (null: mixed; the gathering reads `controller` per card)
  readonly viewer: SeatId;
  readonly frame: SurfaceFrame;            // where cards lie, in the world (orthonormal, signed)
  readonly projector: Projector;           // layout/projector.ts, unchanged
  readonly poses: readonly Projector[];    // every other table pose the frame must hold under (§5.3); [] in a focus
  readonly layer: Layer;                   // how big cards are (§4)
  readonly stand: { readonly lean: number };   // a presented card's lean from the frame's normal: 25° (designer §2)
  readonly floors: Floors;                 // design px: creature (mine 72, theirs 56), any 44; tap patch 44 CSS px
  readonly keepouts: readonly Keepout[];   // where no card, marker or caption may be: chrome on screen, fixtures on the frame
  readonly captions: CaptionRoom | null;   // null at rest: no words on the table (designer §7.2)
  readonly growth: { readonly d: readonly number[] } | "fixed";   // finite depths it may grow to, shallowest first
  readonly entry: EntryId;                 // the always-reachable way into this container's cards (§1.5)
  readonly paging: { readonly page: number } | null;
}

export type Layer =
  | { readonly kind: "table" }                                      // the mesh at S_table, on the table
  | { readonly kind: "nearer"; readonly steps: readonly number[] }  // the table brought nearer (spread, gathering, a pile of mine)
  | { readonly kind: "held"; readonly widthsPx: readonly number[] };// picked up: printed cards square to the screen (hand,
                                                                    // graveyard, exile, library, revealed) at ≥ 130 px

/** An orthonormal, right-handed frame. Rows run along `across`, laid from the anchor edge along `away`. */
export interface SurfaceFrame {
  readonly anchor: V3; readonly across: V3; readonly away: V3; readonly normal: V3;
  readonly w: number; readonly d: number;
}
export type Keepout =
  | { readonly on: "screen"; readonly rect: Rect; readonly kind: "hand" | "prompt" | "rail" | "stack" | "other" }
  | { readonly on: "frame"; readonly u0: number; readonly u1: number; readonly v0: number; readonly v1: number;
      readonly kind: "plate" | "zones" | "commander" | "other" };
export interface CaptionRoom {           // a focus's group captions (designer §7.2), CSS px, never scaled down
  readonly linePx: 24; readonly typePx: 16; readonly minWidthPx: 88; readonly attach: "above-far-left";
  readonly summaryMinWidthPx: 120;
}
```

**Preconditions** (checked by `arrange`, which returns `Overflow { reason: "container" }` if broken): the frame holds
at least one tap patch at its anchor, inside the safe area and off keepouts; the entry is reachable. A builder that
cannot meet them does not create the container and routes its cards through the entry.

| Container | Frame | Layer | Growth | Entry | Typical keepouts |
|---|---|---|---|---|---|
| An opponent's leaf | its slot (the template's; no reserved middle) | table | fixed | its plate | the rail and the plate (screen) |
| My side | my slot | table | to its slot, in steps | my plate | hand and prompt (screen) |
| A seat's spread | the leaf's frame, brought nearer as a sheet | nearer | down to the hand's top, in steps | the seat's plate | the rail |
| A pile of my own permanents | a small sheet brought nearer | nearer | fixed, pages | the pile | the rail |
| Combat's gathering | the middle the combat pose opens (§5.3) | nearer when I am in it, else table | fixed, tiers then pages | the clash's caption | the rail, the stack's place |

Fixtures (plates, the commander beside its plate while in the command zone) stay the builder's. Zone piles at rest
are the designer's to place or drop now that the plate focus holds the zones; the engine sees them as keepouts if
they stay.

### 1.2 The cards, relations and acting (what the engine may read)

```ts
export interface ArrCard {
  readonly id: CardId;
  readonly controller: SeatId; readonly owner: SeatId;
  readonly name: string; readonly cardKey: string;
  readonly lookKey: string;              // identical to the eye but for tapped and summoning sick
  readonly types: TypeSet;               // the card's CURRENT types, non-exclusive (below)
  readonly subtypes: readonly string[];  // current subtypes (Vehicle, Spacecraft, Equipment, Aura...)
  readonly supertypes: { readonly legendary: boolean; readonly basic: boolean };
  readonly token: boolean; readonly commander: boolean; readonly copy: boolean; readonly faceDown: boolean;
  readonly manaSource: boolean;          // it makes mana (current abilities, the model's `produces`)
  readonly tapped: boolean; readonly sick: boolean;
  readonly power: number | null; readonly toughness: number | null; readonly loyalty: number | null;
  readonly defense: number | null;       // a battle's
  readonly keywords: readonly string[];
  readonly counters: number;
  readonly attachedTo: CardId | null;
  readonly reach: "table" | "self";      // its text binds other players (by-relevance's `tableReach`)
  readonly manaValue: number;
  readonly produces: readonly string[];
}
export interface TypeSet {
  readonly creature: boolean; readonly land: boolean; readonly artifact: boolean; readonly enchantment: boolean;
  readonly planeswalker: boolean; readonly battle: boolean;
}
```

**Classification follows the card's current types, every plan.** This is part of the contract, because a playtest
showed a stationed spacecraft (a creature now) left among the artifacts:

- `types` and `subtypes` come from the card's current type line as the engine reports it (`Card.face.type`, "the
  engine's, which is what it is now"), never from the catalog's printed line, and are rebuilt from the model on every
  plan. A face-down card is a 2/2 creature with no other types, as the engine says.
- The flags are **non-exclusive**: an animated Mutavault is `creature` and `land`; Dryad Arbor always both; an
  artifact creature both. Today's `isCreature` (`!isLand && /Creature/`, "a land that is also a creature is a land")
  is not used by the engine; it reads the flags, and policies decide precedence (§2.4: a card that is a creature
  ranks as a creature first).
- Nothing in memory stores a classification. Memory holds places by unit and group keys; groups, tiers and postures
  are recomputed from current facts every plan. A card whose tier changes moves at once, as a `retype` move (§3):
  a Vehicle crewed joins the creatures and goes back at end of turn; a stationed Spacecraft that becomes a creature
  moves to the creatures; a land that stops being a creature returns to the lands.
- `lookKey` includes the types, so a crewed Vehicle never stacks with an uncrewed copy.

```ts
export interface Relations {
  readonly combat: {                      // the engine's, or play's draft over it (today's CombatPairs, kept whole)
    readonly attacks: readonly { readonly attacker: CardId; readonly defender: { seat: SeatId } | { card: CardId } }[];
    readonly blocks: readonly { readonly blocker: CardId; readonly attacker: CardId }[];   // the engine's order
    readonly wasBlocked: readonly CardId[];
  } | null;
  readonly homes: ReadonlyMap<CardId, { readonly container: ContainerId; readonly unit: UnitId; readonly slot: SlotRef }>;
}
export interface Acting {
  readonly involved: ReadonlySet<CardId>;   // acting now: fighting, aimed at; they leave their units and stand
  readonly offered: ReadonlySet<CardId>;    // options of the decision up (play's refs, as ids)
  readonly usable: ReadonlySet<CardId>;     // mine with something I could use while I hold priority (the ember)
  readonly choosing: boolean;
}
```

Every `ArrCard` field is a fact the model has or a presentation predicate in `model/predicates.ts`; none decides what
is legal. **Arrival order is not the card id**: a permanent that changes controller, or a card a container first
sees after a reset, arrives now; the container's memory keeps the sequence (§3).

The **moment** is by-relevance's `Question` in `layout/moment.ts` (`rest`, `threat`, `strike`, `fight`, `aim`,
`stack`, `sweep`, `momentOf`, `momentKey`); its `fight` carries the same edges as `Relations.combat`.

```ts
export function arrange(input: ArrangeInput): ArrangeResult;
export interface ArrangeInput {
  readonly container: Container;
  readonly cards: readonly ArrCard[];     // any order: the output never depends on it
  readonly relations: Relations;
  readonly acting: Acting;
  readonly moment: Moment;
  readonly policy: Policy;
  readonly memory: ContainerMemory | null;
  readonly clock: { readonly turn: number; readonly phase: Phase; readonly active: SeatId | null;
                    readonly settling: boolean };
  readonly minEdit?: number;
}
export type ArrangeResult =
  | { readonly fit: Arrangement; readonly overflow: null }
  | { readonly fit: Arrangement; readonly overflow: Overflow };   // still drawable: what fits, plus what does not
```

### 1.3 The output

```ts
export interface Arrangement {
  readonly container: ContainerId;
  readonly frame: SurfaceFrame;                 // as used (grown, brought nearer)
  readonly step: number;                        // the layer's chosen step (1 at rest)
  readonly scale: number;                       // the card mesh's scale: S_table on the table and nearer (§4)
  readonly rows: readonly Row[];
  readonly units: readonly ArrUnit[];
  readonly paint: readonly PaintItem[];         // cards, markers and captions, in total paint order (back first)
  readonly targets: readonly PickTarget[];      // in pick precedence (§1.6)
  readonly home: ReadonlyMap<CardId, UnitId>;   // derived from units, never trusted (today's Ledger)
  readonly pages: { readonly count: number; readonly current: number; readonly offeredOn: readonly number[] } | null;
  readonly attention: readonly Attention[];     // hidden things that matter (below)
  readonly seat: SeatFacts | null;              // for the plate's icons and the plate focus's words (§2.8)
  readonly used: { readonly frame: Rect; readonly screen: Rect };
  readonly report: { readonly edits: readonly EditRecord[]; readonly candidates: number; readonly audits: number };
  readonly memory: ContainerMemory;
}

export interface Row {
  readonly tiers: readonly TierId[];
  readonly v: number;
  readonly posture: "stand" | "lie";
  readonly intervals: readonly { readonly lo: number; readonly hi: number }[];
  readonly places: number;
}

export type UnitKind = "card" | "fan" | "stack" | "summary" | "formation";

export interface ArrUnit {
  readonly id: UnitId;
  readonly lineage: readonly UnitId[];
  readonly kind: UnitKind;
  readonly tier: TierId;
  readonly slot: SlotRef;                   // { row, interval, place counted centre-out, envelope reserved }
  readonly members: readonly CardId[];      // in order; the first is on top (none for a summary)
  readonly top: CardId | null;
  readonly dressing: readonly CardId[];
  readonly cards: readonly CardPlace[];     // every card drawn
  readonly marker: { readonly count: number; readonly at: V3; readonly room: Quad } | null;   // a stack's count
  readonly facts: UnitFacts;                // always: what it holds, in the terms that matter
  readonly caption: { readonly kind: CaptionKind; readonly box: Quad } | null;   // in a focus only
  readonly emphasis: "forward" | "ease" | "down" | null;   // light only (§2.3)
  readonly lit: readonly CardId[];
  readonly acting: boolean;
}

export interface CardPlace {
  readonly card: CardId;
  readonly foot: V3; readonly right: V3; readonly up: V3;   // its face's frame: all the scene needs to pose it
  readonly posture: "stand" | "lie" | "held";
  readonly turn: "none" | "notch" | "quarter";               // tapped: a quarter in standing tiers, a notch elsewhere
  readonly layer: number;                                    // its height in a stack (0 the bottom), for thickness
  readonly quad: Quad;
}

export interface Attention {
  readonly unit: UnitId | EntryId;          // the unit hiding it (or the entry, past the last resort)
  readonly cards: readonly CardId[];        // what is hidden there
  readonly why: "threat" | "can-hurt-me" | "binds-me" | "offered" | "aimed" | "in-danger" | "answers";
}
```

Unit kinds: **card**; **fan** (unlike cards spread by hand; at rest from a corner, two degrees apart, top card whole;
in a band of my named lands, overlapped away from me showing name strips); **stack** (identical cards squared, one
face, real thickness, a count marker); **summary** (no face: the last resort, words in a caption); **formation**
(units placed as one figure: a blocked attacker with its blockers, a column of unblocked attackers; each member a
visible, pickable card).

**Facts, captions and markers.** Every unit carries `facts` (a closed tagged union: `stack {name, count, power}`,
`fan {count, power, keywords[], biggest, tapped, kinds}`, `well {lands, open, produces[], rocks}`, `summary`,
`formation {power, blocked, unblocked}`), whether or not anything is drawn. At rest nothing on the table is written:
`caption` is null, and the facts feed the plate's icons, the plate focus and the attention cues. In a focus each
group gets one caption box (designer §7.2: one line, at least 88 px, above the group's far-left corner, never wider
than the group), worded by narrative. A stack's **count marker** is a place on the surface at the stack's foot,
right-hand corner, toward the anchor edge, in the strip every stack row reserves (§5.2); the theme draws dice there
now ("copy counts only", owner) and may draw something else later.

**Attention: never hide what matters.** A card hidden from view (under a stack's top, inside a fan past its shown
edges, in a summary) that the policy's `matters` says matters produces an `Attention` on the unit hiding it. The
visual layer cues it ("there's more in here that matters, look", owner), as it cues activatable cards. Offered and
aimed cards hidden anywhere always produce one, whatever the policy.

### 1.4 Guarantees

The solver enforces these for every valid policy (§2.2 says what happens to an invalid one).

1. **Partition.** Every input card is in exactly one unit, as a member or as dressing.
2. **Reach.** Every card can be acted on by a bounded path: its own target; or one tap on its unit opening a focus
   that gives it one; or the entry, opening that focus at the page that holds it. Within the bounds of §1.5 an offered
   card is never reachable only through the entry.
3. **Floors.** Every face drawn at rest meets its floor; nothing shrinks to fit.
4. **Nothing covers what a card says**, as intent.md's limits; a unit's own members show exactly the strip the policy
   declared; captions and markers intersect nothing.
5. **One size** (§4).
6. **Stability** (§3). A moment never moves, turns or re-postures anything.
7. **Determinism.** Same input, same output; input order never matters; no clocks, no random.
8. **Nested folding.** Every unit at edit k+1 is a union of units at edit k.
9. **Acting cards stand with their faces**, out of any pile, each with its own target.
10. **Nothing that matters is hidden silently.** Every hidden card the policy says matters, and every hidden offered
    or aimed card, is named by an `Attention` on the unit or entry that hides it.
11. **Current types.** Every plan classifies every card from its current types; a type change moves the card the
    same plan.
12. **Poses.** A rest arrangement passes the audit under every pose in `container.poses`.
13. **Fit or overflow.** Within the bounds of §1.5 `arrange` returns a verified fit; past them, the best drawable
    candidate and an `Overflow` naming every card whose promise it broke. Never a silent violation.

### 1.5 Overflow, entries, paging and bounds

```ts
export interface Overflow {
  readonly reason: "container" | "actors" | "offered" | "page" | "space";
  readonly cards: readonly CardId[];
  readonly ask: { readonly kind: "region"; readonly minW: number; readonly minD: number }
             | { readonly kind: "focus"; readonly role: ContainerRole }
             | { readonly kind: "entry" };
}
```

- **The entry.** Every container has one, reachable at every viewport and under every focus: a leaf and my side have
  their plates (on the rail); a spread or pile has what opened it. When the last
  edit still leaves cards without a target, they are reached through the entry, which opens the container's focus at
  their page, and the result says so (`reason: "space"`, `ask: entry`), so tests tell it from a fit.
- **Paging.** Only focuses page: a spread (by rows, past its smallest step), a pile, the gathering (by tiers of formations). When a decision is choosing, offered members come first, so page 1
  holds them; `pages.offeredOn` lists any others and the pager says so.
- **Bounds** (settled; pinned by tests after the slice measures them):

| Where | Shown at once, each with its own target | Past it |
|---|---|---|
| A leaf at rest: acting cards standing out of piles | 5 (one rank of the leaf's width, §4.4), plus the front itself | `ask: focus "spread"`, opened with them lit |
| My side: offered cards stepping out of stacks and fans | the free places of their tier | the unit's target opens its pile focus, offered lit |
| The gathering | two tiers of formations at its smallest step (one tier of 7 pairs and 3 unblocked fits at 1.2×, designer §3) | pages by formation |
| A spread | its rows at its smallest step | pages by row |

### 1.6 Picking

The engine returns targets; play decides what a tap means for the decision up, with its existing rules.

```ts
export interface PickTarget {
  readonly id: TargetId;                 // the unit id, or "card:<id>" for a member's own
  readonly piece: PieceKey;              // the drawn piece it moves with (scene/stage/pick.ts carries it)
  readonly region: Quad;                 // where it is hit (below)
  readonly order: number;                // precedence: higher wins
  readonly members: readonly CardId[];   // the membership stamp: a tap whose stamp no longer matches does nothing
  readonly action:
    | { readonly select: CardId }
    | { readonly open: { readonly role: ContainerRole; readonly from: UnitId | EntryId; readonly page: number } }
    | { readonly inspect: CardId }
    | { readonly seat: SeatId };
}
```

- **A card's place is its target.** A target's region is its slot's reserved envelope on screen (the room the card
  owns in its row, whether it stands, lies or is turned in it), less anything painted over it. A tapped front card
  lying a quarter turn far off is reached through the place it would stand in, which nothing else uses (§4.3). The
  audit measures the 44 px patch on the region, not on the drawn face.
- **Precedence.** A fan member's own target sits over its fan's; paint order decides the rest. `hitTest` and
  `pickDrawn` pick the highest `order` whose region holds the point.
- **Stale taps.** The membership stamp keeps `reached`'s rule for every target.
- **In flight.** A target moves with its piece (`movedQuad`); a piece showing none of its cards is not pickable.
- **Stacks.** A stack's members are interchangeable: one target that selects, play choosing among them as now
  (designer §3: "a stack is one target"). A fan whose offered members are not interchangeable opens its focus with
  them lit. The answer sent is play's, unchanged.
- **Single cards.** A single card's target selects when a decision is up; at rest it inspects (designer: the inspector).
  A pile at rest opens the seat's spread (theirs) or its pile focus (mine).
- **Attachments.** An offered Aura or Equipment gets its own target where its tucked strip is a finger wide; otherwise
  its host's target opens a focus that includes it.
- **Fixtures**: plates over everything, as today; a plate's target opens the plate focus.

## 2. Rule sets: the policy

### 2.1 The interface

```ts
export interface Policy {
  readonly id: string;
  readonly tiers: readonly TierSpec[];
  group(cards: readonly ArrCard[], ctx: PolicyCtx): readonly Group[];
  importance(g: Group, ctx: PolicyCtx): number;          // at rest; never reads the moment
  order?(g: Group, ctx: PolicyCtx): OrderKey;
  formation?(gs: readonly Group[], ctx: PolicyCtx): readonly Formation[];
  tier(g: Group, ctx: PolicyCtx): TierId;
  presented(g: Group, ctx: PolicyCtx): boolean;          // stands; validated against §2.2's constraints
  top(g: Group, prevTop: CardId | null, ctx: PolicyCtx): CardId;
  readonly ladder: readonly FoldStep[];
  matters(c: ArrCard, moment: Moment, ctx: PolicyCtx): Attention["why"] | null;   // if hidden, cue it
  facts(u: DraftUnit, ctx: PolicyCtx): UnitFacts;
  seat?(units: readonly DraftUnit[], moment: Moment, ctx: PolicyCtx): SeatFacts; // a rest container's summary
  emphasis(u: DraftUnit, moment: Moment, ctx: PolicyCtx): { emphasis: Emphasis | null; lit: CardId[] };
  readonly acting: "in-place" | "away";
  readonly tidy: TidyRule;
  readonly promote: (incumbent: number, challenger: number) => boolean;
}

export interface TierSpec {
  readonly id: TierId;
  readonly posture: "stand" | "lie";            // a standing tier's tapped cards lie a quarter turn in their slots
  readonly rows: { readonly min: number; readonly max: number };
  readonly shares?: readonly TierId[];
  readonly order?: "fixed";                     // units in a fixed order across (the leaf's back: rest, works, lands)
  readonly capacity?: number;
  readonly markers?: boolean;                   // it may hold stacks: reserve the count strip
}
export interface Formation {
  readonly key: GroupKey;
  readonly parts: readonly { readonly group: GroupKey; readonly at: "far" | "near" | "after" }[];
}
export type FoldStep =
  | { readonly op: "split-spent"; readonly where: Selector; readonly to: TierId }   // spent copies leave their stack
  | { readonly op: "stack"; readonly where: Selector }
  | { readonly op: "fan"; readonly where: Selector; readonly show: number }
  | { readonly op: "demote"; readonly where: Selector; readonly to: TierId }        // to a later tier only
  | { readonly op: "summary"; readonly where: Selector };
```

`order` says what importance cannot: `handOrder`, the spread's order taken from the leaf's front, attackers left to
right by where they came from. `formation` expresses the clash's columns and pairs. A fan never has a number at rest;
"how many" lives in its facts, and attention says when something in it matters.

### 2.2 Validation

`validateIntent` runs before the solver: every card in exactly one group; every tier, top (a member), order key and
formation part known; every `demote` to a later tier; no step that can fold an acting group. And the designer's
posture constraints: no tapped card presented; no noncreature mana source presented; acting cards presented; on my
side every untapped creature and planeswalker presented unless its group folded. A rejected intent makes the
container fall back to `ready-tapped` for this plan and report `policy-invalid` (in tests it throws). Chaos tests use
legal random policies; invalid-policy tests are separate.

### 2.3 The moment changes light, never places or postures

`emphasis` and `lit` come after placement, from by-relevance's `stanceOf`: forward, ease, down or null. The visual
layer draws them as light (designer §4: pool brighter, light out), never as a posture change, per the owner. `matters`
may add `answers` attention (a card hidden in a fan that can block my fliers). Places, postures, units and members are
computed without the moment, and a test pins it. An acting card standing out of its pile is a membership change
(§2.7), not emphasis.

### 2.4 The starting policy: Ready / Tapped / Works / Lands

`ready-tapped`, shaped to the designer's leaf (§1 of the spec): a front of standing places, and a back of at most three
lying things in a fixed order. On a leaf the tiers map to rows; in a spread each tier gets its own rows and a caption.

| Tier | Holds | Posture | On a leaf | In a spread (caption) |
|---|---|---|---|---|
| `ready` | the commander (first place, whatever its types), then the highest-ranked groups that may stand: creatures, planeswalkers, battles, cards that bind the table | stand (tapped: a quarter turn in place) | the front: its places from the leaf's width (4 at 1180×820, §4.4) | "Ready · 26 · 71 power" |
| `rest` | every creature and walker group that did not earn a front place, and spent copies split from front stacks | lie | the back, first: one fan, most important on top, spent members a notch turned at its end | "Tapped · 7" holds the spent; the others join Ready |
| `works` | other nonland permanents | lie | the back, second: one fan, a planeswalker or a card that binds me on top | "Works 5" |
| `lands` | lands, rocks and mana tokens that are not creatures | lie | the back, third: one stack or fan (the well), facts include how many are open | "Lands 14 · 10 open" |

- **Classification precedence** (current types, every plan): a card that is a creature, planeswalker or battle now
  ranks as that first; then a noncreature mana source is `lands`; then any other nonland permanent is `works`. A
  crewed Vehicle or animated land is a creature this plan and goes to `ready` or `rest` by rank.
- **Groups.** The commander alone. A creature with dressing, a legendary creature, a planeswalker, a battle: alone.
  Other creatures by `lookKey` (copies), ready and spent copies kept apart (designer: two stacks). Works by `cardKey`.
  Lands, for theirs, one group (the well); for mine, one per `cardKey`. Auras and Equipment are dressing on their host.
- **Importance** (owner decision 1: most total power): a creature group's total power, doubled with a combat keyword;
  a planeswalker its loyalty plus 3; a battle its defence plus 2; a card that binds the table 3, plus 1 each for
  counters and legendary; lands 0. The commander is pinned, whatever its weight or types.
- **Top card.** The previous one while still a member; else the most important member; a well shows its most numerous
  basic.
- **Matters** (cued when hidden): a creature with power ≥ 4, or flying, deathtouch, trample, menace, double strike or
  infect; a planeswalker; a card that binds the table; anything with an aimed or offered member; under `strike`, a
  hidden untapped card that could block what I picked (by-relevance's `ready` and the flier rule); under `threat`, a
  hidden ready creature of the active seat.
- **Ladder** (only as far as needed, least important first; nothing runs on a board that fits):
  1. `split-spent` copies of a front stack to `rest`; 2. `stack` identical works and tokens; 3. `stack` identical
  creatures; 4. `fan` the `works` into one fan; 5. `demote` the lowest-ranked `ready` groups past the front's places to
  `rest` (incumbents kept by `promote`); 6. `fan` the `rest` into one fan; 7. `fan` the `lands` into the well;
  8. `summary` of all but the commander and acting cards.
- **Acting**: `in-place` at rest (the card stands out of its pile in its tier's free place, or in the acting rank in
  front of the front row: §4.4); `away` while the gathering is up.
- **Tidy** (owner): at the start of every turn, the front re-deals by rank; at every phase change, it re-deals if the
  ranking changed past the margin; never between declare attackers and end of combat. A card's tapped state settles
  where it lies until its controller's untap step, when spent copies rejoin their stacks.
- **Promotion**: `c >= i + 2 && c >= 1.25 * i`, at a tidy or on arrival.

### 2.5 A creature-light deck (`works`)

- **Tiers**: `engines` (presented: planeswalkers, battles, cards that bind the table, cards with counters, legendary
  noncreatures, the commander), `bodies` (presented: creatures), `static` (lie: other noncreatures), `lands` (lie).
- **Importance** for noncreatures: binds the table 4; a planeswalker its loyalty plus 3; counters 2; legendary 1; not
  a token 1; a third of its mana value. Creatures as `ready-tapped`.
- **Ladder**: split spent copies; stack identical tokens (Treasures to `lands`); fan `static`; stack `bodies`; demote
  the lowest `engines` into `static`; fan `bodies` into `rest`; summary.
- **Selection** (`policyFor`, from the battlefield only): `works` when creatures hold under a quarter of a seat's
  non-mana importance at a tidy; back to `ready-tapped` above 45%. The choice lives in `ContainerMemory.selection`,
  apart from either policy's memory.

### 2.6 My own side (`mine`)

The designer's shape: one row of standing creatures facing theirs, and one band of lying cards toward me. (As built, my
mana lies in front and my works share the field: Round 7.)

- **Order by arrival**; importance decides only who folds. No automatic tidy except my own untap (spent copies
  rejoin) and type changes.
- **Tiers**: `field` (presented: every untapped creature and planeswalker; tapped ones a quarter turn in place; 11
  places at 1180×820), `band` (lie, in fixed order: my works singly while they fit, my rocks as a fan, my named
  lands overlapped away from me showing name strips, my basics as stacks by kind, ready and spent stacks apart).
- **Ladder**: split spent copies; stack identical tokens; fan my works; past `field`'s places, the lightest
  creatures fan into a muster at the row's end; summary.
- **Offered** cards step out in place; where more of a unit is offered than can step out, its target opens my pile
  focus with them lit. **Usable** cards (the ember) are facts for light, never moved.

### 2.7 Acting cards

An acting card leaves its unit, stands, and never folds:

- `in-place`: a unit of its own in its tier's nearest free place, or in the leaf's acting rank (§4.4); the unit it
  left keeps its slot, id and other members, and its count marker drops by one.
- `away`: to another container (the gathering); its home slot stays reserved (`Relations.homes`).

Several acting copies may share a formation (a column of identical unblocked attackers): each a card with its own
target, one count marker for the column.

### 2.8 The other containers

- **Spread** (`spread`): the leaf's tiers, each in its own rows with a caption (Ready, Tapped, Works, Lands); order
  from the leaf's front, then arrival. Identical cards stay one stack with its marker; unlike cards are never fanned:
  a spread hides nothing. Steps nearer, then rows, then pages.
- **A pile of mine** (`pile`): its cards as a small sheet, singly, in the pile's order, offered first when choosing.
- **The plate focus and the hand** are chrome (see Scope). `SeatFacts`, the read of the combined spec's §6 (force,
  what is exceptional or absent, and per moment: what can come at me, what can block, the attack, a sweep's price),
  built from `facts` by by-relevance's `readOf`, still comes from here: the plate shows it as icons at rest and words in
  its focus.
- **The gathering** (`clash`): formations from `Relations.combat`: each blocked attacker a column (attacker behind,
  its blockers in front in the engine's order, rows far enough apart that a blocker's top never covers its attacker's
  foot); unblocked attackers by controller, defender and `lookKey` as columns standing apart, identical ones a stack
  with its marker. Order by where they came from. A focus when I am in the combat (the largest step at which every
  formation fits one tier, then a second tier, then pages); at table size between opponents. A blocker moved from one
  attacker to another is a different formation, so a different picture.

## 3. Stability and memory

```ts
export interface ContainerMemory {          // plain JSON, versioned
  readonly v: 2; readonly container: ContainerId;
  readonly selection: { readonly policy: string; readonly since: number };   // survives a policy switch
  readonly arrivals: { readonly next: number; readonly seq: Record<CardId, number> };
  readonly policies: Record<string, PolicyMemory>;   // each policy's own, so switching back restores places
}
export interface PolicyMemory {
  readonly step: number; readonly page: number;
  readonly slots: Record<UnitKey, { slot: SlotRef; reserved?: CardId[] }>;
  readonly lineage: Record<GroupKey, UnitId>;
  readonly tops: Record<UnitId, CardId>;
  readonly incumbents: Record<TierId, UnitKey[]>;
  readonly edits: number;
  readonly tidy: { readonly turn: number; readonly phase: Phase; readonly ranking: readonly UnitKey[] };
}
```

Memory holds places and keys, never classifications. It is an input snapshot: every candidate and retry of one plan
reads the same memory, and only the winning composition's memory is returned.

**Spatial permanence.** A place is (tier, row, interval, place counted centre-out). A unit keeps its place while it
lasts (today's `seatPlaces`, extended to intervals). A newcomer takes the first free place centre-out in its tier,
beside a copy of itself where one stands. A departure leaves a gap; gaps close at a tidy, or when the row must fold.

**Envelopes are reserved**, so state changes never push neighbours: a standing tier's slot is a card's height wide
(a quarter-turned card fits it); a lying tier's slot holds a notch; a fan's slot its spread at its shown edges; a
stack row its count strip. Tapping, a count going up, or a fan thickening never widens a slot.

**Structural moves**, each named in the diff with its cause, and the only ones there are:

| Move | When | What moves |
|---|---|---|
| `spend-split` | copies of a front stack tap | the spent copies, to the `rest` fan (or a sibling stack where the tier has a free place); back at their controller's untap |
| `retype` | a card's types change | that card, to its new tier, the same plan |
| `promote` | a tidy or an arrival outranks an incumbent past the margin | the challenger takes the incumbent's exact slot; the incumbent takes the first free slot of the tier it goes to |
| `fold` | an arrival, split or retype needs room | the groups the next edit selects, in place |
| `tidy` | the start of a turn; a phase change with a changed ranking | the front re-deals; gaps close |

**Lineage.** When a unit splits, the part holding the old top keeps the id; else the part holding most of its old
members; ties to the earliest arrival. When units merge, the merged unit takes the id of the part with most members.

**Deadbands.** A fold undoes only when the room is a whole slot more than the open form needs. A focus steps nearer
only when the content fits a whole step nearer. The policy selection holds between its thresholds. A phase-change
re-sort needs the ranking to change past the promotion margin. Comparisons hold acting, offered, viewport, pose,
focus and page fixed.

**What a small change may move** (tested):

| Change | What may move |
|---|---|
| A moment | nothing (light, lit, attention `answers`) |
| A single card taps or untaps | that card's turn, inside its slot |
| Copies of a stack tap | `spend-split` only |
| A card's types change | `retype` only (and a `fold` if its new tier is full) |
| An arrival, no fold needed | the newcomer, into a free place |
| An arrival needing a fold | `fold` only |
| A departure | its unit shrinks in place or goes, leaving a gap |
| A pose change | nothing on any board (§5.3) |
| A tidy | the front re-deals; gaps close |

**Diffs.** `diffArrangements(prev, next)` lists per card `from`/`to` (container, unit, slot) and a kind (`enter`,
`leave`, `move`, `join`, `split`, `refold`, `turn`, or a structural move with its cause). Units carry `lineage`, so a
merge animates as cards sliding onto the top and a split as cards coming out from under it. The scene keeps
reconciling by card and piece key; the diff gives it order (leaves, moves and splits, joins and enters).

## 4. Consistent scale

### 4.1 The rule

**A table card is one mesh size everywhere: `S_table`. Its size on screen follows only its distance and its
posture.** Nothing shrinks to fit; crowding overlaps (designer §2: distance, lying, overlap, nothing else).

- **Table.** Every card on the table at rest, mine and every opponent's, and the gathering between opponents.
  `S_table` depends on the template and the viewport class only, never on counts.
- **Nearer.** A spread, a pile of mine, the gathering I am in: the frame is carried toward the eye, so cards keep the
  mesh's size and read larger because they are nearer. Steps (apparent magnification): 1.2, 1.4, 1.6, 1.8, 2; the
  largest at which the first page fits; hysteresis per §3. Moving in or out animates distance, never scale.
- **Held.** A picked-up card is the printed card, square to the screen (hand, zones, the inspector, the stack's spell):
  a different object, sized in CSS px from a ladder (130, 160, 200, 250), never under 130 (designer §3), the
  largest at which the page fits. The crossing between the table face and the printed card is the designer's.

### 4.2 `S_table` (measured)

The audit measures face widths exactly (no margin), so `S_table` is the smallest 0.05 step at which every rest
container's first row meets its floor in the rest pose and every event pose. With main's camera at 1180×820:

| Where | Floor | On screen at 1.85 |
|---|---|---|
| My standing creatures (z ≈ 2–3) | 72 | 73–75 |
| A leaf's standing front (z ≈ −5.7) | 56 | 59–61 |
| A card lying in a leaf's back row (z ≈ −9) | 44 | 54 wide, 46 deep |

So `S_table` = 1.85, the designer's number. `floorScale`'s 1.09 width margin (which gives about 1.93–1.98) is a fitting
margin that the exact audit replaces; the slice measures the composed table at 1.85 and moves to 1.9 only if a floor
fails there. No creature stands on a leaf deeper than its floor allows (at 1.85, z ≈ −8); the back row is lying
things, whose floor is 44.

### 4.3 The far tapped card (settled)

A lone card lying a quarter turn is a card's width deep. At 1.85 that is 39 px at a leaf's front and 34 at its back,
under the 44 px tap patch; a 15° notch is not enough either. The designer wants the quarter turn in standing tiers, and
it is right: tapped is the most-read fact on the table.

Settled by §1.6's rule that **a card's place is its target**: a front slot is a card's height wide and a standing
card's height deep on screen (about 80 × 75 px on a leaf, standing at the 25° lean), reserved for that card whether it stands or lies turned in
it, and nothing else uses it. The target is that region, so the tapped card keeps the quarter turn and a patch well
over 44. In lying tiers a tapped single lies a notch in its slot, whose envelope (a card's width plus the notch's
corners) holds 44 at every leaf depth at 1.85 (46 px at the back). Fan members are reached through their fan.

The audit's `tap-patch` rule measures target regions, and a new `place` check asserts that every target region holds
its card's drawn face, so a region never strays from what it reaches.

### 4.4 Places (measured)

| Row | Slot | Places at 1.85, 1180×820 |
|---|---|---|
| A leaf's front (across, 8.3 wide; sides, 7.9) | a card's height, no gap between slots; 0.2 side margins | 4 on every leaf |
| A leaf's acting rank (in front of the front, opened by the event pose) | a card's width plus 0.1 | 5 |
| My `field` (22 wide) | a card's height, no gap | 11 |
| My `band` | a card's width (a notch's corners may cross the gap, where nothing is written) | measured in the slice |

With today's 0.35 side margins and a gap between slots, the side leaves hold only 3: the slice uses 0.2 margins and
abutting slots (turned neighbours meet along edges with nothing written on them). My works and lands grow from
1.2 and 1.05 to 1.85, 2.4× and 3.1× the area, so my band stacks and fans much sooner; that is the accepted cost of one
size (owner: yes). The slice measures fold frequency on the design pass's boards.

## 5. The solver

### 5.1 A bounded search

1. **Compile.** The ladder, applied to the groups, becomes a finite canonical edit list: per step in order, each
   selected group in ascending importance (ties by group key), as one edit on a stable group id. No-op edits are
   dropped at compile time; `demote` goes only to later tiers. Each edit is consumed once, in order, even when it makes
   the measured fit worse.
2. **Estimate cheaply.** Each group's envelope per row is computed once per plan and cached; a candidate is a prefix of
   edits, measured by sums over intervals. The solver walks forward from `max(memory.edits − hold, minEdit)` to the
   first prefix whose estimate fits: at most `E` estimates.
3. **Audit.** The full audit runs on that candidate under the container's projector and every pose; on failure, the
   next prefix, at most `A = 4` times; then the last edit once more; then the overflow of §1.5.
4. **Steps and growth** are outer loops over finite lists (≤ 5 steps, ≤ 7 depths), largest first, 2–3 tried at most.
5. **Composition.** `planTable` composes the containers and audits the table. Offenders fold one edit further in a
   stable order (seat order, then container id), at most `R = 3` rounds; then the entry route. Memory commits only
   from the winning composition.

### 5.2 Usable space

- **Frames.** `floorScale`, `clearBehind`, `bandSpan` and `clearOfHand` are rewritten over `SurfaceFrame`, with a
  presented card leaning `stand.lean` from the frame's normal (25°, under a die's fix) and no level-table assumption.
- **Rows** at finite depths laid from the anchor edge; growth is a finite list of depths.
- **Intervals.** A row's usable space is a set of disjoint intervals, found by sweeping its worst-case envelope (a
  card's height for a standing tier, a fan's spread, the count strip in front of a stack row: 0.3 of the card scale,
  designer §7.2) across the row and projecting it against every keepout. A middle keepout leaves two intervals, both
  used.
- **Occlusion by depth from the eye**, not laying order: a standing row hides what lies behind it from the eye,
  whichever was laid first.
- **"Fit" is the first admissible packing** under this heuristic, in the policy's order; not an optimal one, which
  would trade stability for a few slots.
- **Used bounds** are returned, and the composer reserves them.

### 5.3 Poses: no reserved middle

At rest the table reserves no empty middle (owner): the template gives the leaves and my side the whole table. When the
stack or a combat needs room, the composer moves the camera or the mats (a *pose*: a different projector, or frames
shifted along the table) and the gathering's or stack's frame is the room that opens. Boards do not refold for it:

- The template lists its poses (rest, stack, combat). Each rest container is built with `poses` = the others, and the
  solver audits its candidate under all of them, so every place holds its floor and patch whichever pose is up.
- A pose change replans no board; it re-projects targets and shapes only (the plan's `rev` changes, its units do not).
- The acting rank in front of a leaf's front exists only where the event pose gives it room; at rest, acting cards
  stand in their tier's free places.

Tuning the poses is the composer's and the designer's; the engine needs only the list.

## 6. How it fits today's code

### 6.1 The first slice: build order

Steps 1 to 6 are built (`layout/arrange/`): `contract.ts`, `card.ts` (step 1); `frame.ts`, `scale.ts`, `moment.ts`
(step 2); `solver.ts`, `rows.ts`, `draw.ts`, `audit.ts`, `validate.ts`, `leaf.ts` (step 3); `policies/` (step 4);
the shadow plan, now `leaves.ts` with `TableInput.engine` and `TablePlan.leaves` (every opponent's leaf), the goldens in
`test/layout/arrange/__goldens__/`, and the timings (step 5); `adapter.ts`, drawn when `engine.draw` is set, as the app
sets it (step 6, Round 4). The gathering
(`gathering.ts`) is step 11's combat part, brought forward. Step 7 (the swap proved on one board through the same
renderer) is covered by the policy tests and goldens; a debug switch to flip policies in the app is not built.

Keep the table composer, focus and navigation controllers. One opponent leaf (the across seat) goes end to end on the
engine, and both `ready-tapped` and `works` run on it through the same renderer and gesture path. The other seats
stay on `mat`. Two policies producing different groupings, orders and units through one renderer, picker and audit,
on real decisions, is exactly the owner's requirement, and one container keeps the cutover small enough to get the
interaction contract right before it multiplies.

1. **Types and classification.** `layout/arrange/contract.ts` (§1's types); `arrCard(model, id)` from current types
   (non-exclusive flags, subtypes, `lookKey` with types), with the classification tests of §7.1 first: a stationed
   Spacecraft, a crewed and uncrewed Vehicle, an animated land, Dryad Arbor, Gideon as a creature (the corpus case),
   a face-down card.
2. **Frame geometry and scale.** `frame.ts` (geometry over `SurfaceFrame`, the 25° lean), `scale.ts` (`S_table` by the
   exact audit, target regions), `moment.ts` (from by-relevance). Goldens: on the level table, today's geometry.
3. **The solver for a rest container.** Rows and intervals, the compiled edit list, slots and memory, envelopes,
   targets, count markers, facts, attention, overflow; `validate.ts`. Properties of §7.1 on hand-made boards.
4. **Two policies.** `ready-tapped` and `works`, and `policyFor` from the battlefield with its thresholds.
5. **Shadow plan.** `planTable` arranges the across leaf beside `mat` and records both (debug only). Goldens on the
   corpus and the design pass's beats; the Node bench and the iPad numbers (§7.3). The gate: no step past this one
   until the iPad numbers are recorded.
6. **Switch the across leaf.** A seat view becomes `{ kind: "plan"; plan } | { kind: "arranged"; arr }`; `planTable`
   builds shapes and hit groups from either; the scene poses cards from `CardPlace` (lean, quarter turn, notch, stack
   layers) and draws markers where the engine put them; play reaches through targets (an "opens" action routes to
   today's lean-in for that seat until the spread lands); the audit checks target regions and attention. Drawing,
   picking, audit and interaction switch together. The behaviour suite replays attack and block drafts, stack
   set-aside and reopen, and a hand decision.
7. **The policy swap, proved.** A creature-light seat on the across leaf runs `works`; a debug switch flips policies on
   one board; the same interaction tests pass under both.

### 6.2 After the slice

Each step keeps the old seat view for every consumer not yet moved, and passes the cutover checklist.

8. The side leaves; the template without a reserved middle and its poses (§5.3). Built (Round 6).
9. My side (`mine`), with the band measured. Built (Round 7): my field on its line, my mana lying in front of it.
10. Moments and acting on rest containers (light, in-place, the acting rank). Built (Round 8).
11. Focus containers one at a time: the gathering (`clash`, replacing `combatRow`; built with combat), the spread
    (replacing `leanOf`) and a pile of mine (replacing `siftOf` for my permanents, paging kept). The hand and the plate
    focus stay chrome (Scope, Nov 26).
12. Delete `mat`, `fit`, `fold`, `leanOf`, `combatRow` and the `plan` seat view; the architecture doc's layout section
    takes this contract, and intent.md's "visible count" limit follows whatever the owner settles on the designer's
    proposal (a pile that plainly holds more, opens in one tap, and cues what matters).

**Cutover checklist** (every step): fixtures and their pick priority; focus dismissal and restoration; the stack at
rest, its spill, ability entries and `hits.up`; aim lanes from the right pieces; home-to-gathering transfers and
return; hand tap, drag and return; `app/plan.ts`'s cache key extended with the policy selection, pose, focus, page,
offered and usable sets; the plan's `rev` covering card frames, markers, captions and targets.

### 6.3 What replaces what (end state)

| Today | Becomes |
|---|---|
| `SeatLayout` | gone; the swap point is `Policy` |
| `SeatInput.region`, `projector`, `reserve` | `Container` |
| `BoardCard`'s exclusive `creature`/`land` | `ArrCard.types`, non-exclusive, current |
| `seat/fit.ts` | the solver; `seatPlaces`, `seatGuest`, `holdFit` and the fighters-keep-their-pile logic reused |
| `seat/fold.ts` | `ready-tapped`'s ladder; `kindsOf` the default `top`; `holding` the facts recompute |
| `seat/geometry.ts` | `arrange/frame.ts`; band constants into tier specs; `pref` scales go |
| `planSeat`, `lastResort` | the bounded search; the entry route |
| `focus.ts` `leanOf`, `siftOf`; `combat.ts` `combatRow` | the spread, pile, plate and gathering containers |
| `HitGroups` | built from `PickTarget`s (its shape kept for play until play reads targets) |
| `Unit.title` and the branches' `note`, `times`, `countFirst`, `span`, `peers` | `facts`, captions in focuses, markers |

### 6.4 What the five branches give

- **under-a-die**: `Placement.lean` threaded through `frameOf`, `floorScale`, `clearBehind` (the planar fix);
  `Footprint`; `kinGroups`/`readyFirst` and ready-and-spent stacks; `fighterDrafts` for the clash's columns; the
  planar support fan; the dice as the theme's count marker. Not taken: trays, lips, stands, tally cards.
- **by-relevance**: `relevance.ts` (moment, stance, scores, `readOf`/`tagOf` as `SeatFacts` and attention's
  `answers`), `table-words.ts`; the tidy, frozen-in-a-fight and margin rules from `ranks.ts`; its `BoardCard` fields.
- **focus-first**: `rank.ts` as capped-tier incumbency; `front.ts`'s `lookKey`, regiment lineage and leaf structure;
  `LEAVES_4` until the no-middle template; `spread.ts` as the spread, its near-edge search as growth, its per-row px
  targets replaced by one size; `clashRow` as `clash`; the leaf-to-sheet id reuse as the cross-container unit id.
- **battle-lines**, **told-not-shown**: the Ready / Tapped / Works / Lands captions; the account facts in `SeatFacts`.

## 7. Tests

### 7.1 Properties and contract cases

Over boards from the seeded generator in `test/layout/boards.ts` (extended: tokens, copies, attachments,
creature-light, controller changes, type changes, 0–150 permanents), every container role, every registered policy and
seeded legal chaos policies, at 1180×820, 1366×1024 and 1024×768, under every pose:

1. Partition. 2. Reach: every card has a target or a bounded path; within bounds, every offered card has a target or
   is lit in a unit that opens on page 1 or a listed page. 3. Fit within bounds, overflow past them, naming exactly
   the cards. 4. One size: every table and nearer mesh at `S_table`; `S_table` the same for 1 card and 150.
5. Determinism and order independence; memory survives JSON. 6. Fixed point with the returned memory.
7. Moment invariance: places, postures, turns, units and members equal across moments.
8. Tap invariance: a single card's tap changes only its turn; copies tapping make only `spend-split`.
9. Locality per §3's table; jitter never flips (power around a margin, share around a threshold, room around an
   unfold, a ranking around a phase-change re-sort).
10. Nested folding. 11. Bounded search (≤ E + A + 1 per step and depth; ≤ R rounds).
12. Settling: places hold in flight and re-fit once after; resize in flight.
13. **Attention**: for every arrangement, every card that `matters` says matters and is not drawn as its own face, and
    every hidden offered or aimed card, is named by an `Attention`; and no `Attention` names a card drawn whole.
14. **Current types**: for random type changes (a creature losing the type, a land gaining it, a Vehicle crewed), the
    card's tier is the one its current types give, the same plan, and nothing else moves but `retype` and `fold`.
15. **Poses**: a rest arrangement's audit is clean under every pose; switching poses changes no unit.
16. **Posture constraints**: no tapped or noncreature mana source presented; acting cards presented; on my side every
    untapped creature and planeswalker presented unless folded.
17. Invalid policies (a separate suite): each malformed intent is rejected with the fallback.

Classification cases, named: a Spacecraft with station counters crossing its threshold (artifact → artifact
creature: moves from `works` to the creatures); a Vehicle crewed in combat and back at end of turn; Mutavault animated
and back; Dryad Arbor; Gideon Jura as a creature (the existing corpus test); an artifact creature; a face-down 2/2;
Opalescence turning an enchantment into a creature; a land that loses all types to Blood Moon (stays a land).

### 7.2 Witnesses, interaction and goldens

- **Exact checks** next to `shape.ts`'s sampled audit: a fan's shown edges and a member's declared strip by clipping
  against everything painted over them; captions and markers by exact intersection; target regions against the faces
  they reach.
- **Recorded witnesses.** The recorder and debug bridge emit per beat each card mesh's projected corners and its
  container's scale and step, each caption's overflow (`scrollWidth > clientWidth`), the pick owner at each target's
  centre, and each attention cue drawn. `tools/packet.js` checks scale drift (≤ 3%), hidden or overflowing captions,
  stolen picks and uncued attention. Packet fixtures with a wrong mesh scale, a hidden caption, a stolen pick and a
  missing cue must fail.
- **Interaction through the real path** (behaviour suite, gesture to protocol, asserting the exact answer or none):
  a tap on a fan and on its member; an offered Aura on another seat's creature; a tapped front card on a far leaf
  tapped through its place; an offered card on a focus's page 2; a tap during a split in flight; a stale tap; a
  blocker reassigned from one attacker to another.
- **Goldens** (kinds, members, slots, frames rounded, facts, markers, targets, attention), printed as a slot diff:
  the protocol corpus; the design pass's beats (Marath's board at turns 4, 9, 15; tokens; attack15; block15; counter;
  snipe15; wipe15) checked against the designer's tables in §1 of the spec; hand-written: empty; commander alone; one
  creature; 30 identical Elementals with 7 spent; the creature-light board under both policies; a mostly-artifacts
  board beside a middle keepout; 40 lands; six attachments on one creature; my side at 11 and 12 creatures; a legal
  target inside a stack of 9; a deathtouch creature at the bottom of a rest fan (attention); a sweep of 25; two
  regiments attacking, two blocked; the hand at 1, 7, 15; a graveyard of 3, 16 and 60.
- **Sequences**: a game's snapshots in order with memory carried (Marath turns 9 to 15; a wipe and the rebuild; a
  Spacecraft being stationed over three turns), each step's diff within §3's table.

### 7.3 The 8 ms budget: how it is verified

No solver exists to time yet, so this is a gate, not a claim.

- **Inputs** (fixed seeds, `tools/bench-plan.mjs` extended): the Marath turn-15 table; the dense board (four seats,
  40 permanents each, a stack of four); many unique groups (40 distinct names per seat); a combat of 12 fighters with
  the gathering up; 30 consecutive snapshots with memory carried and `settling` toggling; a pose change.
- **Recorded per input:** median, p90 and worst full `planTable` time; containers arranged; candidates estimated;
  audits run (counting poses); composition rounds.
- **Where:** Node in CI as a regression guard (fail on a median 25% over the recorded baseline); the target iPad by
  hand at each cutover, through a workbench page running the same inputs in Safari and reporting through the debug
  bridge. The budget is the iPad's: 8 ms worst case for the dense board and the combat.
- **Known costs and remedies, in order:** auditing under every pose multiplies audits (audit poses only on the final
  candidate, and only rows whose screen geometry a pose changes); the audit's per-shape filter and patch grid (a
  uniform grid index for `near`; patches only on final candidates); replanning every container on every snapshot
  (cache each container's arrangement by its input key, so a snapshot that changes one seat arranges one); cheap
  envelope estimates before any audit.
- **Gate:** the slice does not pass step 5 until its numbers are recorded on the iPad, and no later step merges over
  budget.

**How to run it.** Every input is planned at the iPad held in landscape, 1210×834 (`bench-inputs.ts` `VIEWPORT`). Node:
`node --no-warnings --experimental-transform-types game/tools/bench-plan.mjs [plans] [--json]`.
The iPad: on the Mac, `bin/deckmaster game` (it rebuilds the client when stale), then open
`http://<the Mac's address>:8765/next/workbench.html?only=bench`; or, without the game server, build the client
(`npx vite build` in `game/`) and run `node game/tools/serve.js 8797 --dist --lan`, which prints the address to open.
Wait for "Done" and press "Send to Mac": the results are kept as a file under `.deckmaster/bench/` and the page names
it. Over plain http a browser offers no clipboard, so the page also shows the results in a box with "Select all", and
Copy and Share only where the browser has them. The page times the same inputs and course as Node
(`scene/workbench/bench-inputs.ts`); Safari's clock is coarse (1 ms), so it also reports a batch mean.

**The iPad, first run (Nov 25)**, before the bench fixes below and the optimizations (ms per `planTable`, median /
worst; an iPad's browser at 834×1210 @2x, planned at 1180×820):

| Input | With the shadow leaf | `mat` only |
|---|---|---|
| The design pass's turn 15 | 30 / 33 | 18 / 20 |
| Dense | 30 / 32 | 18 / 20 |
| 40 distinct names | 28 / 30 | 16 / 18 |
| A combat of twelve | 145 / 149 | 132 / 136 |
| 30 snapshots in sequence | 30 / 34 | 18 / 22 |

The iPad ran 10 to 15 times slower than Node; one engine leaf added about 12 ms, and `mat` alone missed the budget.
(That page also replanned one-frame inputs without memory, where Node carried it; both now share one course.)

**Where the time went** (Node `--cpu-prof` on the named inputs). The engine leaf: the audit's tap patch, a cell grid
with a test per cell (31%); the parted pose's re-audit (18%); the walk re-laying every band on each estimate (17%);
drawing and placing (27%). `mat`'s combat row: its audit run in full on every candidate placement and fold round,
59% of the plan, the cell grid alone 44%.

**What changed**: an exact geometric patch check before any grid (the engine's audit and `mat`'s, where it changes no
plan); `arrange` kept by its whole input, rows per container geometry and audits per drawn arrangement; the walk's
reuse and batching; pose audits on request; card facts reusing their string parsing (Round 3). The engine per leaf, in
Node, alone, ms (the host was busy, load average 6 to 18: read these as upper bounds):

| Input | Unchanged leaf | A changed leaf (rows kept) | Cold (nothing kept) |
|---|---|---|---|
| The design pass's turn 15 | 0.02 | 0.24 | 0.40 |
| Dense | 0.02 | 0.22 | 0.37 |
| 40 distinct names | 0.02 | 0.20 | 0.35 |
| 30 snapshots in sequence | 0.29 (it changes) | 0.25 | 0.37 |

Down from about 1.4 for every plan. A snapshot usually changes one seat, so with four leaves the engine costs one
changed leaf plus three keys. `mat`'s combat-row input went from 8.2 to 5.0 ms in Node; what is left is `mat`'s own
search over placements (step 11 replaces it). The bench's "the leaf changed" column times the shadow leaf arranged
from scratch every plan. Whole `planTable`, Node (load average 10), median: the design pass's turn 15 0.99 with the
shadow leaf, 1.24 with it changed every plan, 0.73 `mat` alone; dense 0.87, 1.12, 0.76; the combat of twelve 4.96,
5.21, 4.62.

**After the optimizations, the iPad (Nov 25, build a8e4819)**, median / worst ms: the design pass's turn 15, 7 / 9 with
the engine's leaf, 8 / 11 with it changed every plan, 6 / 8 `mat` alone; dense 7 / 9, 8 / 11, 6 / 9; the combat of
twelve 92 / 98 (still `mat`'s row then), 93 / 101, 91 / 100. The engine adds about 1 to 2 ms per changed leaf: the gate
passed.

**With the gathering** (Node, load average 3, median / p90 / worst ms; "as the app plans": the engine's across leaf
drawn and a fight gathered):

| Input | As the app plans | The leaf changed every plan | `mat` alone (its combat row) |
|---|---|---|---|
| The design pass's turn 15 | 0.85 / 1.02 / 1.64 | 1.20 / 1.57 / 4.14 | 0.73 / 0.86 / 1.01 |
| Dense | 1.27 / 1.44 / 2.06 | 1.55 / 1.82 / 2.32 | 0.75 / 0.89 / 1.38 |
| 40 distinct names | 0.69 / 0.80 / 1.28 | 0.91 / 1.11 / 1.96 | 0.65 / 0.75 / 1.17 |
| A combat of twelve | 0.70 / 0.83 / 1.10 | 1.00 / 1.39 / 4.46 | 5.07 / 5.92 / 10.70 |
| 30 snapshots in sequence | 0.87 / 1.12 / 2.80 | 1.25 / 1.71 / 6.91 | 0.89 / 1.94 / 3.88 |

The dense board's extra half millisecond is the stack spilling (Round 4): the stack's focus searches for room.

**A worker** (planning off the main thread, the scene drawing the last committed plan) is the structural answer to
jank, and not small: layout is pure and its input is plain data, but the plan carries a `Projector` with functions
(rebuilt on the main thread from the camera spec), the app plans synchronously inside `update` and play reads the new
hit groups at once (a tap between would act on the last committed plan: membership stamps already make a stale tap do
nothing), results must be matched to their plan key and memory carried back, and the recorder's determinism needs a
plan in flight to be a pending deadline on the virtual clock. With unchanged leaves costing a key, the iPad numbers
after these changes decide whether it is needed; `mat` (until step 12 deletes it) is the larger cost either way.

**With every opponent's leaf on the engine (step 8, Nov 26)**, Node, planned at 1210×834, median / p90 / worst ms,
main and this step run back to back (load average about 20, so worst cases are noisy): the design pass's turn 15
0.89 / 1.07 / 1.65 on main, 0.91 / 1.15 / 2.50 here; dense 1.28 / 1.50 / 3.29, 1.43 / 1.74 / 3.15; 40 distinct names
0.70 / 0.82 / 1.18, 0.72 / 0.79 / 1.45; the combat of twelve 0.74 / 0.86 / 1.37, 0.77 / 0.93 / 1.38; 30 snapshots in
sequence 0.85 / 1.01 / 1.46, 1.64 / 2.53 / 5.24. Each of the sequence's snapshots changes every opponent's seat, so it
now arranges three leaves a plan, not one (a real snapshot usually changes one); a cold leaf costs about 0.3 ms. The
iPad's numbers are to be taken by hand (`?only=bench`, held in landscape).

**With my side on the engine (step 9, Nov 26)**: measurements.md, "planTable with my side on the engine". The plan
halved on the dense board, where `stackFocus`'s fallback search had been a third of it.

## Settled here, for the designer to know

None of these needs the owner.

- **The far tapped card** keeps its quarter turn; it is reached through its place (§4.3).
- **Emphasis is light only**, per the owner's answer; the spec's "laid flat for down" is superseded (§2.3).
- **Side leaves hold four front places** only with 0.2 side margins and abutting slots at 1.85 (§4.4); the template
  for the slice uses those.
- **Spent copies of a front stack** go to the `rest` fan (the spec's turn-15 table) and rejoin at their untap
  (`spend-split`), the one move tapping makes.
- **Bounds** for what is shown at once, and where it pages (§1.5).
- **Zone piles at rest**: the plate focus now holds the zones; whether piles also lie on the leaf is the spec's call,
  and the engine treats them as keepouts if they do.
- **The visible-count limit**: the engine always carries a fan's count in its facts and cues what matters inside it;
  whether intent.md's limit becomes "a pile that plainly holds more, opens in one tap, and cues what matters" follows
  the owner's answer to the spec's question 2.
