---
name: forge-cards
description: Maintain this goldfish host's Forge dependency and script-only card additions; check upstream, verify native behavior and retire local scripts when upstream catches up.
---

# Forge card maintenance

Run from this repository. This procedure implements Mike's November 2 choice: maintain a small native-script resource layer, not a Java engine fork. `cards/manifest.json` owns local card names and provenance; `cards/*.txt` are ordinary Forge scripts. Existing engine-integration patches predate this work: preserve them, do not extend them to implement a card. Deckmaster owns deck changes.

## Add or update support

- Read the exact requested playing lists and current Oracle text through Deckmaster's card cache/CLI. Keep side/maybe cards separate from blockers. Never silently substitute or remove unsupported cards.
- Inspect **both** upstream `master` and the current `daily-snapshots` tag, recording their full commits and whether recursive trees are complete. Search `cardsfolder/upcoming` too; compare exact `Name:` values, not only filename fragments. Distinguish similarly named cards.
- Prefer the upstream implementation. A later upstream script may be imported into `cards/` only after inspecting required engine features, keywords, tokens, editions and effects against the installed revision. Record upstream commit/path in its manifest entry and verify it on this engine. Otherwise update engine and resources together using [the dependency procedure](../../docs/architecture.md#updating-upstream-support). No unattended engine upgrades or network imports at game startup.
- For an absent card, start from installed analogous scripts (e.g. Scapeshift for Genesis Device, Spelunking for Warp Speed). Use only Forge's scripting language and existing engine mechanics. Required native token/resource definitions belong in the same review; stop that card if Java changes are required.
- Add the script and manifest provenance, including analogues actually inspected. `python3 -m goldfish.card_resources` installs into the ordinary reader's `cardsfolder/goldfish-local`; there is no second card parser. Run it only when the engine is idle. Normal engine startup also synchronizes resources.
- Exercise real native rules through `tests/test_trek_cards.py` or focused new scenarios: costs, zone changes, triggers, thresholds, optional/zero choices, token behavior and material interactions. Overrides arrange scenarios; they never count as evidence that a spell/ability actually resolved. Use explicit choices for consequential actions. An overridden library insertion goes to its bottom; mana payment can tap old lands. Test the right objects.
- Run `python3 -m unittest discover -s tests -v`, then start the original exports and run bounded smoke games. Distinguish scenario checks and smoke games from deck-quality playtesting. Local-script availability is tagged in game records and record headers.

## Refresh and retire

Use upstream development/snapshots for fresh support; stable releases are older fixed checkpoints, not a separate card scripting API. Recording the tested engine commit ensures reproducibility, not a mandate to stay there indefinitely. Refresh when requested/new support is needed; do not add a polling job.

When upstream supplies an existing local name, the installer **refuses to shadow it**, with paths to compare. Review upstream behavior, run the same scenarios, then remove that manifest entry and move its authored script out of the active `cards/` folder. On the next synchronization the installer preserves the old installed file under `.goldfish/retired-cards/` rather than deleting it. Upstream wins after verification, not by blind overwrite. Edited/unowned installed files stop synchronization too; reconcile them without discarding work.

For a contribution, keep the diff script/resource-only, follow upstream CONTRIBUTING.md (including AI disclosure), and ask for the separate publication request before opening an upstream PR. Local implementation authorization is not publication authorization.
