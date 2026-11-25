# Behaviour tests for the game client

Black-box tests that pin what the player experiences: given the server's snapshots and the player's input, exactly
which bodies the client POSTs to `/api/answer` (and `/api/new`), and when. They are the safety net for the TypeScript
rewrite ([migration plan](../../../docs/game-client-migration.md), "Behaviour to pin" and "Accepting a step"): they must
pass unchanged before and after every step. Where the client differs from the plan's wording, the test follows the
client (characterization) and says so in a comment.

## Run

```bash
cd game && npm ci && npm run behaviour                # all specs, ~4 minutes cold (each worker boots the client once)
cd game && npx playwright test -c tools/behaviour play # one spec file
BEHAVIOUR_ENTRY=live.html npm run behaviour            # the page under test, relative to game/client (the default)
npx vite build && BEHAVIOUR_CLIENT=new npm run behaviour                              # the built new entry
BEHAVIOUR_CLIENT=new BEHAVIOUR_BROWSERS=chromium,webkit npx playwright test -c tools/behaviour --grep @cast   # CI's subset
```

Headless, 1180x820 with touch, software GL; Chromium unless `BEHAVIOUR_BROWSERS` lists more (`webkit`). `global-setup.js`
serves `game/client` (or `client/dist`, the built new entry, with `BEHAVIOUR_CLIENT=new`) with `tools/serve.js` on a free
port. Card images come from `.deckmaster/cache/cards` (`bin/deckmaster game --fill-cache`); the current client's three.js
and fonts come from their CDNs, so the machine needs network.

## Both clients

The same specs run on the current client and on the new entry. Tests tagged `@cast` are the slice's (cast, target,
resolve: the pass button, a hand card dragged up, a target tapped on the table, the decision key, a double tap); CI runs
them on the new entry on Chromium and WebKit. A test the new entry cannot pass yet because its lane has not landed calls
`pending(reason)` (from `harness.js`) and is skipped there with the reason, never deleted. On the new entry:
- it is read only through `window.__deckmaster` (readiness: `ready`, then a first snapshot, then `settled()`);
- it takes input and snapshots in its next frame rather than in the handler, so the harness runs that frame at the same
  virtual time (`__clock.step(0)`) after each input event and while a pushed snapshot or a card-data reply is
  outstanding: answers go out at the same virtual time as on the current client;
- its answers also carry the decision's `id` and the game's `gen`: the harness checks them and leaves them out of
  `answers()`, so specs compare what both clients send;
- `harness.js` fills the fields the engine always sends and `shoot.js`'s mocks leave out (`engineShape`), since the new
  entry decodes strictly.
WebKit has no DevTools touchCancel: a cancelled touch drag is skipped there.

## How it works

- **The seam is HTTP.** `harness.js` routes `/api/**`: `/api/view` is a long poll held until the test pushes a snapshot
  (`table.push`), `/api/answer`, `/api/new` and `/api/override` are recorded with the virtual time, `/api/cards` and
  `/api/decks` are fixed. Replies are `{ok: true}` unless a test sets `table.reply.answer` (`{ok:false,error}`, or `null`
  to drop the connection) or `table.hold = true` to leave answers pending.
- **Snapshots** are the engine's real shape (`{state, gen, view, decision, pilots}`), built from the fixtures in
  `../shoot.js` (`snapshot("main")`, `withDecision`, `opponentSpell`).
- **A virtual clock** (`clock.js`, shared with `reel.js`) is frozen after boot;
  `table.step(ms)` advances it, so 3,200 ms auto-pass is tested in milliseconds of real time. Never call
  `window.Live.take`: it enters replay mode.
- **One booted page per worker.** Booting costs ~15 s, so each worker boots once and every test starts a fresh game on
  it with a snapshot of a new `gen` (the client resets all game state on a new gen). Tests in a file run in order.
- **Input is real**: `page.touchscreen.tap`, `page.mouse` drags, DOM buttons by visible text. CDP `touchCancel` for
  cancelled gestures.

## The locator rule

`locate(page, {card|plate|stack|hand: ...})` (`locate.js`, shared with the recorder's gestures) is the ONE place that
looks inside the client (the current client's `window.__h`: `pieces()`, `pickAt`, `stackAt`, `cam`; the new entry's
`window.__deckmaster`: `hits()`, `scene.pick`, `seats()`; and the `.g-hand .hcard` DOM), plus `Table.boot`'s readiness
checks. It returns a screen point verified with the client's own picking. Specs only use screen points, visible text and
`/api/answer` bodies. When debug hooks change, change `locate.js` (and `Table.boot`), nothing else.
Selectors for the prompt and sheet (`.l-buttons`, `.l-sheet`, `.l-toast`, `.l-mull`, `.l-what`) are the other coupling to
the current markup; they are listed in `harness.js` helpers (`buttons`, `sheet`, `toastText`) and specs.
