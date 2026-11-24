# Deck audit and opening-hand lab

Read-only standard-library tools. Human annotations explain role, mana investment,
condition and reason per card. They are not automatic Oracle-text classifiers.
Use the existing Deckmaster CLI for facts retrieval, tags, mutations and sync.

```
python3 agent/tools/deck-audit/audit.py path/to/deck.json path/to/annotations.json
python3 agent/tools/deck-audit/hands.py path/to/report.json --seed 17 --count 6
python3 -m unittest discover -s agent/tools/deck-audit/test -v
```

The auditor requires an annotation for every playing card, binds exact names to
pinned Oracle IDs, rejects missing/ambiguous identities and excludes tokens from
name resolution. Side/maybe boards never enter playing counts. Quantities include
real plus proxy copies. Commander is reported but excluded from library access.
Front-face lands and actual land MDFCs are separate; transform backs aren't extra
land options. Printed MV and role mana are separate, e.g. evoke, equip and X spells.
`mana` is deployment plus the first paid activation for the described use, excluding
other cards' costs; condition text retains delays and prerequisites. Optional discounts
are described, not assumed. Tap opportunity costs are explained rather than added
to printed costs. `standalone` is an operational floor without another engine piece;
normal legal targets, survival, colors and summoning sickness still matter. Combat,
graveyard, draw-threshold and specific-board gates are conditional. Role assignment
remains a reviewable judgment, not a proof or universal taxonomy.

Per-role unique slots overlap across roles: NEVER sum them as deck size. A clone is
not automatically counted as ramp, draw and removal. Conditional mana engines and
late infrastructure are not credited as early ramp. Draw, non-draw advantage and
selection are separate. Land utility modes and colors must be reviewed alongside
land supply; spending a land card as interaction means not playing it as a land.

Exact hypergeometric outputs measure cards SEEN with seven kept cards and one draw
per turn, including multiplayer Commander turn one. No mulligans/card effects are
modeled in those probabilities. They do not predict land drops, spell casting or
win rate. Color-source notes are explicit human classifications, not a pip-ratio
mana solver. No full-game or social simulation is implemented.

The hand sampler is a separate finite diagnostic: shuffle seeded library; keep 2–4
land options, otherwise one free redraw then keep regardless. This deliberately
simple policy is not recommended mulligan strategy. It records rejected hands and
five subsequent draws. Human sequencing must account for actual text and consume
the draw stream correctly if any draw/scry effects are used. Six hands cannot measure
consistency. An annotation change cannot manufacture observed gameplay.

Generate annotations and reports in temporary scratch outside the repository.
Consolidate only meaningful decisions, uncertainties and experiments into project
notes, then discard diagnostics. Tests use small synthetic inputs, not preserved
user-deck reports. The shared canonical cache supplies card facts; historical
project snapshots are not a second fact store.
