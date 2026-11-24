# Card cache

Canonical Oracle facts live under `.card-cache/oracle/<oracle-id>.json` in the decks repository (or `DECKMASTER_CARD_CACHE`): canonical name/layout, cost/value, types, Oracle text, colors/identity, keywords, stats, produced mana and face equivalents; retrieval time/source URL.

Canonical records exclude images, artist/set/collector/flavor, prices, printings, legality and Game Changer status. They are Git-ignored and never uploaded. Oracle facts can receive errata: stable, not immutable.

**No TTL or age-triggered network work.** Exact-name lookup uses an unambiguous cached record with its original timestamp. Missing/ambiguous records fetch normally; `--offline` prohibits even that. `--refresh` forces named retrieval. Cached legality remains dated; absent dynamic fields remain unknown.

```sh
python3 agent/skills/commander-search/scripts/scryfall.py named 'Cursed Mirror' --offline
python3 agent/skills/commander-search/scripts/scryfall.py named 'Cursed Mirror' --refresh
python3 agent/skills/commander-search/scripts/scryfall.py named 'Insight Engine' --offline --view rules
```

Use exact-name lookup for one card rather than searching across whole lists. `--view rules` keeps exact Oracle text, faces, stats and identity while omitting printing/pricing payloads; `--view full` remains available. Neither view changes cache contents, freshness policy or missing-field warnings.

For broad discovery, `search ... --view names --limit 40 --output /tmp/results.json` displays an index page and saves the full retrieval once. `inspect /tmp/results.json --view names --offset 40 --limit 40` continues locally; `inspect /tmp/results.json --name 'Exact Name'` reads selected complete rules. Use `--view full` for saved art/printing fields. Display limits expose their range and `next_offset` separately from retrieval coverage. These temporary search files retain original coverage/provenance and are not a second durable cache. Inspection of a partial result remains partial.

Search always queries Scryfall; retrieved pages populate canonical facts even if search is partial. Coverage comes from the response, not cache size. Already-requested online results update timestamps without extra freshness calls; older observations cannot replace newer ones.
