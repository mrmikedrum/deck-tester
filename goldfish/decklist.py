"""Read Commander decklists in the text formats Deckmaster and Moxfield export.

Accepted section headers: Deckmaster's `// COMMANDER`, `// SIDEBOARD`, `// MAYBEBOARD`
(a blank line after commander cards switches to the main deck), Moxfield's `~~Commanders~~`
style, and `# commander`, `[Commander]` or a bare `Commander` line. Card lines are
`QUANTITY Name [(SET) NUMBER] [*F*]`; anything after a literal ` | ` is an annotation and ignored.
Side and maybe boards are read but never played.
"""

import re
from dataclasses import dataclass, field
from typing import List, Tuple

BASIC_LANDS = {
    "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
    "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
    "Snow-Covered Mountain", "Snow-Covered Forest", "Snow-Covered Wastes",
}

_SECTIONS = {
    "commander": "commander", "commanders": "commander",
    "main": "main", "mainboard": "main", "deck": "main",
    "side": "side", "sideboard": "side",
    "maybe": "maybe", "maybeboard": "maybe",
}
_HEADER = re.compile(r"^(?://|#|~~|\[)?\s*([A-Za-z]+)\s*(?:~~|\])?:?$")
_CARD = re.compile(r"^(\d+)x?\s+(.+?)(?:\s+\([A-Za-z0-9]+\)(?:\s+\S+)?)?(?:\s+\*[A-Z]\*)?$")


class DecklistError(ValueError):
    pass


@dataclass
class Decklist:
    commanders: List[str] = field(default_factory=list)
    main: List[Tuple[int, str]] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.commanders) + sum(qty for qty, _ in self.main)

    def problems(self) -> List[str]:
        """Commander construction problems visible from names alone."""
        found = []
        if not 1 <= len(self.commanders) <= 2:
            found.append(f"expected 1 or 2 commanders, found {len(self.commanders)}")
        if self.size != 100:
            found.append(f"expected 100 cards including commanders, found {self.size}")
        counts = {}
        for qty, name in self.main:
            counts[name] = counts.get(name, 0) + qty
        for name, qty in sorted(counts.items()):
            if qty > 1 and name not in BASIC_LANDS:
                found.append(f"{qty} copies of {name} (fine only if the card allows any number)")
        return found


def parse(text: str) -> Decklist:
    deck = Decklist()
    section = "main"
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.split(" | ", 1)[0].strip()
        if not line:
            if section == "commander" and deck.commanders:
                section = "main"
            continue
        header = _HEADER.match(line)
        if header and header.group(1).lower() in _SECTIONS:
            section = _SECTIONS[header.group(1).lower()]
            continue
        card = _CARD.match(line)
        if not card:
            raise DecklistError(f"line {number}: not a card or section header: {raw!r}")
        qty, name = int(card.group(1)), card.group(2).strip()
        if section == "commander":
            deck.commanders.extend([name] * qty)
        elif section == "main":
            deck.main.append((qty, name))
    return deck


def load(path: str) -> Decklist:
    with open(path, encoding="utf-8") as handle:
        return parse(handle.read())
