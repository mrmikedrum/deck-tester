# ManaBox compatibility and recovery

Incident-only runbook for the unofficial client. [Workflow](manabox-workflow.md) owns authorization/database boundaries; [CLI manual](../integrations/manabox/README.md) owns commands/retry/restore mechanics. Adapt affected operations, not every app release; compatibility with arbitrary future semantics is unproven.

## Evidence and version axes

Baseline: **2026-10-16**, Android **4.2.1 / 2715**, schema **12**, catalog revision **1792071886**, 28 independently verified writes and iPhone deck visibility. iOS binary unexamined. [Baseline JSON](../integrations/manabox/compatibility/baseline-2026-10-16.json) preserves hashes, mapped columns, endpoints and native offsets (valid only for recorded ARM64 hash). Raw research: `/Users/openclaw/Documents/manabox-research`.

Keep these separate:
- App build/User-Agent: a release alone is not a broken contract.
- Catalog **data**: `metadata.updated_at`, sent as `x-cards-db-version`.
- Catalog **schema**: manifest `cards.versions[].version`; patch schema is separate from timestamps. Adapter supports 12, not “largest advertised.”
- Card corrections: version ID **and finish** can change; CLI checks saved name/Scryfall identity but lacks a full correction engine.
- Personal data: raw JSON/unknown fields and `ps_untyped` preserved; explicit write mappings remain limited.
- API/auth: Firebase, upload endpoints/semantics; no registration call.
- SDK: pinned PowerSync 1.1.1 / better-sqlite3 12.4.1 at baseline; disposable sync DBs, HTTP/legacy checkpoints. Check installed versions before repair.
- Local formats: `mtg-decks/manabox-v1`, snapshot schema 2, plan version 1, Oracle cache; version independently.

SQLite `schema_version` counts DDL; `user_version` is app-controlled (readable catalogs observed 0). Neither substitutes for catalog schema or server version.

## App behavior and adapter gaps

Manifest offered full schemas 6–12; app selects supported 12 (native `0x1110138`), with absent-format branch `0x11101d0`. Patch checks cover schema/path/terminal revision/file version (pools `0x12b10–0x12b30`, `0x12218`). CLI uses full downloads, not recovered patch logic; its newer-patch-schema rejection is more conservative than app selection. Investigate whether an advertised older-format full catalog remains usable. If full data lags patches, metadata comparison stops; never spoof revisions.

App correction checks catalog freshness (`0x1112724`, `0x1112918`), calls repair at `0x1112a34`, startup `0x119c52c`; map query `0x1114294`. Both inspected catalogs contain 1,365 `card_inconsistencies_migrations` rows:
`cim_broken_cv_id, cim_broken_variant, cim_correct_cv_id, cim_correct_variant`.
Normal/foil/etched fallback diagnostics are evidence of possible repair needs, not permission to pick a fallback. Nulls, chains, ambiguity and artwork/faces need interpretation.

