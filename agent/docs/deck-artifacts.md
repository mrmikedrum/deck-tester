# Artifacts and imports

`bin/deckmaster manabox` is the only command; no `mb` alias. Implementation remains under `agent/integrations/manabox`.

## State versus views

- `deck.json`: lean editable sync mirror; derived card facts stay in the [cache](card-cache.md).
- `deck.txt`: quantity/name, printing/finish, grouped by board.
- `deck.enriched.txt`: same lines plus cached rules/cost/types/stats/identity/faces/provenance and tag/proxy annotations; missing facts explicit.

Use the enriched view for whole-list analysis. For one card, [exact cached lookup](card-cache.md) returns its complete rules without unrelated neighboring lines; `rg -A` is especially noisy because each enriched line already contains that card's facts.

Text files are generated, not live inputs. Copy/export outside the mirror before editing, then import explicitly. Rendering uses local cache/catalog only; regenerate after cache changes.

```sh
bin/deckmaster manabox deck export 'Deck name' --format enriched --output /tmp/draft.txt
bin/deckmaster manabox deck import 'Deck name' --file /tmp/draft.txt --replace --dry-run
bin/deckmaster manabox deck import 'Deck name' --file /tmp/draft.txt --replace
```

Imports stage locally; [workflow](manabox-workflow.md) owns publication. **Replacement covers all boards:** an excerpt removes omitted cards. Notes/settings survive.

## Syntax

`QUANTITY Exact Name [(SET) COLLECTOR_NUMBER] [*F*]`

Native headers: `// COMMANDER`, blank line then unheaded main, `// SIDEBOARD`, `// MAYBEBOARD`. Default main; a blank after commander cards switches to main. Also accepts case-insensitive `# commander/main/side/maybe`, bracketed/bare sections and mainboard/deck/sideboard/maybeboard aliases. Unknown headers fail.

Enriched lines append ` | {"facts":{...},"tags":[...]}`. Everything after the first literal ` | ` is ignored, even malformed/stale annotations. Generated JSON escapes multiline rules. Annotation edits never change tags, proxies or finishes; use JSON/CLI. Handwritten facts need verification/regeneration.

## Metadata

- Exact set/collector selects catalog printing; set-only must be unambiguous. Unknown/ambiguous choices fail.
- `*F*` = foil; `*E*` = etched (native-app support unverified). Explicit printing without finish marker = nonfoil.
- Unspecified printing/finish preserves an unambiguous retained card on the **same board**; new cards get catalog defaults. Retained tags/proxies survive unambiguous matching.
- Multiple-printing ambiguity, unsupported finishes and splitting retained metadata across rows fail rather than guess. Use `card move` for metadata-preserving board moves.
- Removed rows lose assignments. New-deck text imports cannot recover tags/proxy splits from annotations; text is not a complete archive. Basic/enriched imports deliberately have identical effects.

## Compatibility evidence

[Official ManaBox import guide](https://manabox.app/guides/decks/import-export/) documents optional set/collector lines. Mike's native Timelines export is `agent/integrations/manabox/test/fixtures/timelines.txt`: 2 commanders, 98 main, 18 side, 20 maybe, foil/split names/hyphenated collector numbers; plain/enriched round trips tested. Changed output has not been reimported into the phone app. Use plain export for native import; enriched annotations are Deckmaster-only.
