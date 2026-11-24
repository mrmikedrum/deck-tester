# Seat: the card room

This is a look only. Behaviour, layout, focus and interaction are unchanged.

The table is dark walnut under a pool of lamplight. Each seat plays on a graphite felt mat with a stitched edge
in its seat colour. Every label is printed on bone card stock in ink: pile tags, life boxes, the prompt, sheets,
the profile and the sift title. That way a label can't be mistaken for a glow.

Colour does one job at a time:
- **Signal colours** say what you can do: cyan, yellow and red. Nothing else on the table uses them.
- **Seat colours** say whose things are whose. They changed so they no longer collide with the signals. Before,
  my gold matched "selected", Bo's cyan matched "option" and Cy's coral matched "danger".

| Token | Colour | Used for |
|---|---|---|
| option | `#38e1ff` cyan | Things you can act on |
| selected | `#ffd21a` yellow | What you've picked or are holding |
| danger | `#ff3b3b` red | Something aimed at your stuff |
| you | `#efe6d2` ivory | My seat; the bone of the labels |
| ana (left) | `#a58bff` violet | Seat |
| bo (across) | `#5fd08c` jade | Seat |
| cy (right) | `#f26cc0` rose | Seat |
| ink | `#16120e` | Plaques, text, primary buttons |

## Legend of highlight states

Each state differs in shape as well as colour, so it still reads on a glance across the room.

| State | On the board | In the HTML |
|---|---|---|
| **Legal option** (can act on it) | Cyan soft ring that breathes (slow pulse); cyan gem on cards with an ability you can use now | Hand card: cyan ring. Prompt that's asking you: cyan ring around the card. Plate you can choose: cyan ring |
| **Selected / held** | Thick, steady yellow band, no pulse. Plate: thick yellow ring | Lifted or dragged hand card: yellow band. Picked sheet option: yellow fill edged in ink. Picked card: yellow ring plus ink ring and a yellow number badge. Drag line: yellow dashes |
| **Danger** (something targets your stuff; attackers your held blocker can block) | Blood band on the card's own edge with a heartbeat, where the aim line ends, and a sigil branded into the page at its foot (crisp burnt lines, the heat pulsing dull oxblood in them) | Prompt gets a red top bar, red ring and red headline. "What you lost" recap: red-edged panel |
| **Active turn player's field** | Mat's ruled border inked solid in the seat colour, lit like the page (one mat at a time: the old one clears before the new one inks in); a **TURN** flag in the seat colour on top of the plaque | Prompt eyebrow reads "Turn N · Xxx's phase" |
| **Priority** (the plaque of the player who holds it) | Plaque glows softly in its seat colour (unchanged rule) | — |
| **Focused field vs dimmed background** | In focus, the felt is lighter and the edge brighter. When you lean in on a side, the camera stays put: that page lifts off the table and comes over the middle, squared to you and as large as fits, casting its shadow on what it covers; other mats fall into soft shadow and their cards grey part-way, still readable. On another player's turn their page comes forward 1.1× in place. While the stack is up the whole table dims, never to dark | "Xxx's side / Back to the table" bone bar |
| **Tapped** | Card is shaded but **keeps its colour**: darker and cool. Ink-on-bone **tap symbol** on the art. Standees still lean back. Dimmed means grey; tapped means coloured, dark and badged | Sift: the same |
| **Attacking** | Solid arrow in the attacker's seat colour on a dark edge, ending in an **arrowhead** at the player or planeswalker | — |
| **Blocked** | The attacker's arrow ends in a **stop-bar** in front of the blocker | — |
| **Stack item's target** | **Dashed** aim line in the caster's colour from under the spell to each target; fainter for items below the top | — |
| **Stack item** | Card **sleeved** in its controller's colour, lifted on a drop shadow; a seat-colour tag with the name ("Ability" for abilities). It is never a glow, so it can't be read as a halo | Feed grows darker while the stack is up (unchanged rule) |
| **Your field vs theirs** | My mat: warmer felt with an **ivory** edge and stitching; my standee stripes and arrows are ivory. Opponents' mats: graphite with violet, jade or rose edges | — |
| **Commander** | Name bar outlined in **bronze** `#d6b27a`, deliberately not the selected yellow | — |

## What changed, for porting

