---
name: commander-search
description: Discover new Magic cards and alternative synergies beyond an existing pool during building or refinement; use Scryfall, functional/art tags and mechanical adjacency, or verify exact card facts.
---

# Search

Read the active project's vision and state and relevant preferences (decks repository: `docs/mikes-deckbuilding-preferences.md`). Use [query patterns](references/search-patterns.md) for discovery and [verification](references/verification.md) for consequential card/interaction claims.

Choose the task:
- Theme: translate fantasy into mechanics, story roles and visual/flavor avenues; commander optional.
- Role: thematic infrastructure for a bottleneck and usable turn.
- Adjacency: search what an engine produces/changes—objects, ownership, zones, events—not just its keyword.
- Exact lookup: verify a named card without a broad campaign.

Discovery uses complementary Oracle, confirmed tag and adjacent-mechanism routes; art/flavor adds a separate route when relevant. Rank fit and playable floor rather than popularity, recency, obscurity or tag count. Keep broad exploration before restrictive filters.

Existing decks, candidates and prior results are seeds, not an exhaustive universe. For continued discovery, vary the question: what resources are produced or spent, which events/objects/zones change, what feeds the engine, what benefits from its byproducts, and what independently supplies a needed role? Inspect relevant Tagger categories for additional verified routes rather than reusing a fixed handful. Loosen incidental filters while preserving hard boundaries; separate printing-specific art fit from mechanical fit. Recent research can be reused, but stale angles and repeated near-identical pools warrant expansion. Novelty earns no automatic inclusion and a new route is not permission to change the vision.

From the repository root, use `python3 skills/commander-search/scripts/scryfall.py`. For broad results, save full data while displaying a name/cost/type index; inspect selected cards locally with complete rules rather than dumping the whole result or fetching it again:

```sh
python3 skills/commander-search/scripts/scryfall.py search 'legal:commander o:proliferate' --max-pages 2 --view names --limit 40 --output /tmp/proliferate.json
python3 skills/commander-search/scripts/scryfall.py inspect /tmp/proliferate.json --view names --offset 40 --limit 40
python3 skills/commander-search/scripts/scryfall.py inspect /tmp/proliferate.json --name 'Evolution Sage' --name 'Grateful Apparition'
python3 skills/commander-search/scripts/scryfall.py named 'Insight Engine' --offline --view rules
```

The name index locates leads; evaluate candidates from exact rules, not remembered effects. `--view full` retains all retrieved fields, including printing/art data; the existing default remains full JSON. Views retain coverage, warnings and source timestamps; saved-result inspection never fetches. Display limits expose `displayed_cards`, `view_total_cards` and `next_offset`; retrieval completeness does not mean every result has been inspected. Missing names are absent from that saved result, not proof the card doesn't exist. Track query/date/pages in a temporary [ledger](../../templates/card-ledger.md), then retain only consequential findings and unresolved coverage in project notes. A complete query is not exhaustive concept discovery. Stop repeated unavailable-source retries.

Offer manageable batches with link, specific fit, role/timing and drawback. Before promoting a search hit to a recommendation, apply Mike's [thematic resonance standard](../../docs/mikes-deckbuilding-preferences.md#thematic-resonance): assess name, intended art and identity separately from mechanical synergy, and expose any substantial mismatch rather than assuming a reskin. Inspect artwork when the fit depends on it; unviewed art remains unverified. A full-set request needs all pages or an explicit gap. Verify finalists before recommending changes; raw hits remain scratch.

For list analysis use [enriched artifacts](../../docs/deck-artifacts.md). Publish curated proposals/workbenches via [ManaBox workflow](../../docs/manabox-workflow.md); [refine](../commander-refine/SKILL.md) owns coherent main-list changes. Preserve artwork-specific printings.
