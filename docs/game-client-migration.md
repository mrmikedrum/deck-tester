# Game client migration: the plan

The game client (`game/client/`) is being rebuilt in strict TypeScript on Vite, with an architecture meant to
outlast it: the client grew fast from an experiment, and this is the one rewrite. This page is the plan and the
brief for whoever runs a step: what is decided and why, the target architecture, the phases, and how a step is
accepted. Delete it when the migration ships; what it settles moves to [architecture](architecture.md) and
[decisions](decisions.md).

## Decided

- **TypeScript and Vite** (2026-11-23). Agents write nearly all of it, and a type checker catches their mistakes.
- **Rewrite with a grand scope.** Sustainable and expandable matter more than any technology choice; the plan's
  author picks the technologies. Ask the owner only about severe trade-offs or blockers.
- **Primary target: touch browsers** (an iPad added to the Home Screen first). Desktop with a mouse or trackpad
  must work too.
- **The monolithic files go**; **Grimoire is a theme** of the client, modular and in this repository.
- **The protocol gets a dedicated agent** for the contract's shape and checking.
- **The client stays in this repository**, served by the game server; **card images stay out of git**;
  **`deckmaster/` stays standard-library Python**.
- **The design goals stay goals** ([intent.md](../game/tools/look/intent.md)): a step may change how a goal is
  met, never give one up.
- **Recordings are a second-tier check** for major chunks of work (the end of a phase or lane), not every step, and
  need not match frame for frame: better rendering is welcome; regressions in behaviour or legibility are not.

## Decided by the plan

The stack, the layers and every seam's interface are in [the architecture](game-client-architecture.md), decided from
seven competing designs and a stack evaluation. How we get there, reviewed adversarially by Codex (Nov 23):

| Question | Decision | Why |
|---|---|---|
| Rewrite how | A **new entry** built on the architecture beside the current client, which stays served as the rollback until cutover. The tuned code (layout, faces, textures, effects, motion and its timings) is **ported** into the new modules, not reinvented | The old client has no seam to replace behind: `window.GAME` is rewritten in place and captured at load, `live.js` writes its draft attack into it, and choosing between sheet and table depends on the scene's piles. An in-place strangler would keep two owners of the same state in sync for months |
| Prove it first | One **vertical slice** (cast a spell from the hand, choose its target on the table, watch it resolve) through every layer before the rest is ported | Settles the seams, the frame loop and recorder repeatability where they are cheapest to change |
| Packages | One `game/package.json` and lockfile for the client and its tools; Node pinned (`.nvmrc`, `engines`); the tools stay CommonJS until ported deliberately | One `npm ci`; tools that `require()` fixtures keep working |
| Serving | `deckmaster game` serves the built client; it builds only when the build's stamp (a hash of the sources, the lockfile and the Node version) is stale, into a staging directory published on success. A current build is served without Node. In development Vite's dev server proxies `/api` and `/cache` | One command for the player; a failed build never replaces a working one |
| CI | `tsc --noEmit`, ESLint, Vitest, `vite build`, the built pages smoke-tested through the Python server, the behaviour suite on Chromium and WebKit | Seconds, not minutes; recordings stay local |

## Phases

Each phase is a branch with a pull request; a step leaves every check green.

0. **Safety net** (no client change).
   - Behaviour tests on the current client: "Behaviour to pin" below. Done: `game/tools/behaviour/`, 94 tests
     (they replaced `tests/test_seat_controls.py`, which always skipped on a stale path).
   - A credential-free capture harness (an engine table like `tests/test_manual_mana.py`, Forge's AI in the other
     seats, a scripted browser seat) that saves real bridge snapshots into a checked-in corpus,
     `tests/fixtures/protocol/`: startup, every decision kind, stack with targets, combat, game over, errors,
     omitted Java fields and Python nulls. Forge-backed CI re-runs it and checks the shapes still match.
     Done: `tests/protocol_capture.py`, 53 envelopes covering every decision kind (`tests/fixtures/protocol/`).
   - An inventory check for the layout audit: every permanent in a fixture is either drawn or reachable through a
     pile's sift, attachments included, on every seat the fixture has; a deliberately dropped permanent must fail.
   - The clips each later phase records, named here once phase 0 lists what the current set misses (the cast
     clip has no layout audit; manual clips are skipped by default).
