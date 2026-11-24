---
name: commander-vision-doc
description: Interview Mike to discover a Commander project's motivating experience and tradeoffs, then create or explicitly revise its concise vision. Required for every agent edit to vision.md; not routine list tuning.
---

# Interview for a project vision

Read the existing vision, relevant consolidated notes and preferences (decks repository: `docs/mikes-deckbuilding-preferences.md`). Use [principles](../../docs/partner-principles.md) to support Mike's choices, not supply answers on his behalf.

## Write boundary

This is the only agent workflow allowed to create or edit `projects/<slug>/vision.md`, including formatting, cleanup and shortening. Mike can always edit his own file directly.

- During an explicitly initiated new-project creation conversation, create the initial vision from his answers without separate file-write permission. A passing idea is not a project, and an existing vision never becomes “initial” again through a rename, fork, new session or migration.
- After initial creation, obtain explicit permission for the particular vision revision. Show the proposed wording in chat and ask to save it. If Mike already supplies exact replacement wording and explicitly asks to apply it, that is sufficient permission; skip redundant questions.
- Approval of content followed by an explicit request to restructure it authorizes that formatting pass. Preserve its meaning and carry out the requested pass without another approval loop; seek approval only for changes beyond that scope.
- Permission to tune a list, explore a branch or clean documentation does not authorize vision edits. While approval is pending, keep only a short unresolved question in state—not a second vision in notes. Respect explicit new user choices without silently rewriting the file or executing incompatible list changes.

## Find the real motivation

Ask one to three pointed questions at a time, building on known answers. Probe ambiguity rather than marching through a form:
- What makes you want to play this instead of another deck? Describe the moment you are excited to experience.
- Is the named mechanic the attraction itself, or one possible way to create that moment? What would make a technically stronger version miss the point?
- Which thematic, mechanical and social commitments are essential? When two conflict, which gives way? For paired decks, what must feel shared and what should differ?
- What should opponents experience, and what ending would feel satisfying? Which boundaries are real versus provisional?

Challenge vague answers with a concrete tradeoff and reflect back the distinction in Mike's language. Commander, colors and implementation may stay open. Avoid turning the latest example into the new foundation or inferring a priority order he has not chosen. If useful, offer a few contrasting directions; use [search](../commander-search/SKILL.md) for card-dependent claims. An exact card question needs an answer, not this interview.

## Distill, then stop

Use [the fixed template](../../templates/project-vision.md): one project title followed by exactly these six `##` headings in order: `Motivation`, `Experience`, `Identity`, `Boundaries`, `Tradeoffs`, `Open`. Keep each section, using `None` or `Unresolved` where appropriate rather than inventing content. This repeatable structure is required; flexibility is inside each section. Use short prose, lists and `###` deck/branch subheadings as useful. Single-deck projects need no branch subheadings. Capture full intent in as few words as necessary and as many as necessary; **there is no word cap**. Preserve distinctions and examples that affect decisions, while removing repetition, contradictions and accidental prescriptions. Label illustrative mechanics as examples rather than requirements. Keep unresolved choices and assumed bracket 2 explicit. Card lists, counts, research dumps and operational status stay outside the vision.

Check the six headings and their order, then read the complete draft back in chat. Initial creation may save it with assumptions plainly marked; later changes follow the approval boundary above. Re-read the file immediately before an approved write to preserve Mike's intervening edits. Update only the approved scope. This skill does not authorize list changes or cloud writes.
