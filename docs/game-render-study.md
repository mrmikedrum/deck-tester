# Render study

Whether the table can leave the uncanny valley, and how. One static board, the design pass's turn-15 table, drawn
four ways on a standalone page (`game/client/render-study.html`, not part of the app). Every card is one size, the
arrangement engine's 1.85, in its poses: creatures stand in two rows leaning back 25°, everything else lies behind them,
and copies, lands, libraries and graveyards are piles. The camera is the game's. Nov 25, 2026.

```bash
cd game && npx vite build && node tools/render-study.js <outdir>        # stills (Chromium, 2x) and times (WebKit)
# by hand: render-study.html?v=A|B|C|D&view=game|lands|creatures|target&moment=rest|main|combat|spell
```

The other query parameters are listed in `scene/study/main.ts`. Card art comes from `.deckmaster/cache/cards`, as
for the workbench.

## What was wrong

The game's faces are `MeshBasicMaterial`: they take no light and no shadow, so a card reads as a sticker on a box.
Piles step 0.018 card heights a card (real: 0.0034), so 14 lands stand like a library. Shadows are projected
silhouettes, not light. The layout scales cards by row, so no two rows agree on size.

## The variants

**A, physical.** Cards are objects: lit card-stock faces (standard material, a little sheen from a faint room
reflection), cream paper edges, real proportions (63 × 88 mm, 0.3 mm thick: a 14-card pile is 4 mm, a 67-card library
2 cm), the top few cards of a pile a little askew over a block with a line per card on its sides. One warm spot lamp,
up and to the left, whose cone and distance make a pool of light that falls off toward the corners. PCF soft shadow
maps fall on the vellum and on cards. A hemisphere fill. A contact shade under everything that touches the table.
Standing cards sit in low bronze stands. What sells it: the long soft shadows standing cards throw back across the
page, piles that are thin, and light that changes across the table. It still looks rendered, not photographed. The
table texture has its own painted lamplight, so the light is counted twice. Faces are flat paper with no grain. In
the close views the 2048 shadow map steps along the library's edge.

**B, illustrated.** Flat unlit tiles with an ink hairline, soft drop shadows (a distance-field texture, not
silhouettes), and piles suggested by up to three offset edges with a count badge. Its only light is the tome's painted
light. It is calm, legible and honest: it never pretends to be an object. Lifted out of the table, the standing tiles
read as cut-outs, and there is no depth cue beyond the drop shadow.

**C, hybrid.** A's light, shadows, stands and proportions, with matte faces (Lambert) that are partly self-lit so their
illustration stays clean in shadow. It reads nearly as well as A and is more even and legible across the table, but
the faces look slightly printed-on. The difference from A is small at the game's camera.

**D, physical table, focus moments.** A's board. A moment lifts what matters out of realism: the card rises 0.3 off
the table (and a little toward the eye), its face crosses to unlit (one material with a `flat` uniform mixed after tone
mapping, so 1 is exactly the game's unlit face), a thin halo rings it, and a scrim dims the rest of the table. This is
the game's focus pass generalised: draw the table, lay the scrim, then draw the marked layer again over fresh depth.
The lifted cards still cast their shadows on the dimmed table, which ties them to it. Moments shown:

- *main*: my usable cards (untapped mana, abilities I can pay for), ember halos, dim 0.32. Tapped and idle cards stay
  physical.
- *combat*: my attackers in ember; the defender's possible blockers and the mana and permanents that could answer, in
  blood. Dim 0.42.
- *spell*: Swords to Plowshares held up between me and the table in gold, an arc to Meloku in blood. Dim 0.55.

As a transition (the `t` parameter, still `D-spell-half`): about 200 ms ease-out. The scrim, lift, halo and `flat` all
move on one curve; in the game the spell would also fly in from its caster (the still holds it in place). What I'd vary: `flat` 0.8 keeps a little of the lamp on the
lifted card (softer, less sticker-like); a smaller lift for main phase, where many cards rise; dim by moment, since
main phase wants a light touch and a spell aimed at me wants the room dark; and the halo, which carries the colour
meaning, so it should stay thin.

## Cost

WebKit headless on an Apple M4 Mac, 1180 × 820 at 2x, drawing continuously for 4 s. **Frame** is a frame
drawn and finished on the GPU (one pixel read back); the median is rounded to WebKit's 1 ms clock, so the mean is
shown too. Every run held 60 fps (a 17 ms interval). Shadows are drawn once unless *live*, which redraws them every
frame, as the table does while anything moves.

| Run | Frame median (mean) | Draw calls | Triangles |
|---|---|---|---|
| A | 6 ms (6.1) | 681 | 24k |
| A, live shadows | 8 ms (7.7) | 1203 | 48k |
| A, VSM, live | 9 ms (8.9) | 1234 | 49k |
| A, 1024 map, live | 7 ms (7.4) | 1203 | 48k |
| B | 4 ms (3.5) | 528 | 11k |
| C | 5 ms (5.5) | 681 | 24k |
| C, live shadows | 9 ms (8.3) | 1203 | 48k |
| D, spell (focus) | 7 ms (7.1) | 696 | 25k |
| D, main (focus) | 7 ms (7.1) | 757 | 26k |
| D, combat (focus) | 7 ms (7.4) | 802 | 27k |

The shadow map is about 2 ms of a moving frame. The focus costs about 1 ms over A at rest. Neither is the iPad's
problem: the draw calls are. The study draws each card as three meshes and each contact shade as its own, which comes
to 700 to 1200 calls. An iPad's CPU pays per call where the M4 barely notices.

## Risk on an iPad

- **A and C:** draw calls first (instance the faces, edges and contact shades, or merge the static table: well under
  200 calls is reachable). Then shadow redraws while cards move: draw the map only when something moves, or cap its
  size at 1024. Texture memory is about 110 face textures, as today. No post-processing is needed (the contact shade
  stands in for ambient occlusion), and that is the right call on an iPad.
- **B:** the cheapest and the safest. It gives up the depth the owner wants.
- **D:** A's cost plus a scrim and a second pass over the marked cards (under 1 ms here). The risk is in design, not
  cost: dimming the whole table for every main phase will tire. Main phase wants a lighter dim or none, with lift and
  halo alone.

## Recommendation

A as the table, with D's focus as the tool that steps out of it. Before it ships: instance the pieces; stop painting
lamplight into the table texture (let the lamp do it); give faces a faint paper grain; and measure the instanced build
on the iPad itself.
