"""A platform for a deck's advisor: the script that comes with a deck and tells the decision model, at a
decision, the one or two things about the position that its designer knows matter.

The designer knows the deck's pieces. The script declares them and the conditions under which to speak:

    from goldfish.advice import Advisor

    adv = Advisor()
    adv.role("doubler", "Doubling Season", "Parallel Lives", "Hardened Scales")
    adv.when(board=["doubler"], castable=["Marath, Will of the Wild"],
             say="Marath's token or counters come doubled while the doubler stays.")
    adv.when(graveyard=["Fertilid"], castable_from={"graveyard": ["Fertilid"]},
             say="Fertilid can be cast from the graveyard right now.")
    advise = adv.advise

Conditions name cards or roles, by zone: board, hand, graveyard, exile, command, the stack (what is
waiting to resolve, matched by the card named in it), and what the current decision lets you cast or
activate (castable, castable_from). Every listed card or role must be present
("all of"); any_of= names one group of which any card or role, in any of the zones given, is enough. A
rule's text may be a function of the position, for numbers.
Nothing here parses card text on its own; roles are the designer's lists, with text_matches() available
when a role is better said as a phrase ("creates twice that many") than as names.
"""

import re
from typing import Callable, Dict, Iterable, List, Optional, Set, Union

Names = Iterable[str]
Text = Union[str, Callable[["Position"], Optional[str]]]

ZONES = ("board", "hand", "graveyard", "exile", "command", "stack")


class Position:
    """What the advisor can ask about: cards by zone, what the decision lets you play, counters, mana."""

    def __init__(self, state: dict, decision: dict, this_turn: List[dict]):
        self.state, self.decision, self.this_turn = state, decision, this_turn
        self.board: List[str] = [p["name"] for p in state.get("battlefield", [])]
        self.hand: List[str] = list(state.get("hand", []))
        self.graveyard: List[str] = list(state.get("graveyard", []))
        self.exile: List[str] = list(state.get("exile", []))
        self.command: List[str] = [n for n in state.get("command", []) if "Effect" not in n]
        self.stack: List[str] = list(state.get("stack", []))  # descriptions of what waits to resolve, top first
        self.mana: int = state.get("mana", 0)
        self.land_drop: bool = bool(state.get("land_drop", True))
        self.turn: str = decision.get("turn", "")
        self.kind: str = decision.get("kind", "")
        # What this decision offers to cast or activate, by the zone it comes from, read off the option labels.
        self.castable_from: Dict[str, List[str]] = {"hand": [], "graveyard": [], "exile": [], "command": [], "board": []}
        if decision.get("kind") == "play":
            for label in decision.get("options", []):
                if label == "pass":
                    continue
                if ": " in label and not label.endswith(")"):
                    self.castable_from["board"].append(label.split(": ")[0])  # an activated ability of a permanent
                elif label.endswith(" (from graveyard)"):
                    self.castable_from["graveyard"].append(label[:-17])
                elif label.endswith(" (from exile)"):
                    self.castable_from["exile"].append(label[:-13])
                elif label.endswith(" (commander)"):
                    self.castable_from["command"].append(label[:-12])
                else:
                    self.castable_from["hand"].append(re.sub(r" \((land|[a-z]+)\)$", "", label))
        self.castable: List[str] = [n for names in self.castable_from.values() for n in names]

    def text(self, name: str) -> str:
        return self.state.get("text", {}).get(name, "")

    def permanent(self, name: str) -> dict:
        return next((p for p in self.state.get("battlefield", []) if p["name"] == name), {})

    def counters(self, name: str, kind: str = "+1/+1") -> int:
        counters = self.permanent(name).get("counters", {})
        if kind in ("+1/+1", "P1P1"):
            return counters.get("+1/+1", counters.get("P1P1", 0))
        return counters.get(kind, 0)

    def tapped(self, name: str) -> bool:
        return bool(self.permanent(name).get("tapped"))

    def played_this_turn(self, name: str) -> bool:
        return any(f.get("card") == name and f["t"] in ("cast", "land", "activate") for f in self.this_turn)