1. **Protocol.** The protocol agent settles the current contract from the corpus: types and decoders, how a
   decision is identified, and what reconnect means (a new generation clears the draft and timers; an answer
   whose outcome is unknown waits for the next snapshot). The wire stays as it is for the migration; a stronger
   decision identity (a server-issued token checked against the parked decision when the answer arrives) is a
   separate, tested protocol change if the agent recommends it. The bridge changes the architecture needs land here:
   an answer status in each snapshot and refusing a second answer while one is working, the build stamp, and
   `/api/clientlog` ([architecture](game-client-architecture.md), "Continuity, faults and compatibility").
2. **Slice.** The toolchain (package, Vite with both entries, TypeScript, ESLint, Vitest, CI), then the new entry
   end to end for cast → target → resolve: transport, model, `play`, the scene port for the board, stack and
   targeting, a real TSX hand and prompt, the app's choreography of the hand-to-stack flight. It passes the
   slice's behaviour tests, records repeatably under the virtual clock (explicit ready and commit checkpoints),
   and runs on an iPad. The plan is revised here if the slice disagrees with it.
   Done: the toolchain and CI; the slice end to end against a Forge-backed bridge; the `@cast` behaviour subset on
   the new entry on Chromium and WebKit; the `slice` clip recorded frame-exact on both entries, the same frames every
   time (the recorder rasterizes the page in software: GPU rasterization varied run to run); the cast handoff fix in
   the scene's stage; the legibility regressions found comparing the clips. Not yet: the iPad run.
3. **Breadth, in lanes.** Scene (layout and folding, combat, lanes, plates, sift, lean-in, effects, theme module),
   chrome (sheets and choosers, inspector, log, mulligan, menus, toasts), and core (every decision kind in `play`,
   `narrative`). Each lane ends with the behaviour suite green on the new entry and its clips recorded against
   the current client's. Before the lanes that need them:
   - Done: **Focus**, one ordered stack of typed layer entries, each with its subject (a seat, a group, a card),
     replacing the app's inspector-only stack and play's own sheet (`app/focus.ts`); **Picking**, the scene picks
     from its last drawn poses (lifted, leaning, sifted), not the plan at rest.
   - **The plan** carries the camera and per-seat presentation, before other seat counts or portrait.
   - **Transport**: a push transport needs a causal resync watermark.

   Done (Nov 24): every lane. All 94 behaviour specs pass on the new entry on Chromium (and on the old client); the
   `@cast` subset passes on WebKit. Every clip but `scenarios` has a new-entry form in `tools/clips.js`.

   Done (Nov 24, later): the Codex review findings on `a5c7a28..1f94a6e`, each with a test that failed before: one
   flight at a time per card; a sift pages 27 cards at a time and has its caption back (title, count, tapped, ✕, the
   pages); a lane per blocker; tapped sift cards picked as drawn; attachments drawn once landed, their art repainting;
   `ambient` only while something moves; the turn edge's hand-off reported as activity; ribbons rebuilt in place; the
   card-data hold released at its deadline; inspector actions scoped by card; a sweep's recap only what left the
   battlefield; a failed card fetch retried with the next snapshot; focus back to the opener after a nested layer; a
   dismissal acts only on what the last commit drew.

   Open, in order:
   Done (Nov 24, later still): every clip recorded on both entries and compared by stills at the key beats. The
   `LAYOUT: PASS` then claimed for the new entry was not measured: its stills were never held to the limits, and the
   packet passed a clip with nothing measured. Since (Nov 24, Codex review of `72b26d3..011b4f1`) the new entry's audit
   measures its drawn table (the scene's drawn faces, picking and what is drawn on top), a packet with nothing measured
   says `NOT MEASURED`, and the nine audited clips (`game`, `turns`, `lean`, `creature`, `counter`, `tokens`, `combat`,
   `wipe`, `stack`) are `LAYOUT: PASS` on both entries with every gated beat measured (35 beats each); a control that
   keeps the standing stack in front of the board fails as it should. Fixed from the comparison: the commander stands beside its plaque while in the
   command zone (a tap reaches it, a cast flies from it); leaning in grows the page's cards where they stand (h.js
   `LEAN_GROW`); counter chips read the engine's counter names ("+2"); pile tabs are fitted to their card and say what
   the pile holds and how much is tapped, a creature's copies titled by name; a turned support's row makes room for
   it (it had folded Atraxa, Glissa and two planeswalkers away); a pending sweep marks what it would harm. Verified: the
   hold countdown has tests; `slice` records the same frames twice through the life-loss burst; `bin/deckmaster game`
   served the built client (`/next/`) to a real table with the default decks, 60 decisions over 23 turns answered
   through the prompt's buttons, no console errors.

   Open, in order:
   - **Left as they differ**, for the owner: leaning in, the old prompt said "Your decision is still available" and
     hid its hint; the new one keeps "Available plays" and the hint. `tools/layout-parity.js`'s `defend` scenario folds
     Bo's board to its last resort (the old layout covers its well's foot, so the new audit cannot accept that layout).
     The old client's "Your life 31 → 26 / largest creature pile" line is replay-only and not ported, as decided.
   - **Motion**, frame-exact `cast`, `combat` and `wipe` on both entries: flights, the combat row and the return read
     alike. The wipe differs in style, for the owner: the old client bursts each creature into particles where it
     stands; the new one flies each to exile as a lit card over the dimmed table. Both read as the major event.
