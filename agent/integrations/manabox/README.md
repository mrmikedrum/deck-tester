# ManaBox integration

Unofficial ManaBox client, the agent's way to read and write Mike's ManaBox decks. Run `bin/deckmaster manabox` from the Deckmaster checkout; it works on the decks repository (`mtg-decks`, or as `~/.config/deckmaster/config.json` names it); `--help` lists commands, `--json` returns structured output/errors. Reads/mutations are local; `pull` merges cloud, `push` uploads. New decks default to Claw. [Workflow](../../docs/manabox-workflow.md) owns draft authorization, collaboration and scoped publication.

## Setup

Node 22+, Python 3, SQLCipher (`brew install sqlcipher` or `MANABOX_SQLCIPHER`). Wrapper installs pinned local npm dependencies as needed.

```sh
bin/deckmaster manabox login --email YOUR_MANABOX_GOOGLE_EMAIL
bin/deckmaster manabox pull
bin/deckmaster manabox doctor
```

This Mac's session lives in private `~/.local/share/deckmaster/manabox/`; inspect current status rather than assuming it remains valid. Google browser/Firebase refresh flow keeps credentials out of deck files, Git and ordinary output; device registration is unused.

`MANABOX_STATE_DIR`/`--state` overrides private state; `MTG_DECKS_REPO`/`--repo` overrides root. Separate accounts need separate mirrors; workspaces/snapshots/plans/receipts are account-specific.

## Common operations

Selectors: exact name, `Folder/Subfolder/Deck`, or full opaque ID. Ambiguous names fail; IDs may contain `/+=`, so resolve stable filesystem hashes through `decks/manabox/library.json`.

```sh
bin/deckmaster manabox decks list --folder Claw --recursive
bin/deckmaster manabox deck show 'Deck'
bin/deckmaster manabox deck copy 'Deck' --name 'Experiment'
bin/deckmaster manabox folder create 'Claw/Time travel'
bin/deckmaster manabox deck move 'Experiment' --folder 'Claw/Time travel'
bin/deckmaster manabox deck rename 'Experiment' --name 'Revised'
bin/deckmaster manabox deck notes 'Revised' --file vision.txt
bin/deckmaster manabox card add 'Arcane Signet' --deck 'Revised'
bin/deckmaster manabox tag add Ramp --deck 'Revised' --card 'Arcane Signet'
bin/deckmaster manabox card move 'Arcane Signet' --deck 'Revised' --to side
bin/deckmaster manabox card set Island --deck 'Revised' --quantity 8
bin/deckmaster manabox card remove 'Arcane Signet' --deck 'Revised' --board side --all
bin/deckmaster manabox tags list --deck 'Revised'
bin/deckmaster manabox deck check 'Revised' --json
bin/deckmaster manabox diff --json
bin/deckmaster manabox push --dry-run --json
bin/deckmaster manabox push --plan PLAN_FILE --json
```

Review every planned change: push is workspace-wide. Stale plans fail; pull preserves conflicting edits for resolution. `--offline` is redundant for local reads/edits. Requested deletions need exact-name `--confirm-delete` and a `push --allow-delete --dry-run` plan.

Tags are shared definitions assigned to deck cards, not deck labels. Copies/board moves retain assignments; renames affect all uses. Only unused tags/empty folders can be deleted. Existing printings/finishes/proxies persist. New name additions reuse an unambiguous normal printing on the board or choose a normal paper default; `--cv-id`/`--finish` disambiguate.

Non-Commander decks are readable but edits blocked. Prices, trading, binders and collection linkage are outside write scope.

## Iterative refinements

Use `refine --file /tmp/decision.json --json` for one substantive decision as it is made. A turn may contain several refinements: choose a support package, rebalance colors, reconsider payoffs, or retain a package after comparison. A refinement may add 20 cards, remove 50, move cards between boards, change quantities, span paired decks, or make no changes. It is not a swap primitive. Existing card commands/imports/editable JSON remain available; review warns about changes outside the decision trail.

```json
{
  "finding": "Early card flow depends too much on an established board.",
  "decision": "Test a cheaper independent support package.",
  "reason": "Prioritize recovery without changing the deck's identity.",
  "alternatives": "Retain the current higher-ceiling engines.",
  "tradeoffs": "Less explosive scaling once established.",
  "checks": "Hypothesis only; colored access and opening hands still need review.",
  "actions": [
    {"action": "move", "deck": "Draft", "card": "Existing Card", "to": "side"},
    {"action": "add", "deck": "Draft", "card": "Candidate Card", "quantity": 1}
  ]
}
```

The example names are placeholders. Actions are `add`, `set`, `remove`, or `move`, with exact `deck` selector, `card` name, optional `board` (default main), `cv_id`, and `finish` (normal/foil/etched). `set` requires a real-card `quantity`; `add`/`remove` default to one real card, preserving proxies. `remove` accepts `all: true` to remove the entire row including proxies. `move` requires `to` and moves the entire row with its metadata. Ambiguous printings fail safely. The whole batch validates before saving; `--dry-run` writes neither edits nor decision history. No new cloud authorization is implied.

All six rationale fields are text; missing fields produce warnings, not usage blocks. Use `actions: []` with `decks: ["Draft"]` to record a consequential decision to retain the current list and associate it with that deck's history. Consecutive pairwise edits and more than 20 refinements since review receive advisory feedback; no refinement quota or forced pairing. Invalid actions and existing safety checks still fail closed.

