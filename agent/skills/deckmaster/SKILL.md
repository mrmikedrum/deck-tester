---
name: deckmaster
description: Build and refine Magic Commander decks with Mike through exploration, card discovery, draft iteration, Forge goldfishing and game feedback. Preserve the project's vision, challenge existing card choices, and prioritize distinctive, fun games over generic power.
---

# Deckmaster

Use this as the entrypoint to the repository's Commander workflows. Follow [AGENTS.md](../../AGENTS.md) for priorities, authorization and project hygiene. Find the active project through the project index (decks repository: `projects/index.json`); for deck decisions, read its approved vision and current state, then relevant consolidated notes. A single-card question stays a single-card question.

Reuse guidance already present in the current context when moving between skills. Reopen it when changed, missing after compaction or needed to resolve uncertainty; following a link does not require repeating a read. Prefer exact-card lookups and selected search results over adjacent enriched-file lines or whole research dumps.

## Load only the relevant workflows

- **Explore possibilities:** [explore](../commander-explore/SKILL.md) for concepts, commanders and alternative engines without rewriting approved intent.
- **Establish or revise intent:** [vision interview](../commander-vision-doc/SKILL.md) for probing questions and the only agent workflow allowed to edit `vision.md`; revisions require Mike's permission.
- **Find or verify cards:** [search](../commander-search/SKILL.md) for Scryfall, confirmed tags, mechanical adjacency and consequential card facts.
- **Build or improve a list:** [refine](../commander-refine/SKILL.md) for packages, cuts, roles, curve and mana. Substantive refinement includes discovery beyond the existing pool and comparison against incumbents; neither familiarity nor novelty earns a slot.
- **Test a list:** [goldfish](../commander-goldfish/SKILL.md) to pilot staged drafts in Forge against passive opponents, including during refinement before publication.
- **Learn from games:** [refine](../commander-refine/SKILL.md) to interpret real-game feedback or simulator observations and test improvements.
- **Resolve CLI incidents:** [maintenance](../manabox-maintenance/SKILL.md). Use [labs](../../labs/README.md) for evaluating agent behavior rather than deck performance.

Skills combine freely during the work: explore, search, edit, copy draft branches under the existing backup policy, goldfish and reconsider decisions as useful. They are not exclusive modes or a required sequence. Read their instructions, not merely these summaries. For list work, follow [ManaBox workflow](../../docs/manabox-workflow.md): publication is the reviewed checkpoint when the result is ready. Report the substantive decisions and tradeoffs, not merely a completion notice; list detail stays in ManaBox and completed decision history stays tool-managed.
