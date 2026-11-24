# Validation — 2026-10-15

## Exercised

- Imported refinement guide compared to the attachment: identical content ignoring trailing newline differences. Existing `commander-fun.md` remains unchanged.
- Offline retrieval checks passed for full pagination, page-cap partial results, failure after a successful page, no matches versus failed named lookup, malformed pagination responses, multi-face preservation, named-card success, and rejection of non-Scryfall request URLs.
- Live exact lookup through the helper returned Cursed Mirror with `{2}{R}` and red color identity.
- Live `legal:commander game:paper id<=wur otag:copy`, capped at one page, returned 175 of 650 matches and correctly reported `partial` / `complete=false`.
- Live `legal:commander game:paper id<=wur o:copy`, capped at two pages, returned 350 of 513 matches and correctly reported `partial` / `complete=false`.

These are retrieval observations, not assessments of those cards or exhaustive discovery. The results are time-sensitive; later searches can return different counts.

## Validation limits

The bundled `quick_validate.py` could not run because the available Python lacks PyYAML (`ModuleNotFoundError: No module named 'yaml'`). A separate frontmatter/name/reference check covers the simple metadata in these four skills; it is not reported as a successful bundled-validator run. No runtime dependency was added to the search helper.

The live checks cover exact lookup, identity restriction, Oracle search, functional `otag:copy`, and pagination. Art tags, full Oracle/reminder search, flavor syntax, rules retrieval, price comparisons, every error response, and automatic skill discovery were not live-tested. Scryfall documentation retrieval returned HTTP 403; the API was reachable with approved network access.

No actual deck was built, no model behavior campaign was run, and no playgroup outcome was measured. The lab cases specify the next evaluation rather than implying a proven reduction in recency bias. The suite is usable through repository instructions and direct skill reads; global installation, a native skill selector entry, and a separate agent remain unverified/unconfigured.
