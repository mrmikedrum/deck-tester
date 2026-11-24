# Search patterns

## Tool

From the repository root, with Python 3, Node 22+, and network access:

```sh
python3 skills/commander-search/scripts/scryfall.py named 'Cursed Mirror'
python3 skills/commander-search/scripts/scryfall.py search 'legal:commander game:paper id<=wur o:copy' --max-pages 2
python3 skills/commander-search/scripts/scryfall.py search 'legal:commander game:paper id<=wur otag:copy' --max-pages 2
python3 skills/commander-search/scripts/scryfall.py search 'legal:commander game:paper id<=wur o:copy' --max-pages 2 --view names --limit 40 --output /tmp/copy-candidates.json
python3 skills/commander-search/scripts/scryfall.py inspect /tmp/copy-candidates.json --name 'Cursed Mirror'
```

Use the name index to navigate a large retrieval, then inspect exact rules before judging candidates. `inspect` reads the saved result without fetching; `--view full` exposes its printing/art fields. Follow `next_offset` with `inspect FILE --view names --offset N --limit 40` to continue the index. Display paging is separate from Scryfall pagination: all views preserve source coverage and warnings, and `--output` saves full data regardless of the displayed view. Unflagged calls retain the existing full JSON output.

The page cap is deliberate. Increase it when full retrieval is wanted. Save working JSON only to temporary scratch outside the repository; consolidate consequential findings into project notes. The helper has no deck mutation, purchases, authentication, recommendation ranking. It automatically caches canonical card details separately from printings; see `../../../docs/card-cache.md`. Exact-name lookup can return a cached canonical record regardless of age; use `--refresh` for current printing/legality data or `--offline` to prohibit fetching cache misses. It uses a conservative 150 ms inter-request delay, explicit headers, and stops on network/API errors, including rate limiting. Consult current Scryfall API policy before expanding throughput. For very large repeated jobs, investigate bulk data rather than making thousands of individual requests.

## Query construction

Use `id<=wur` for cards within Jeskai color identity, not `c:wur` (card color is a different property). Omit the identity restriction while exploring unconstrained commanders. `legal:commander game:paper` is a default paper card pool, not a substitute for checking commander eligibility or Rule Zero exceptions. `mv<=3` can narrow a role to early plays; mana value alone does not measure activation/setup costs.

Oracle routes can include `o:copy`, `o:"you may cast"`, `o:"you may play"`, `o:"don't own"`, and `o:"from exile"`. Use parentheses around alternatives, for example `(o:"you may cast" or o:"you may play")`. Search both wording families when the distinction matters, then inspect the actual text. `fo:` searches full Oracle text including reminder text when reminder wording is relevant.

`otag:` addresses functional tags; `atag:` addresses illustration tags. Tags are community discovery aids, not rules proof or a complete taxonomy. Confirm a tag exists on Tagger or through successful results before relying on it. An invented or empty tag is a failed hypothesis, not evidence that the desired cards do not exist. Do not assume art tags apply to every printing: use `--unique prints` for art-specific work, inspect the actual printing, and deduplicate by Oracle ID only after recording the chosen art. Flavor text (`ft:`), names, artists, sets, and art can each capture different aspects of a theme.

Keep query families separate initially so you can see which one contributed candidates. Use negative filters only after inspecting the false positives; excessive exclusions can hide the unusual card you wanted. Record the reason for each broadening or narrowing.

## Discovery beyond keywords

For copying, separately explore spells copied versus cast, permanents entering as copies, copying tokens, legendary restrictions, and rewards for the resulting object. For opponent cards, distinguish ownership, control, exile permissions, and battlefield theft. For a flavor such as a haunted theater, explore roles in the story, visual motifs, transformations, temporary appearances, and mechanical performance—not just cards named “theater.”

After one useful batch, ask what new route would change the recommendation. Stop when enough fitting candidates are available for the current question or new routes stop adding useful candidates; state what you did not cover. “Diamonds in the rough” means surprising fit, not an arbitrary low-popularity cutoff.

## Evidence status

Scryfall documentation URLs returned HTTP 403 during initial research. Query syntax in this reference is a working recipe; the validation note records the subset exercised against the live API. Consult [syntax](https://scryfall.com/docs/syntax), [Tagger tags](https://scryfall.com/docs/tagger-tags), and [API documentation](https://scryfall.com/docs/api) when accessible. Never claim every recipe or tag has been tested.
