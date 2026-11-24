# Game client migration: handoff

The game client (`game/client/`) moves to TypeScript and Vite. This page is the brief for planning and running
that work: what is decided, what is explicitly left open, the state of the code, and how to prove a step
changed nothing. Delete it when the migration ships; what it settles belongs in [architecture](architecture.md)
and [decisions](decisions.md).

## Decided

- **TypeScript and Vite** for the client. Agents write nearly all of it, and a type checker
  catches the mistakes they make.
- **The migration gets its own plan**, worked out separately and after the repository restructure (which is
  done). Nothing below the "Open" heading is decided, however confidently it reads.
- **The monolithic files go.** The other design directions (`a`-`g.js`) are already deleted; `h.js` and `live.js`
  are next to be split.
- **Grimoire is a theme of the game client**: modular, and in this repository (not state).
- **The protocol gets a dedicated agent.** Typing the engine's view and decisions as the client's contract,
  checked against views a real engine game saves, is the direction ("definitely something like that"), but that
  agent makes the calls on shape and checking.
- **The client stays in this repository**, served by the game server (`deckmaster/game.py`).
- **Card images stay out of git** (Wizards' images, public repository): a runtime cache in `.deckmaster/cache/cards/`.
- **`deckmaster/` stays Python standard-library only.** The client and its tools are the repository's only Node.
- **The design goals stay goals.** [game/tools/look/intent.md](../game/tools/look/intent.md) holds usability goals
  with their reasons; a migration may change how a goal is met, never give one up.

## Open: for the migration plan

Recommendations are from the restructure session; none were agreed.

| Question | Recommendation |
|---|---|
| Strict from the start, or gradual (`checkJs`, JSDoc) | Strict, converting each piece as the split carves it out |
| A UI framework for the HTML layer | None: plain DOM beside three.js, as now |
| How the pieces split, and in what order | See "A possible split" below |
| A test runner for pure modules | Vitest |
| Development and production serving | Vite's dev server proxying `/api` to `deckmaster game`; the game server serves the built `dist/` |
| three.js and fonts from CDNs at runtime | three.js from npm; fonts self-hosted or kept, either way decided once |
| How a theme plugs in | Grimoire's `THEME` block, textures (`world.js`), materials and CSS behind one theme module |
| What CI checks | `tsc --noEmit`, `vite build`, the unit tests; recordings stay local (minutes long, software GPU) |

## The code today

- **Pages:** `live.html` (the game) and `offline.html` (the board on fixtures, for the tools). Classic scripts in a
  fixed order sharing globals: `common.js` (`Proto`: the game model, cards, helpers), `table-kit.js` (`Kit`),
  `world.js` (`SeatWorld`: textures), `fx.js` (`SeatFX`), `h.js` (the 3D table, `SeatHooks`), `live.js` (`Live`:
  the HTML layer and the connection to the server), with `live-boot.js` or `data.js` + `scenarios.js` first.
  three.js 0.160 and its addons come from jsDelivr through an import map; fonts from Google Fonts.
- **Sizes:** `h.js` about 3,100 lines (250 KB) in one closure with some 25 shared `let`s; its biggest functions are
  `buildBoard` (about 410 lines), `layout` (about 250), `fitSeat` (about 220) and `targets` (about 150). `live.js`
  about 2,300 lines; `laySift` about 250, `status` about 160.
- **Sections of `h.js`** (its own banners): geometry, theme, helpers, images and fonts, card faces, scene, pieces,
  the table and seats, fitting a page (floors, rows, folding), build and lay out the board, aim lanes, plates,
  the stack, overlays, modals, sifting a pile, touch, frame loop, hooks.
- **Hooks the tools depend on.** Keep these working (or change the tools with them):
  `window.__h` (`pieces`, `poses`, `pickAt`, `scene`, `cam`, `renderer`, `T`, `focusOn`, `loadScenario`, `sift`,
  `unsift`, `refresh`, `stackRect`, `stackAt`, `stats`, `profile`), `window.Live` (`take`, `snap`),
  `window.SeatHooks.stackLayer`, `window.Proto` (`G`, `card`, `name`), and the layout audit's markers for a focus
  (`userData.focus`, `userData.involves`, `data-focus`). The recorder also replaces `requestAnimationFrame`,
  timers, `performance.now`, `Math.random` and CSS animations with a virtual clock.

## A possible split

One suggestion, to be argued with: card faces and textures; the scene and frame loop; table geometry and leaning;
**the seat layout** as a pure function (a seat's cards and its place on the table in, positions, piles and
summaries out); board transitions (who moves where, and when); the stack; aim lanes; plates; sifting; touch. In
`live.js`: the connection, the prompt and decisions, the hand, the stack panel, sheets, the log. The seat layout
matters most: the next design work, rethinking how big opponent boards read (several real-world paradigms side by
side, judged blind), should be able to swap that one module.

## Proving a step changed nothing

Recordings are frame-exact on a virtual clock, with `Math.random` seeded. Record every clip before and after a
step and compare:

```bash
(cd game && node tools/reel.js /tmp/before "$(node -e 'console.log(require("./tools/clips.js").filter(c => !c.manual).map(c => c.name).join(","))')" --quick --jobs 2)
# ... the change ...
(cd game && node tools/reel.js /tmp/after <same clips> --quick --jobs 2)
python3 game/tools/equiv.py /tmp/before /tmp/after
```

Two recordings of the same client are not bit-identical: one or two frames per clip can be off by a fraction of a
pixel or a thousandth of opacity, and a CSS animation can start a frame apart, so pixel PSNR can dip to about
27 dB on a single frame. Measured on Nov 23 between two runs of unchanged code. So a step is equivalent when its
differences are of that size and kind, and the same frames show them when re-recorded; `equiv.py` prints what
differs where. Run the layout audit too: every `packet.md` ends with `LAYOUT: PASS` or `FAIL`.

## After the migration

The protocol contract; then the opponent-board exploration; then the look loop again, reworked: its
outputs under `.deckmaster/`, its lanes on branches with pull requests, split by module rather than by file
([game/LOOK.md](../game/LOOK.md)). The design direction for the table lives in `intent.md`: clarity over
density, focus states (the stack, a combat or one seat may take the table while it can be dismissed in one tap),
folding by importance, intentional overlap with summaries, boards described the way a player would.
