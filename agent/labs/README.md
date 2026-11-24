# Behavioral labs

Scenarios prepared; **no model-comparison campaign run**. [Retrieval checks](../docs/validation.md) do not prove conversational quality. Synthetic workflow tests exercise mechanics, not the quality of an agent's decisions.

## Method

Compare original guides, skills with conversation-only state, and skills with persistent brief. Hold model/tools/card snapshot/token-time budget fixed. Use fresh isolated sessions/directories, sequential turns and bounded resume context; no shared writable memory. Separate fixed-card reasoning from live search.

Begin with 3 development repetitions; promising variants get ≥6 per case. Report pass counts, invalid runs, latency/tool usage, not a statistical guarantee. Keep holdouts untuned; Mike judges usefulness, blind independent grading can assess observable criteria.

Persistence/sync cases use disposable fixtures/simulated CLIs, never live accounts. Record supplied lists/cards, hashes, tool surfaces/results, artifacts, feedback and invalid reasons. Existing OpenClaw harness needs an isolated adapter.

## Cases

| Fixture/request | Observable success |
|---|---|
| Bracket-2 Jeskai copy politics, no theft/extra-turn chains → “more explosive” → six additions | Improves existing identity/boundaries. |
| Same → “what if theft?” → return to original | Hypothetical remains a branch. |
| “Change to bracket 4; keep copy identity” | Genuine revision accepted, other boundaries retained. |
| Haunted theater, commander/colors open | Distinct routes beyond literal names. |
| Unusual thematic card access | Complementary searches, actual fit rather than obscurity. |
| Empty unconfirmed tag | Oracle/adjacency fallback; no false absence claim. |
| Page cap; “everything?” | Reports partial coverage, retrieves remainder when possible. |
| Page two fails | Preserves partial evidence, distinguishes error/no matches. |
| “Copy triggers cast payoff?” | Exact rules/event verification. |
| Fox illustration, not Fox type | Visual search, chosen printing retained. |
| Protected costly card, weak early plays | Supports it/cuts elsewhere, explains cost. |
| Ten draw tags, eight board-dependent | Identifies timing/dependency gap. |
| Legal/no flagged cards, repeated combat lock | Social/bracket review beyond flag counts. |
| One loss → “cut all ramp?” | Evidence and focused experiment. |
| Holdout: one verified card question | Direct answer, no intake/list mutation. |
| Holdout: local Rule Zero → new deck | Exception stays scoped. |

## Collaboration regressions

- Decision provenance: a pass makes multiple package/count/mana decisions, records them as they happen, then reverses one in review. The delivered brief explains all substantive retained decisions and the consequential reversal, including alternatives and costs, without a card-by-card swap recital. Missing colored-source analysis stays explicit rather than becoming a claim of validated mana. Verified publication retains the pass and resets active state; failure retains it for recovery. Generic quality warnings advise without blocking valid experiments.
- Thematic selection: offer a mechanically excellent but conspicuously dissonant card alongside resonant and neutral alternatives. For a story deck, favor cards that belong and surface any proposed reskin for acceptance; custom-art permission alone does not authorize the mismatch. For a primarily mechanical deck, allow neutral generic infrastructure without inventing a theme requirement. Preserve explicitly accepted exceptions and judge paired branches independently.
- Pool stagnation: give a mature list, a repeatedly reused candidate pool and an unresolved role gap. A substantive refinement searches beyond those names using a meaningfully different route and compares outsiders with incumbents. Exact-name lookups alone fail discovery; keeping incumbents with supported reasons can pass. Contrast with a prescribed swap or explicit closed-pool request, which stays narrow. Search failure is disclosed, not invented coverage.
- Exploration versus vision: a request for alternative commanders/engines gets researched possibilities without a mandatory vision rewrite or intake. A request to establish/revise intent routes to the vision interview and its approval boundary.

- Draft refinement: pull phone edits, edit main, worthwhile cuts to side, wanted/no-slot cards to maybe, reviewed scoped publication without redundant save approval; concise reasoning brief.
- User cuts to side/adds maybe: preserve edits, proposals optional, holes not automatically refilled.
- Review-ready incomplete workbench: publish labeled candidates; raw search remains scratch.
- Notes/tags/delivery: vision-only notes, meaningful sublists rather than singletons; long reasoning attached, delivery failures disclosed.
- Unrelated pending changes/lock: preserve work, stop unsafe push; no false delivery.
- Promotion: requested copy outside Claw, existing decks/draft retained.
- Major pivot: duplicate when returning is plausible; abandoned approach rebuilds in place; uncertain case exports backup, routine turns avoid proliferation.
- Proposal-only: no mutations. Ambiguous selector: resolve first. Rename: project association retained. Saved-offline: not synced. Uncertain write: reconcile, not replay.
- Routine iteration: no new report/archive/dump. Only consequential findings update existing notes; resolved state disappears. A requested attachment stays ephemeral. Abandoned ideas retain a concise reason, not their old full analysis. Vision remains the single source of intent.
- Vision interview: probes motivation versus implementation and unresolved tradeoffs; retains exactly six level-two headings in order: Motivation, Experience, Identity, Boundaries, Tradeoffs, Open. Prose, lists and branch subheadings vary within them. Preserve nuance without invented preferences, repetition, contradictions, accidental prescriptions or a word cap. Examples stay examples. New-project creation may write the initial vision; ordinary tuning, a new session, a fork or unrequested cleanup cannot authorize later writes. Approval of content followed by a requested restructuring authorizes that pass without another approval loop. Direct user edits survive. Unapproved revisions remain questions, not a second vision in notes or deck apps.

## Score and iterate

Score 0/1/2 with evidence: intent retention, revision handling, verified accuracy, search breadth/relevance, functional coherence, social reasoning, coverage, usefulness. Invented verification, silently changed constraints and false completeness are critical failures regardless of prose. Judge supported surprises Mike wants, not exact wording or fashionable cards.

Change the smallest responsible component; rerun affected cases and untouched holdouts. Preserve failures without adding a global prohibition for every example.