4. **Cutover.** The whole behaviour suite and the inventory check pass on the new entry; clips compared; WebKit
   smoke in CI; a check on a real iPad from the Home Screen (safe areas, rotation, background and resume, frame
   pacing and GPU memory over a long game). Then the new entry becomes `live.html`, the tools move to the typed
   debug surface and `fixtures/`, and the old client, `data.js`, `scenarios.js` and the tools' hand-written
   boards are deleted. `--fill-cache` reads a fixture manifest instead of `data.js`.
5. **Docs.** The client's section of [architecture](architecture.md), [decisions](decisions.md), the layout table
   in `AGENTS.md`, [game/README](../game/README.md), [LOOK.md](../game/LOOK.md), the roadmap's link to this page;
   this page is deleted.

Not in the migration, each its own milestone after it: more or fewer than four seats, a portrait layout,
several people or spectators at one table (the bridge owns one human seat today), deck import, a transport
beyond long polling, a service worker. Then the opponent-board exploration and the look loop
([game/LOOK.md](../game/LOOK.md)).

## Accepting a step

- **Every step:** `tsc --noEmit`, ESLint, Vitest, the behaviour suite on each entry it touches, no console errors.
  The behaviour suite is the hard gate: no mechanical change to what the client sends or when, and no gesture that
  stops doing what it did.
- **End of a phase or lane:** the inventory check, the layout audit (every `packet.md` ends `LAYOUT: PASS`; `NOT
  MEASURED` or `INCOMPLETE` is not a pass), and the
  phase's clips recorded on both entries and looked at side by side for regressions in behaviour or legibility.
  Rendering need not match: sharper text, better textures, colours or anti-aliasing are welcome. A difference that
  loses something a goal in intent.md asks for is fixed before the phase ends.

Clips are slow: record motion only where the animation is what is checked (a flight, combat, the wipe). Everything
else is compared by stills at the key beats (`--stills`: the 2× stills and their audit, no motion pass) or in code
(`tools/layout-parity.js`, the layout tests, the workbench).

```bash
(cd game && node tools/reel.js /tmp/old "<clips>" --stills --jobs 2)          # stills and audit, the current client
(cd game && ENTRY=new node tools/reel.js /tmp/new "<clips>" --stills --jobs 2) # the same on the new entry
(cd game && node tools/packet.js /tmp/new)                                      # each clip's packet.md and LAYOUT verdict
(cd game && ENTRY=new node tools/reel.js /tmp/new cast,combat,wipe --jobs 2)    # motion, frame-exact, where motion matters
python3 game/tools/equiv.py /tmp/old /tmp/new                                   # where two recordings differ
```

## Behaviour to pin

Pinned from the current client at `/api/answer`, through real gestures (never `Live.take`, which enters a replay
mode):

1. The decision key sent equals the server's (`keyOf` in `live.js`, `key` in `game.py`).
2. `play`: option 1 is pass; a hand card dragged up 90 px plays (one option sends, several offer a sheet, none
   toasts); the pass button's label by phase; tapping a land whose only option is a mana ability opens the inspector
   with it, and a second tap, on its action there, sends it.