class Advisor:
    def __init__(self):
        self.roles: Dict[str, Set[str]] = {}
        self.patterns: Dict[str, str] = {}
        self.rules: List[tuple] = []

    # ---- declaring the deck's pieces ----

    def role(self, role: str, *cards: str, text: Optional[str] = None) -> "Advisor":
        """A role played by these cards, and, if given, by any card whose text matches the pattern."""
        self.roles.setdefault(role, set()).update(cards)
        if text:
            self.patterns[role] = text
        return self

    def when(self, say: Text, *, board: Names = (), hand: Names = (), graveyard: Names = (), exile: Names = (),
             command: Names = (), stack: Names = (), castable: Names = (), castable_from: Optional[Dict[str, Names]] = None,
             any_of: Optional[Dict[str, Names]] = None, kinds: Names = ("play",),
             test: Optional[Callable[[Position], bool]] = None) -> "Advisor":
        """Say this when every listed card or role is in its zone (on the stack: named in something waiting to
        resolve; castable now, where asked), at decisions of these kinds. any_of maps zones to cards or roles of
        which any one is enough; test is any further check."""
        self.rules.append((say, {"board": board, "hand": hand, "graveyard": graveyard, "exile": exile, "command": command,
                                 "stack": stack, "castable": castable, "castable_from": castable_from or {},
                                 "any_of": any_of or {}, "kinds": tuple(kinds), "test": test}))
        return self

    # ---- matching ----

    def matches(self, name_or_role: str, card: str, position: Position) -> bool:
        if name_or_role == card:
            return True
        if name_or_role in self.roles:
            if card in self.roles[name_or_role]:
                return True
            pattern = self.patterns.get(name_or_role)
            return bool(pattern and re.search(pattern, position.text(card), re.IGNORECASE))
        return False

    def on_stack(self, name_or_role: str, item: str) -> bool:
        """A stack item names its card ("… (Princess Yue)" or in the text): the card, or any card of the role."""
        names = self.roles.get(name_or_role, {name_or_role}) | {name_or_role}
        return any(n in item for n in names)

    def present(self, wanted: str, cards: Iterable[str], position: Position) -> List[str]:
        """The cards among these that are the wanted card or play the wanted role."""
        return [c for c in cards if self.matches(wanted, c, position)]

    def holds(self, rule: dict, position: Position) -> bool:
        if position.kind not in rule["kinds"]:
            return False
        for zone in ZONES:
            for wanted in rule[zone]:
                if zone == "stack":
                    if not any(self.on_stack(wanted, item) for item in position.stack):
                        return False
                elif not self.present(wanted, getattr(position, zone), position):
                    return False
        for wanted in rule["castable"]:
            if not self.present(wanted, position.castable, position):
                return False
        for zone, wanted_all in rule["castable_from"].items():
            for wanted in wanted_all:
                if not self.present(wanted, position.castable_from.get(zone, []), position):
                    return False
        if rule["any_of"]:
            # one group: any listed card or role in any of its zones is enough
            found = False
            for zone, options in rule["any_of"].items():
                if zone == "stack":
                    found = found or any(self.on_stack(wanted, item) for wanted in options for item in position.stack)
                    continue
                cards = position.castable if zone == "castable" else getattr(position, zone)
                found = found or any(self.present(wanted, cards, position) for wanted in options)
            if not found:
                return False
        return rule["test"] is None or bool(rule["test"](position))

    def advise(self, state: dict, decision: dict, this_turn: List[dict]) -> Optional[str]:
        """The pilot hook: the texts of every rule that holds, in declaration order, or None."""
        position = Position(state, decision, this_turn)
        said = []
        for say, rule in self.rules:
            if self.holds(rule, position):
                text = say(position) if callable(say) else say
                if text:
                    said.append(text.strip())
        return " ".join(said) or None


def text_matches(pattern: str) -> str:
    """For role(..., text=text_matches("twice that many")): a phrase from the card text, matched loosely."""
    return re.escape(pattern).replace(r"\ ", r"\s+")
