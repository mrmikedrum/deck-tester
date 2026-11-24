# ManaBox collaboration

ManaBox is the shared review surface; local files are scratch/evidence. Review-ready lists belong in ManaBox, including labeled incomplete/oversized workbenches. Passing ideas can stay conversational.

## Resume and scope

Use `bin/deckmaster manabox` ([commands](../integrations/manabox/README.md)). Reads/edits stage locally; `pull` merges cloud changes and `push` uploads. Start with `diff --json`, then `pull --json` (first setup requires pull). Preserve conflicts and Mike's phone edits, including cuts and intentional holes. If unavailable/locked, continue scratch work with freshness/delivery explicitly unknown; wait for the existing operation rather than bypassing its lock.

Resolve the project through `projects/index.json`, then exact deck name, folder-qualified selector or ID with `decks list` / `deck show`. `decks/manabox/library.json` maps IDs to generated mirrors. Keep durable authored material in `projects/<slug>/`: one `vision.md`, consolidated `notes.md`, and optional current `state.md`, with the strict boundaries in [AGENTS.md](../AGENTS.md). Reports, exports, raw research and playtest diagnostics are ephemeral scratch outside the repository, not archives. Multiple decks/branches share that project and vision; create a new project only for a distinct project, not each iteration. Register additional deck IDs in the project index. Local project files are not cloud-synced; CLI-managed mirrors stay in `decks/manabox/` without authored companion files.

`Claw` contains drafts. Direct main-list refinement and review-ready sync have standing authorization unless Mike requests proposal-only work. Reuse existing drafts; copy established decks into Claw before editing. Promotion requires Mike's choice: copy the selected draft outside Claw to the agreed destination, preserving existing snapshots and the draft.

For a major pivot (~15+ nonland swaps or central mechanic/theme change), duplicate first if returning to the old direction is plausible. Rebuild abandoned unsuccessful drafts in place; routine iterations stay in one draft. When unsure, export a text backup outside the generated mirror.

Within this draft scope, agents may freely alternate discovery, list edits, draft copies, [Forge goldfishing](../skills/commander-goldfish/SKILL.md) and reconsideration before publishing, without another approval or a fixed skill sequence. Export the currently staged list to scratch for testing; it need not be published first. Publication is the reviewed ManaBox checkpoint once the work is ready, not a prerequisite for experimentation or an automatic requirement to run a simulation.

## Shared editing language

- **Main + commander:** current playing experiment; side/maybe are separate.
- **Side:** worthwhile cuts that could return. Prefer `card move ... --to side` to preserve metadata.
- **Maybe:** curated proposals from either partner or desired cards without a slot, not mandatory includes or raw search dumps.
- **Tags:** sparse role/concept counts and sublists (enabler/enhancer/payoff, ramp/interaction/advantage, useful deck-specific concepts). Usually avoid deck-specific labels for only 1–2 cards. Reuse definitions; renames affect the whole account.
- **Notes:** central pitch only, consistent with the approved project vision. Read before `deck notes --file FILE`, which replaces the field. Draft-sync authority is not permission to revise the vision; use the vision-interview skill and its approval boundary first for changes to intent.
- **Project state/evidence:** current branch identifiers, immediate question/next step and unresolved sync status only. Notes consolidate consequential decisions and ideas, not reports.

Preserve printings, finishes, proxies and tag assignments; disambiguate with board, `--cv-id` and `--finish`. Neither a sideboard cut nor a maybe proposal automatically belongs back in main.

## Publish safely

Accumulate one [CLI refinement](../integrations/manabox/README.md#iterative-refinements) per meaningful deckbuilding decision while iterating, not one retrospective explanation per turn. Packages can span any number of decks and be created, inspected, updated or deleted without a required review sequence. Before publication, reconsider the combined result against the relevant visions, fun and preferences; refine again if it drifts, then record a brief self-review with `review --reason TEXT` or `review --finalize --reason TEXT`. Later changes make that assessment stale. Lower-level tools remain available, with uncovered changes flagged for explanation. Quality warnings advise rather than block.

1. Check the local list as appropriate with `deck check --json`. Expected workbench incompleteness is publishable; distinguish it from mistakes. Cache timestamps bound legality claims; pairing, brackets and social fit require judgment.
2. Inspect `review --json` and `diff --json`, then `review --finalize --json` (or `push --dry-run --json`). Preparation merges remote changes: reassess any changed list and decision coverage.
3. Review the **whole** plan: push includes all pending workspace changes. Stop if it contains unrelated edits; preserve them. For requested deletion, prepare with `--allow-delete`.
4. Apply the unchanged returned plan: `review --finalize --plan 'PLAN_FILE' --json` (or `push --plan`). Stale plans need fresh review. Verified publication records pass history and clears active refinements; uncertain/failed publication keeps them pending.
5. Keep the actual outcome and any unresolved receipt/plan reference in state only while useful; CLI-managed receipts retain recovery evidence. `verified` means independently observed cloud state; `saved-offline` is local; `preview` is unsent.

Never manually edit ManaBox/catalog databases or private workspace/snapshot/plan/receipt files. Read-only DB inspection is for debugging/CLI development. Use the supported [artifact interface](deck-artifacts.md).

For uncertain/partial uploads, retain evidence and use observation-only `receipts reconcile`; never blindly replay. `--accept-current` requires understood differences and scoped acceptance. Authentication, restore, deletion and shared-definition changes stay within requested scope. The API lacks a verified atomic-batch/compare-and-swap guarantee; post-write verification detects, rather than prevents, final-interval phone conflicts.

Cloud snapshots exclude project Markdown. Identify the played revision when learning from games; use temporary exports for analysis and retain only meaningful observations/decisions in notes.

## Report

Make the recorded decisions the primary content of the chat response, not an attachment or a teaser for one. Lightly render the CLI's `delivery_brief` (or completed pass history when asked later): for each substantive decision, say what was chosen, why it won over meaningful alternatives, and the important tradeoff or uncertainty. Consolidate superseded choices while preserving consequential reconsideration: initially X, review revealed Y, settled on Z. Finish with the brief whole-pass assessment and publication status. This is a readable account of the recorded decisions, not raw JSON, a newly composed essay or a card-by-card swap list. Length follows the decisions, not an arbitrary brevity target; if necessary, split the account across chat messages rather than moving its reasoning into a file.

Lists/boards/tags carry list detail, not the rationale. Attachments are optional supporting detail and never the only home of a substantive decision's explanation. Completed passes live in CLI-managed history; project notes retain only future-relevant conclusions. Research/diagnostic scratch and optional reader-facing attachments remain temporary, not authored project archives. A local path is not Discord delivery; disclose failed delivery or unsynced work.