The look lives in four places: the `THEME` block, the texture functions, a few material lines and the CSS.

### `client/h.js`

**New**
- `THEME` and `COLORS = THEME.seat`, at the top of the file. They replace the old `COLORS` line.
- `tapBadge(x, cx, cy)`, beside `drawFace`.
- `haloCanvas(kind)`, beside `buildGeometry`.
- `felt(x)` and `feltPattern`, before `floorTex`.
- `woodCanvas()`, before `buildScene`.

**Restyled; signature unchanged**
- `kwIcon`, `gem` and `drawBack`.
- `drawFace`: border, bars, the commander outline, and a call to `tapBadge` when tapped.
- `faceKey`: adds `c.tapped`, because the face now draws the tap badge.
- `faceMat`: a second uniform, `tap`, beside `dim`. Tapped and dimmed are now different looks.
- `buildGeometry`: theme materials; `MAT.halo`, `MAT.haloSel` and `MAT.haloRed` each get their own `haloCanvas`; new
  `MAT.drop`, the stack shadow.
- `chipTex`: ink rim.
- `tagSign`: bone label with a seat-colour notch.
- `bannerTex`: plaque, portrait ring, bone life box and TURN flag.
- `tagTex`: squarer, with an ink edge.
- `buildScene`: background, the walnut table and a warmer sun.
- `frame`: two look lines. The option pulse is `0.68 ± 0.32`, and `MAT.haloRed` gets a faster pulse.

**Signature changed**
- `floorTex(col, lit)` becomes `floorTex(pid, w, d)`. It draws to the mat's size, which is its region's (`BASE`) for
  the whole game: a mat never stretches. The turn's edge is its own layer (`floorGlowTex`), handed over in 300 ms when
  the turn passes (out, then in), and lit / out of focus are the material's tint, eased. The stack doesn't change the light.
- `ribbon(a, b, color, blocked)` becomes `ribbon(a, b, color, blocked, aim)` and returns a `Group`: an ink edge
  plus the colour, an arrowhead or stop-bar, and dashes when `aim` is set.

**One-line edits in layout, interaction or stack code**

These touch code the other session may also change, so port them by hand:
1. `buildBoard`: `floorTex(COLORS[p.id])` becomes `floorTex(p.id)`.
2. `layout` → `apply`, floor branch: `floorTex(COLORS[pc.pid], t.floor.lit)` becomes
   `floorTex(pc.pid, t.floor.lit, t.floor.w, t.floor.d)`.
3. `layout` → `apply`, faces: `m.userData.dim.value = Math.max(tapped ? 1 : 0, f);` becomes
   `m.userData.dim.value = f; m.userData.tap.value = tapped ? 1 : 0;`.
4. `layout`, stack lanes: add `aim: true` to the `lanes["stack" + i + "_" + j]` object.
5. `drawLanes`: pass `l.aim` to `ribbon`.
6. `buildStack`: the additive `glow` mesh becomes `drop` (`MAT.drop`) plus `sleeve`, a `GEO.face` mesh in the
   controller's colour scaled 1.1 × 1.075 behind the card.
7. `sift`: `cardMesh(c, { dim: c.tapped })` becomes `cardMesh(c)`, then sets `tap` on its faces.

### CSS

These files keep every selector and layout property; only colour, surface, radius and type change.
- **`common.css`**: `:root` palette, with new tokens `--ink*`, `--bone*` and `--sig-*` and new seat colours.
  Also `.prio .btn`, `.scrim`, `.inspector h3/.chip/.note/.oracle`.
- **`live.css`**: prompt as card stock (`.l-prompt`, `.asking`, `.threat`, `.l-where`, `.l-what`, `.l-ctx`), buttons
  (`.l-buttons button`, `.act`, `.ghost`, `.l-done`, `.l-ghost`), sheets (`.l-sheet`, `.l-box`, `.l-opt`, `.l-opt.on`,
  `.l-card`, `.l-card.on`, `[data-n]`), `.l-toast`, `svg.l-drag`, `.l-menu`, `.l-feed`, `.l-log`, `.l-field`, `.l-note`,
  `.l-actions .l-opt`, `.l-back`, `.l-recap`, `.auto::after`.