`review --json` returns every pending refinement, rationale, exact operation changes, a ready-to-edit `brief`, and warnings about unrecorded edits/cloud merges. It marks a review boundary without discarding decisions (`--dry-run` only inspects). `push --dry-run` includes the same `refinement_review` in its plan/output; `push --plan` returns it alongside the actual publication result. These are accounts of decisions, not proof their claims are correct. Plans remain bound to the actual list through existing stale-plan checks.

The active pass is an ordered array of packages in the CLI-managed private workspace, generic across any number of decks. `refine --update ID --file FILE` replaces a package; `refine --delete ID` removes it and its explicit reversals. Both replay the remaining packages to derive local state, preserving independent outside edits through the existing three-way merge. Invalid dependent replays/conflicts fail before saving; revise dependent packages first. No prior review/read call is required. `refine --revert ID --reason TEXT` instead records a consequential reversal in the trail; use a compensating package if later edits overlap. Editing/deleting packages is drafting, not an audit log of every correction.

Record a brief whole-pass self-review with `review --reason TEXT`, or combine it with plan preparation using `review --finalize --reason TEXT`. Assess whether the combined packages still serve the relevant visions, fun and preferences, what costs remain, and whether further revision is needed. This is a judgment checkpoint, not a declaration that tests passed. The signoff binds to both decisions and local state: later edits make it visibly stale. Missing/stale signoff warns without blocking legitimate work; there is no mandatory call sequence or deck-count limit. A prepared plan still requires fresh review if its state or reasoning changes.

Continue refining whenever useful, or run `review --finalize` to merge phone edits and prepare a publication plan. Inspect its entire scope and decision trail; `review --finalize --plan FILE` publishes that unchanged plan. Existing `push` commands are compatible publication entrypoints and return the same decision report. The publication result includes `delivery_brief`, a directly usable account of the outcome, decisions, whole-pass assessment and remaining gaps. Quality warnings remain advisory; existing data-safety checks still apply.

Verified publication saves the completed pass (decisions, reversals, exact changes and receipt reference) into tool-managed history in the private workspace, then clears the active pass in the same workspace write. Failed/uncertain publication retains the active pass. Read history with `review --history --deck 'Draft' --json` or omit `--deck` for all passes. This history is local, not ManaBox deck notes and not Git-tracked; preserve private state backups. Reviewed plans/receipts retain their existing recovery policy. Distill consequential conclusions into project notes and deliver the decision brief to Mike; no authored per-turn reports are needed. An agent must reread instructions to pick up workflow changes.

## Files, imports, checks

[Artifacts](../../docs/deck-artifacts.md) owns JSON/text syntax, replace semantics and metadata limits. `library.json` indexes folders/tags/decks. Stable mirrors survive renames. Authored state and evidence belong under `projects/<slug>/`, mapped by `projects/index.json`; legacy companion files are preserved by the CLI but are no longer the workflow's storage location. Supported JSON edits use `folder_id` for membership (`folder` is annotation) and tag IDs from the index. Resolve new card IDs/create/delete objects through CLI. Missing files never imply deletion. Private raw state retains unknown fields; JSON exports are not full-account restores.

```sh
bin/deckmaster manabox deck export 'Revised' --format enriched --output /tmp/draft.txt
bin/deckmaster manabox deck import 'Revised' --file /tmp/draft.txt --replace --dry-run
```

`deck check` covers size, basic singleton/commander eligibility, identity and card legality. It reads the local list but fetches missing Scryfall facts **even with --offline**; `--force` refreshes. Batches ≤75 with pacing; [cache policy](../../docs/card-cache.md) has no age expiry. Pairing/special rules, brackets and social fit need judgment. Exit 2 = deck issues; exit 1 = operational error.

## Recovery mechanics

```sh
bin/deckmaster manabox snapshots list --json
bin/deckmaster manabox snapshots show FULL_HASH
bin/deckmaster manabox snapshots restore FULL_HASH --dry-run
bin/deckmaster manabox receipts list
bin/deckmaster manabox receipts reconcile
```

Distinct cloud states become compressed, digest-deduplicated snapshots with permanent retention. Writes retain pre-state/receipt and, on success, an independent post-state (`status: verified`). Doctor checks integrity. Restore proposes local state; deck deletions, identity/format changes and unsupported fields are blocked, requiring selective recovery. Securely back up private `.manabox/` separately from Git mirrors.

Before cloud access, catalog manifest checks can replace missing/corrupt/old catalogs via validated full download/decryption/atomic replacement; old catalogs remain. Unknown schemas stop writes; `catalog update --force` rebuilds explicitly.

Reads retry boundedly. Uploads send once, except an explicit `outdated_db` rejection independently proven to have changed nothing permits one catalog-refresh retry. HTTP 200 may contain partial/discarded operations; unresolved receipts block writes. Reconcile observes only. Authorized `--accept-current --reason TEXT` acknowledges understood partial responses, not success; missing HTTP responses remain uncertain.

Cooldowns/Retry-After persist; 10,000-operation cap, no automatic splitting or inferred service quota. Local locking/preflight cannot guarantee atomic batches or prevent final-interval phone edits. [Workflow](../../docs/manabox-workflow.md) owns safe recovery boundaries; [maintenance](../../docs/manabox-maintenance.md) covers upstream changes.

## Development

Run `npm ci` then `npm test` in `agent/integrations/manabox`. Tests use disposable SDK/SQLite state, no cloud. [Acceptance evidence](../../docs/manabox-validation.md) is dated, not a current account check. Private credentials, catalogs, APKs and native executables remain uncommitted.
