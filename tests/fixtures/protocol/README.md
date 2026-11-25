# Protocol corpus

Real envelopes, as the browser receives them from `GET /api/view` (`{state, gen, view, decision, over, pilots, v,
error, answer, build}`), captured from Forge games with no credentials: a four-seat table, "You" driven by a scripted seeded policy,
the other three seats Forge's AI with the decks in `tests/fixtures/decks`. Snapshots are built by the bridge's own
`game.snapshot` and `game.envelope`. Files are numbered in the order the browser would have seen them and named for
what they show (`015-play-opponent-spell-targets-me.json`).

`index.json` is the map: per file its coverage `tags`, the `answer` the policy sent for it (the body the browser
POSTs to `/api/answer`: `{key, id, answer}`, with `key` from `game.key` and `id` the decision's; `null` where an override or nothing was sent),
plus the corpus's `coverage` (tag to files) and `shapes` (per object type, the keys always present and the keys that
come and go). The shapes are what `tests/test_protocol_corpus.py` holds the live engine to.

## Regenerate

```bash
python3 -m tests.protocol_capture --out tests/fixtures/protocol --games 2 --dump /tmp/protocol.json   # ~20 minutes, needs Forge
python3 -m unittest tests.test_protocol_corpus -v
```

Saving replaces only the files the last `index.json` listed (the new corpus is staged first); other files stay.
`--add-label-only-choice` adds one envelope after the last instead of regenerating: a `choose` Forge asks by label
only (a Thriving land's colour, with no `refs`), which the main capture's policy does not reach.

`--from-dump FILE...` rebuilds the corpus from earlier `--dump` files without playing; the checked-in corpus was merged
that way from four runs, because any one game may stall or miss a rare feature (commander damage, an attack on a
planeswalker). The policy and the engine's seeds are fixed, but Forge's AI seats run on their own threads, so a rerun plays a
different game: the corpus is a sample, and regenerating replaces it. The run stops when the goal tags in
`protocol_capture.GOAL` are seen or after 7 minutes, then a second short game ends (eliminations, game over). If Forge's
AI stalls the first game, what was captured so far is kept.

Each envelope is kept only when it shows a tag no earlier one did. `view.log` is trimmed to its last 12 entries (the
engine sends up to 60); nothing else is changed.

## Covered

Decision kinds: mulligan (and the bottom-of-library choose after it), play (lands, spells, morph, activated and mana
abilities, the commander from the command zone, and options with `details`), pay (explicit sources and
automatic), targets (cards and players), choose (with card and player refs, and by label only, with none), mode, confirm, order, number, attack (at players and at a
planeswalker), block. Decisions that are mine and ones I only watch (an opponent's spell or attack).

View: a stack with spells and abilities, opponent spells targeting my creature or me, targets that are cards or
players; combat with attackers, blockers, defenders as player names and as a planeswalker's id; counters (+1/+1,
-1/-1, loyalty, charge...), attachments, tokens, face-down permanents, copies, commanders in the command zone,
commander damage, poison, the monarch, a floating mana pool, my hand against others' `handCount`, empty zones,
players leaving the view as they lose (including me: after I lose, `players` no longer lists me and `players[0]` is
someone else), and the final `over` envelope. Startup envelopes: `no game`, `starting`,
`playing` with `view: {}`, a failed start (`state: "error"`), and a playing envelope while the bridge holds an error.

## Not covered

- `lost` on a player: the engine drops a player who has lost from `players` at once, so the flag is never seen.
- `choose` with `{name}` refs (naming a card): its option list is every card name, too big to keep.
- Seat counts other than four, spectators, two-commander (partner) decks.
- Overrides stand in for rules play: planeswalkers, tokens and a stocked hand are placed by override, then played.
- The `starting` envelope is the literal `Table.open` publishes (no engine involved), and `replay` is not part of it.
