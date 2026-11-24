# Verification before evaluation

Retrieve exact names with `scryfall.py named`; do not silently choose a fuzzy match. Record the returned canonical name and Oracle ID, including alternate-name or reskin relationships when relevant. Preserve all card faces and use the top-level color identity; a front face's color or cost alone can mislead.

Exact lookup may return cached canonical facts. Preserve its retrieval timestamp; do not refresh merely because it is old. Use `--refresh` only for an explicit fresh lookup or when the task requires fields absent from the canonical cache. `--offline` prevents fetching even on a miss. The shared cache intentionally omits prices, legalities, Game Changer flags, and printing-specific URLs. See `../../../docs/card-cache.md`.

For finalists record mana cost/value, type, exact Oracle text or saved source, identity, paper availability, Commander legality, retrieval date, and Scryfall URL. Treat prices as timestamped printing-specific estimates, not a guarantee of a purchasable copy or complete deck cost. `game_changer` is useful evidence when present, not a complete bracket judgment; a missing field means unknown.

For an interaction, explain the events in order: what is cast, what is copied, who owns/controls it, what zone it moves through, which triggers occur, and applicable targets, timing, duration, and costs. Copying a spell is not by itself casting it. Permission to cast and ability to pay are separate. Avoid flattening play/cast, token/card, or enter/cast into interchangeable terms.

Use the returned `rulings_uri` and current official Comprehensive Rules or release notes for nontrivial interactions. The helper returns that URL but does not fetch rulings. When sources do not settle the issue, mark the interaction unresolved and do not build a crucial slot around it as proven.

Before calling a final list compliant, check deck size including commanders, singleton exceptions, combined commander identity, commander eligibility and partner/background compatibility, current bans, and the stated table exceptions. Check the current Wizards bracket guidance and Game Changers list separately from card legality. Report the date and sources, and any missing coverage. No tool in this suite certifies these checks automatically.