3. Auto-pass: an opponent's spell on top, no real option (mana abilities don't count), no threat: pass after
   3,200 ms. A threat, an own spell, a real option or Hold stops it; a replacement decision during the countdown
   never answers the old one.
4. `attack`: tap to toggle, tap a plate to retarget, drag onto a player, "Everyone attacks".
5. `block`: one legal pairing picks itself; otherwise hold the blocker and tap the attacker; illegal pairs toast.
6. `pay`: sources in order, take back, a colour sheet for a land with several abilities, Auto-pay sends `[]`.
7. Targets and choices on the table when every option is reachable there (a mixed pile sends them to a sheet);
   one tap sends when exactly one is wanted; otherwise Done, disabled below `min`.
8. Sheet decisions: `order` numbers picks, `repeat` counts them, `number` steps between `min` and `max`.
9. `mulligan` and `confirm`; which kinds offer "Let Forge decide" (`defer`).
10. Refusals toast and free the prompt; a double tap sends one answer; a cancelled pointer sends nothing; a new
    game or reconnect while an answer is pending; startup states send nothing.

Faults found while planning, to fix deliberately with a test rather than port: an answer that leaves the view
unchanged leaves the prompt busy for ever; an exception while handling a snapshot drops it silently; a failed deck
list is cached until reload; Escape doesn't dismiss the stack layer or the mulligan; `H.rewound` is never set, so
`h.js`'s take-back path is dead; face textures are never evicted; the tween clock mixes the frame time with
`performance.now()`; pointer input ignores pointer ids; a hand card counts as played anywhere 90 px up.

## The code today

- **Pages:** `live.html` (no doctype: quirks mode) and `offline.html` (fixtures, for the tools). Classic scripts
  sharing globals: `live-boot.js` or `data.js` + `scenarios.js`, then `common.js` (`Proto`), `table-kit.js`
  (`Kit`, mostly dead), `world.js`, `fx.js`, `h.js` (`SeatHooks`, `__h`), `live.js` (`Live`). three.js 0.160 from
  jsDelivr through an import map; fonts from Google Fonts.
- **The model** is `window.GAME`, rewritten in place by `live.js` and captured at load by `Proto`, `h.js` and
  `scenarios.js`; `live.js` also writes its draft attack into `GAME.combat` and card data into `CARDS`.
- **`h.js`** (3,100 lines, about 30 shared `let`s) is theme, face renderer, scene, seat layout, board differ,
  animation director, pose solver, input router and modals at once. Layout is stateful (`fitSeat` reads the
  previous plan) and depends on the camera and on the HTML layer's footprint (`HAND`, `PROMPT` constants).
- **`live.js`** (2,300 lines): `take` (196 lines) mixes diffing, narrative, animation and DOM; `status` (162)
  rebuilds the prompt per decision kind; the hand is 560 lines; three.js effects (`laySift`, `castFromHand`,
  `routeExiles`) live here and reach into `h.js` through `userData` keys and a replaced `scene.onBeforeRender`.
- **The wire:** answers are 1-based option numbers guarded by a key of kind, turn, prompt, option count and the
  first six labels, computed separately in `game.py` and `live.js`; the server checks it against its last
  snapshot, not the parked decision.
- **Hooks the tools depend on:** `window.__h` (`pieces`, `poses`, `pickAt`, `scene`, `cam`, `renderer`, `T`,
  `focusOn`, `loadScenario`, `sift`, `unsift`, `refresh`, `stackRect`, `stackAt`, `stats`, `profile`),
  `window.Live` (`take`, `snap`), `window.SeatHooks.stackLayer` and `tap`, `window.Proto` (`G`, `card`, `name`,
  `player`), the audit's markers, literal class names, and the pids `you/ana/bo/cy`. The recorder replaces
  `requestAnimationFrame`, timers, `performance.now`, `Math.random` and CSS animations from an init script, so
  code must call those globals at call time; record built pages, never the dev server.
- **The tools' fixtures** (`boards.js`, `plays.js`, `shoot.js`) are hand-written and have drifted from the
  engine's shape; no real view is saved anywhere yet.
