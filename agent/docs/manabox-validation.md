# ManaBox CLI validation — 2026-10-16

Historical acceptance below tested the former immediate-sync behavior. The current workflow stages locally and uses explicit push checkpoints; see `docs/checkpoint-validation.md` for the subsequent changes. The CLI is in `agent/integrations/manabox`; run `bin/deckmaster manabox` from the repository. Its full usage and recovery guide is [agent/integrations/manabox/README.md](../integrations/manabox/README.md).

## Verified live

- Mirrored all 24 decks, the `old` folder and its six memberships, 72 tag definitions and 1,289 card-tag assignments.
- 28 successful, independently verified writes on dedicated temporary decks/folders/tags: creation, nested folders, card addition/removal/quantity edits, board moves, tags and shared tag renaming, notes, deck/folder renaming and movement, copying, explicit deletion and cleanup.
- Copied the full 100-card Obeka deck and independently verified it, then removed the temporary copy.
- Text import/replacement preserves retained role tags. Deliberate offline changes can be pushed through a saved reviewed plan. Direct edits to `deck.json` successfully synchronize through `push`.
- Rebuilt the catalog from empty state through the actual public update manifest, download, SQLCipher export, metadata verification and SQLite integrity check. Catalog version: 1792071886.
- Scryfall basic checks passed for Midnight Has an Encore: 100 cards, 37 lands, no reported issues/warnings. Card facts are batched at 75 or fewer IDs per request and cached for 24 hours.
- Original 23 decks were protected during acceptance. The guard itself was exercised and rejected an original-deck edit before sending. Full final comparison confirmed all original 24 decks, cards, notes, tags, folder rows and memberships unchanged. The only retained cloud addition is an empty `Claw` folder. Temporary protection was then removed as authorized.
- No device registration sent. No HTTP 429 upload responses observed; no numeric service quota inferred.

One test returned HTTP 200 with `Discarded crud entries`: the tag definition/timestamp applied but a card-tag assignment did not. Independent verification caught the partial response and blocked further writes. Inspection identified the assignment's required `owner_id`. The field is now included in the schema and all new assignments. The partial result was explicitly reconciled, its evidence retained, and a fresh corrected operation succeeded. All subsequent tag/copy/move/import tests verified independently. The client never treats HTTP 200 alone as proof of success or assumes batches are atomic.

At acceptance completion: 28 distinct compressed snapshots totaled 1,173,178 bytes (about 1.1 MiB). Earlier prototype snapshots/receipts are also retained privately. Snapshots deduplicate identical states and are never automatically pruned.

## Automated checks

JavaScript scenarios plus three Python authentication scenarios (wrapped by an additional Node test) cover real SDK/SQLite serialization, relationship integrity, tag ownership, copying, tag-preserving board moves and text replacement, protected/locked/linked decks, unknown-field preservation, cycles, destructive confirmation, three-way conflicts, stale plans, uncertain outcomes, partial/unexpected results, safe catalog rejection recovery, rate-limit cooldowns, Scryfall batching/cache, local-file validation, snapshot integrity/deduplication, private-session error redaction and process locks. Authentication tests use synthetic credentials and a loopback callback; none of these tests access the cloud.

## Remaining limits

- The reverse-engineered API has no verified compare-and-swap or atomic-batch contract. A change during the interval after preflight can only be detected by post-write verification; it cannot be prevented entirely.
- Reads cover data delivered by the authenticated sync service. Archives have metadata only; archive payloads, trades, binder/collection writes and linked-deck edits are not implemented.
- Automatic catalog repair supports schema 12 and the recovered catalog key. A changed server schema/key requires updating the adapter; the CLI stops rather than guessing.
- Historical snapshots retain raw state, but automatic whole-account restore is deliberately limited by the same write policy and blocks deck deletion. Selective/manual recovery may be needed.
- Commander checks cover common structural/card constraints, not every pairing, special rule, bracket or social consideration.
- This Mac has SQLCipher configured in private state. A fresh machine needs SQLCipher and the pinned npm dependencies. Credentials/private snapshots are intentionally excluded from Git; the deck mirror is tracked.