- **`h.css`**: `.proto-h` background, `.h-status` as card stock, `.h-scen`.
- **`g.css`**: `.proto-g` background, `.g-sifttitle`, `.g-close`, `.g-modal`, `.g-profile` (card stock with a
  seat-colour top band; the ink life box is `header .big`), `.g-peek.back`.
- **`table-kit.css`**: `.hand .hcard.playable` (cyan), `.unplayable`, and a new `.hand .hcard.up, .dragging` rule
  (yellow).

`live.js` and `live.html` are untouched. No markup class changed, and the fonts are still Barlow and
Barlow Condensed.

## Screenshots

These are in WebKit at 1180×820, the iPad size, at 2× scale. `shots/after/*.png` are the new look and
`shots/after/before/*.png` are the same scenes in the old look.
- `h-*`: offline scenarios, `offline.html`.
- `live-*`: `live.html` against a mocked bridge (`tools/shoot.js`), covering main, plays, attack, block, threat,
  target, sheet, their turn, focus, inspector, profile and sift.

To re-run:

```bash
node tools/serve.js            # serves client/ and the card cache on :8797
```

```bash
node tools/shoot.js shots/after webkit
```

`BASE=http://localhost:<port>/` points the harness at another copy, which is how the before set was shot.

## Transitions: the architecture (Nov 6)

Every redraw used to throw the scene graph away and rebuild it: all meshes, all particle emitters with fresh random
seeds, the stack. Live polls redraw on every change, so effects restarted, tweens re-eased from zero, and the iPad
stuttered on each. Now:
- `buildBoard` keeps a piece whose **signature** (`pieceSig`, `plateSig`) hasn't changed: the same three.js object,
  with its effects, stays in the scene. Only what changed is built, and what's gone is disposed. `__h.stats` counts
  builds, built and reused.
- `buildStack` keeps the stack when its spells and layer are the same.
- Effects are **seeded by card id** (`withSeed` in `fx.js`): a rebuilt effect makes the same particles in the same
  places mid-flight, so even a rebuild doesn't reset.
- `layout` keeps an in-flight move when the targets haven't changed, instead of restarting its easing.
- Card edges are dark, so a dimmed card doesn't leave a bright frame behind. Wells, ash and scorch sort with the
  scene (renderOrder 0); floors draw first. Lane and stack geometry are disposed.
- The composer runs 2× MSAA at no more than 1.5× pixel ratio.

**Eval loop**: `node tools/eval.js shots/eval webkit` (with `node tools/serve.js` running). It drives focus, scenario and
stack transitions, offline and against the mocked bridge, and reports per transition: redraws, built vs reused,
object identity kept, frame p50/p95, a flicker score (pixel difference per 100 ms between captures) and leak
counts, with a strip of captures per transition and verdicts in `shots/eval/eval.md`. Software rendering makes
frame times relative only; a flicker "spike" on a 500 ms move can be capture pacing rather than a jump, so read
the strip before believing it.

## Motion loop (Nov 21)

*Paused (Nov 23).* It ran with the client as a repository of its own, its lanes on worktrees of that; it needs
reworking for this repository (outputs under `.deckmaster/`, lanes on branches with pull requests, lanes split by
module after the TypeScript migration) before it runs again ([roadmap](../docs/roadmap.md)).

Stills and wall-clock strips missed what was wrong with motion, so review now works from frame-exact recordings.
- `tools/reel.js` records the clips in `tools/clips.js` on a virtual clock (rAF, `performance.now`, timers and CSS
  animations stepped at 1/30 s), so every frame is captured at true time even under software rendering. Each frame
  also logs every mat's screen outline, size, texture and shade, and every piece's box (`track.json`).
- `tools/packet.js` turns a clip into what a model can see: per beat, a 3×3 sheet of whole-screen frames, a zoomed
  sheet per mat that moved, a trails image (each mat's outline per frame, blue → red) and telemetry flags in plain
  words (jumps, one-frame turns, retextures, stretched images, overlaps).
- `tools/look.sh [rounds]` runs the loop: two blind witnesses (Claude and Codex) narrate, then judge, against how
  real objects would move; a merge step verifies and ranks them, along with the last judge's regressions; a fixer
  works the list and re-records; a Codex judge compares before and after without knowing which is which. Rounds
  land in `look/round-N/`, reels in `reels/`. Prompts are in `tools/look/`.
