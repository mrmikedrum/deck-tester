# The game's look

Grimoire is the table's theme. Its colours, materials and painters live in `client/src/theme/`.
See the [design goals and hard limits](tools/look/intent.md) before changing the look.

## Visual checks

Run these from `game/` after building with `npm run build`. Fill the fixture art cache from the
repository root with `bin/deckmaster game --fill-cache`.

```bash
node tools/combat-stills.js ../.deckmaster/stills/combat
node tools/chrome-stills.js ../.deckmaster/stills/chrome
node tools/reel.js ../.deckmaster/reels combat,stack --stills --jobs 2
node tools/packet.js ../.deckmaster/reels
```

The workbench at `/workbench.html` shows fixture boards and motion. The stills tools show combat
and chrome on the built client. The recorder uses scripted bridge snapshots, real gestures and a
virtual clock. Omit `--stills` to capture motion; `--viewport 1210x834` records at the iPad's
landscape size. The packet measures the drawn table at each gated beat and reports whether the clip
meets the layout limits.

## Look loop

The automated witness, fix and judge loop is paused. The legacy runner was retired. The design
intent, limits and reviewer briefs remain in `tools/look/`. The fix and review briefs now refer to
the TypeScript sources and current checks. The [roadmap](../docs/roadmap.md) tracks resuming
the loop on the whole table.