Personal `_manabox_migrations`/foreign-key SQL is app-local, not a cloud upgrade recipe. Fresh SDK caches avoid local migrations, not business-schema changes. Review `ps_data__*`/`ps_untyped` internal accesses on SDK upgrades against pinned source; [SDK guidance](https://github.com/powersync-ja/agent-skills/blob/main/skills/powersync/references/sdks/powersync-js.md) may describe newer versions.

[Catalog comparison](../integrations/manabox/compatibility/catalog-comparison-2026-10-16.json): revision 1790147028 → 1792071886 added 346 versions, removed none, unchanged DDL. Version 117191 kept Scryfall printing ID but changed Oracle grouping/name Germ → Phyrexian Germ. None of 2,536 rows in the inspected 24-deck mirror was affected.

Unknown-field preservation does not establish creation/PATCH/copy semantics. A partial HTTP-200 tag assignment exposed required `owner_id`; adapter now includes it. Empty tables cannot reveal absent required fields. Equality against the same changed catalog cannot prove stable card identity; quantity-only PATCHes omit `dc_cv_id` and are not account-wide reference audits. Same-shaped semantic changes may evade all schema checks.

## Diagnose

1. Preserve diff, drafts, catalogs and original receipts; identify exact operation/error and affected layer.
2. Read current implementation. Inspect `doctor --json` (may refresh credentials), `catalog status --json`, `diff --json`, `snapshots list --json`, `receipts list --json`. Cached reads are not independent cloud observations.
3. For unresolved uploads, reconcile observation-only; acknowledge partial state only after understood differences and scoped authorization. Retain timeout uncertainty.
4. Use `catalog update` for data changes; force only for diagnosed refresh/corruption. Investigate unsupported keys/schemas, unchanged or mismatched revisions instead of repeated downloads.
5. Compare saved evidence with relevant app/pinned SDK behavior. Preserve incomplete-read coverage; continue unaffected local work.

### Read-only inspector

Python SQLite `mode=ro`, no network/mutations. Supply readable, not encrypted catalogs:
```sh
python3 agent/integrations/manabox/compatibility/inspect.py catalogs \
  --before /path/old.sqlite --after /path/new.sqlite \
  --library decks/manabox --snapshot /path/snapshot.json.gz
python3 agent/integrations/manabox/compatibility/inspect.py snapshot /path/snapshot.json.gz
```

Find current catalog via `catalog status`; retained catalogs under private `catalog/`, snapshots under `accounts/<account-hash>/snapshots/`. Resolve account from config/store, not sort order. Hashes are content digests, not dates.

Reports compare DDL, added/removed/reidentified versions, reference mismatches, finishes/correction candidates. Library adds saved Scryfall references; snapshot adds covers/inventory/raw finishes. Face semantics/archive payloads remain uncovered. Details sampled (default 25), counts complete for supplied inputs. Exit 2 = findings; 1 = incomplete; 0 ≠ API certification. Snapshot inventory prints columns/counts, not row values, and covers captured untyped tables—not omitted server data.

## Repair and validate

- **Schema/key:** obtain candidate separately, inspect DDL/queries/SQLCipher/key and semantic identity; validate before replacing working catalog. Prefer full downloads unless patches are required or measurably worthwhile.
- **References:** use explicit corrections plus exact printing/app evidence. IDs/finishes affect deck-card/tag keys, covers/faces, inventory/proxies and links. Preserve quantities/tags/unknowns, handle collisions, rebase drafts/plans. Implement/test a scoped adapter or observe an authorized official-app migration; launching/updating the app may itself mutate cloud state.
- **API/data:** inspect ownership, PATCH/replacement/null/default/cascade/error semantics. Map affected fields, preserve unknowns, regenerate plans. Missing fields do not imply null; accepted partial entries must not be replayed. Use supported auth flow, never fabricated token/entitlement claims.
- **SDK:** review constructors/checkpoints/serialization/backing tables, test dependencies in isolation with real SQL/CRUD queues and unknown/untyped capture. Rebuild disposable caches, preserve durable evidence.

Add a realistic fixture; run `npm test --prefix agent/integrations/manabox`. If live mutation is authorized, use explicit temporary deck/folder/tag identities, seed/read independently, exercise affected behavior, compare other account state, then clean up. Reference changes require semantic printing checks as well as field equality. Record sanitized dated hashes/versions/adapter/error/results/gaps; keep raw account evidence private.

## Recovery limits and historical validation

Snapshots preserve evidence, not universal restore compatibility; downgrades may resurrect obsolete references. [ManaBox Cloud Sync](https://www.manabox.app/guides/sync/cloud-sync/) describes device-local recovery of that device's changes, not iPhone rollback of CLI edits. Some recovery needs selective adapters/vendor help. No scheduled watcher, forced update or new restriction is implied.

This maintenance package inspected retained catalogs, 24-deck mirror and independent snapshot. Five synthetic cases covered ID reuse, Scryfall mismatches, correction/finish candidates, removed references/new tables, empty-table uncertainty, redaction, missing files and read-only integrity. A network-disabled upload-cooldown test caught/fixed `cloud.mjs` callback/file-reader shadowing; the then-available npm suite passed. No live mutations occurred in that review.
