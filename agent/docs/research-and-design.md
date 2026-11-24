# Design history — 2026-10-15

Historical rationale, not routine instructions. Deckmaster's later [ManaBox workflow](manabox-workflow.md) supersedes file-only list storage.

Small purpose/router + four skills + persistent deck intent + read-only card lookup separates purpose, state, procedure and facts. Another personality/SOUL file would duplicate priorities. A dedicated host may help access later; first evaluate behavior independently.

## Sources and limits

- Fetched [OpenAI skills guidance](https://learn.chatgpt.com/docs/build-skills) and [prompt guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra): narrow triggers/progressive disclosure. Vendor guidance, not measured Deckmaster benefit.
- Fetched [Wizards February 2026 update](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026): expectations distinct from legality; dated, not frozen rules.
- [Scryfall list schema](https://github.com/scryfall/api-types/blob/main/src/objects/List/List.ts) supports pagination. Syntax/API/Tagger pages returned 403; API access worked after approved DNS/network escalation. See [validation](validation.md).

Read-only local research:
- `/Users/openclaw/Workspace/agents/sentinel/skills/architect-steward/SKILL.md`: one owner per idea; inspect tool/output design.
- `/Users/openclaw/Workspace/assistant-platform/prompt-lab/README.md`: fresh repeated/held-out cases, fixed surfaces; shared writable notes caused cross-run contamination.
- `/Users/openclaw/Workspace/state/prompt-lab/results/c14/gtd/REPORT.md`: wording changes mixed (duplicate handling 0/3→3/3; errand routing 3/3→0/3).
- `/Users/openclaw/Workspace/state/prompt-lab/results/c15/judgment/REPORT.md`: mixed outcomes, excluded no-reply run.

Small non-deckbuilding samples support experimental discipline, not universal wording winners. Existing labs/agents were unchanged.

## Hypotheses and portability

One multimode search skill avoids competing routing; split only if traces justify it. Persistent accepted/assumed/speculative intent should reduce recency drift. Alphabetical facts with coverage avoid popularity masquerading as relevance. Keep faces/printing identity; leave role, social and bracket judgment to reasoned review, not automated scores.

Repository skills currently route through AGENTS, not native installation. A host may link source folders into its discovery root while retaining relative resources. ChatGPT uploads need separate tools/persistence. Future adapters could expose `search_cards(query,max_pages,unique)` and `get_card_exact(name)`; no MCP/custom GPT/background process/OpenClaw agent was deployed. [Labs](../labs/README.md) defines evaluation.
