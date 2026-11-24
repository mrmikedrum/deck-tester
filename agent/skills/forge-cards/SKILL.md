---
name: forge-cards
description: Maintain Deckmaster's Forge dependency and script-only card additions; check upstream, verify native behavior and retire local scripts when upstream catches up.
---

# Forge card maintenance

Run from this repository. This procedure implements Mike's November 2 choice: maintain a small set of native card scripts, not a Java engine fork. The scripts are ordinary Forge scripts in one patch of the series, "Add card scripts Forge lacks", under `forge-gui/res/cardsfolder/<letter>/`; its commit message holds each card's provenance. Edit it in the Forge checkout on the `goldfish` branch and export the series ([engine patches](../../docs/architecture.md#engine-patches)). Never implement a card in Java. Deckmaster owns deck changes.

## Add or update support

- Read the exact requested playing lists and current Oracle text through Deckmaster's card cache/CLI. Keep side/maybe cards separate from blockers. Never silently substitute or remove unsupported cards.
- Inspect **both** upstream `master` and the current `daily-snapshots` tag, recording their full commits and whether recursive trees are complete. Search `cardsfolder/upcoming` too; compare exact `Name:` values, not only filename fragments. Distinguish similarly named cards.
- Prefer the upstream implementation. A later upstream script may be imported into the card patch only after inspecting required engine features, keywords, tokens, editions and effects against the installed revision. Record upstream commit/path in the patch message and verify it on this engine. Otherwise update engine and resources together using [the dependency procedure](../../docs/architecture.md#updating-upstream-support). No unattended engine upgrades or network imports at game startup.
- For an absent card, start from installed analogous scripts (e.g. Scapeshift for Genesis Device, Spelunking for Warp Speed). Use only Forge's scripting language and existing engine mechanics. Required native token/resource definitions belong in the same review; stop that card if Java changes are required.
- Add the script to the card patch, named and placed as Forge's own are, with its provenance (analogues actually inspected, Scryfall oracle id) in the patch message. Export the series and run bootstrap while the engine is idle; Forge's normal reader loads it, and there is no second card parser.
- Exercise real native rules through `tests/test_trek_cards.py` or focused new scenarios: costs, zone changes, triggers, thresholds, optional/zero choices, token behavior and material interactions. Overrides arrange scenarios; they never count as evidence that a spell/ability actually resolved. Use explicit choices for consequential actions. An overridden library insertion goes to its bottom; mana payment can tap old lands. Test the right objects.
- Run `python3 -m unittest discover -s tests -v`, then start the original exports and run bounded smoke games. Distinguish scenario checks and smoke games from deck-quality playtesting. Game records, headers and reports flag the cards the series adds.

## Refresh and retire

Use upstream development/snapshots for fresh support; stable releases are older fixed checkpoints, not a separate card scripting API. Recording the tested engine commit ensures reproducibility, not a mandate to stay there indefinitely. Refresh when requested/new support is needed; do not add a polling job.

When the pin defines a card name the series adds, bootstrap **stops** and prints upstream's path. Review upstream behavior, run the same scenarios, then drop our script from the card patch (git history keeps it). Upstream wins after verification, not by blind overwrite.

For a contribution, keep the diff script/resource-only, follow upstream CONTRIBUTING.md (including AI disclosure), and ask for the separate publication request before opening an upstream PR. Local implementation authorization is not publication authorization.
