---
name: manabox-maintenance
description: Diagnose ManaBox catalog, schema, auth, API or PowerSync compatibility incidents and repair the CLI; not routine deckbuilding.
---

# Maintain compatibility

Use the [runbook](../../docs/manabox-maintenance.md) for version axes, evidence, read-only inspection, adapter repair and validation. Read current code/workflow first; preserve pending/concurrent work.

Identify the affected layer rather than treating app releases, catalog data/schema, SDK and document versions as interchangeable. Status codes and version strings alone establish no contract.

Fix source adapters, never private DBs/state by hand. Use isolated fixtures, then a dedicated temporary cloud case only when authorized. Verify card identity as well as independent cloud fields when references change. Harmless additive fields need interpretation, not a blanket freeze.

Report observed behavior, repair, verification and remaining uncertainty; retain dated evidence privately when it contains account data. This skill grants no additional account, installation or cloud authority.
