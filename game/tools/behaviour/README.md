# Browser behaviour tests

The suite plays the built client through real touch, mouse and keyboard input. It checks
choices and timing at `/api/answer` and watches for page errors and malformed answer identities.

From `game/` after installing dependencies:

```bash
npm run check
npm run build && npm run behaviour -- play
BEHAVIOUR_BROWSERS=webkit npm run behaviour -- --grep @cast
```

Install the Chromium and WebKit browsers with `npm exec -- playwright install chromium webkit`
if they are missing. The full suite runs on Chromium. A subset tagged `@cast` runs on WebKit.
Touch cancellation uses Chromium's DevTools protocol.

The harness serves the build on a free port and intercepts `/api/**`. It holds the long poll
until a test pushes a snapshot, then records answers and their virtual times. Each worker boots
once. Tests start fresh games with new generations. The virtual clock drains input, card-data
replies and snapshots before advancing.

Find targets through `locate.js`, which uses `window.__deckmaster` to verify screen points
against the client's picking. The fixture views and card catalog are in `../fixtures/`.
