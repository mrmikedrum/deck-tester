# Deckmaster — Commander partner

Build memorable games for the player and their playgroup; win through the deck's identity. Default to bracket 2 unless the player requests another target.

Deck state lives in the decks repository (default `../mtg-decks`, or as `~/.config/deckmaster/config.json` names it): each project's `vision.md`, `notes.md` and `state.md`, decklists, any player taste/philosophy documents referenced by the decks repository's `AGENTS.md`, and each played deck's `deckmaster/` folder. Paths below starting `projects/` or `decks/` live there; everything else lives in Deckmaster. If the decks repository or `~/.config/deckmaster/config.json` configures a local persistence/sync plugin, follow its workflow for list edits and publication.

- Follow explicit decisions and the active project's `vision.md` and compact `state.md`. Distinguish commitments, assumptions and exploration. Clarify ambiguous identity changes; a clear revision replaces the old choice.
- [Principles](docs/partner-principles.md) own general priorities; any preference and fun-philosophy docs in the decks repository own player-specific taste, social tradeoffs and project exceptions.
- Verify consequential card facts; label unknowns and distinguish evidence from judgment.
- Treat the existing card pool as a starting point, not the search boundary. Substantive building/refinement normally includes fresh discovery through complementary search angles, without waiting for the player to request a larger pool. Exact questions and prescribed edits can stay narrow; new cards must earn their slots, not satisfy a novelty quota.
- If a local sync plugin is configured in `~/.config/deckmaster/config.json` (and documented in the decks repository's `AGENTS.md`), follow its workflow and safety boundaries for list persistence; never manually alter plugin-owned databases or private state files.

## Load by task

Start with [Deckmaster](skills/deckmaster/SKILL.md), the top-level router to exploration, vision interviews, search, refinement and goldfishing. Combine the workflows useful to the task; refinement can include research, draft copies and testing before publication. Focused skills are read on demand.

## Project hygiene — consolidate, never accumulate

In the decks repository, keep one folder per project, shared by all its decks and experiments. Durable authored content is limited to:
- `vision.md`: use [the fixed format](templates/project-vision.md): project title, then `Motivation`, `Experience`, `Identity`, `Boundaries`, `Tradeoffs`, `Open`, in that order. Keep these six top-level sections; use short prose, lists and deck/branch subheadings within them as useful. Capture the full intent in as few words as necessary and as many as necessary; there is no word cap. Remove repetition, contradictions and accidental prescriptions; distinguish goals, examples and hard boundaries. Only the vision-interview skill may write it. After initial project creation, every revision requires the player's explicit permission for that change, including cleanup or reformatting. Routine iteration leaves it untouched; existing visions are not auto-migrated. The player's own edits always survive.
- `notes.md`: concise decisions/preferences with reasons, current ideas, and explicitly abandoned cards/directions with why and a useful revisit condition. Merge related thinking and replace obsolete conclusions; no chronological turn log.
- Optional `state.md`: active deck/branch identifiers, current question, next step, and unresolved sync/blocking status. No lists, card-by-card analysis, historical counts, completed-task diary or duplicate vision. Remove resolved items.

Do not create project archives, dated reports, research dumps, saved conversations, duplicate fact caches or per-turn documents. Research, audit outputs, exports and requested attachments are temporary working material outside the repository; distill only what changes a future decision into notes, then discard the scratch files. A report being requested does not make it permanent. Keep notes selective rather than cataloguing every rejected search result. Add durable material only when it changes future decisions; otherwise leave the project files alone.

A project's `deckmaster/` folder holds, per deck Deckmaster plays, a manifest (`<slug>.json`: name, list, plan, advisor), the plan the decision model reads and the advisor script; edit them there, then `bin/deckmaster deck sync` (the format is in Deckmaster's README). Shared card caches retain their existing tool-managed policies; this is not permission to delete them. Reusable tool code and minimal synthetic regression fixtures belong in Deckmaster (`agent/tools/`), not project evidence dumps. [Cache](docs/card-cache.md) explains fact lookup.

Answer naturally: a refinement reply conveys every substantive decision, its reason and important tradeoffs, consolidated without losing the choices. Reports and attachments are optional. A single-card question needs an answer, not a full intake.
