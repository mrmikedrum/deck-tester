"""The decision model at a table, where the other players act. The goldfish decider (model.Decider) stays as it is,
measured against passive opponents; this one changes only what differs at a table, through the decider's hooks:
what the model reads (the table, and the other players' boards) and, in the engine, forks in which the other
players block. Measure a change here at a table (bench/table_fidelity.py, table reports), not on the goldfish bench.
"""

from collections import OrderedDict
from typing import Dict, List, Optional

from . import model, render

TABLE = ("Commander game against {opponents} opponents at 40 life who play their own decks: they cast spells, "
         "attack, block and answer threats. Develop as the plan says; attack where damage gets through without "
         "losing what the plan needs; the aim is to be the last player standing.")


def others(state: dict) -> List[str]:
    """Each other player as the model reads them: life, hand, lands, and what else they have out."""
    lines = []
    for o in state.get("opponents", []):
        board: "OrderedDict[str, int]" = OrderedDict()
        for permanent in o.get("battlefield", []):
            label = render._permanent(permanent)
            board[label] = board.get(label, 0) + 1
        shown = ", ".join(k if n == 1 else f"{k} x{n}" for k, n in board.items()) or "nothing but lands"
        line = f"{o['name']}: life {o['life']}, {o.get('hand', '?')} cards in hand, {o['lands']} lands; board: {shown}"
        if o.get("command"):
            line += f"; in the command zone: {render.names(o['command'])}"
        lines.append(line)
    return lines


def attack_lines(decision: dict) -> Dict[str, list]:
    """At a table, whom to attack is the choice: each opponent with everything that can attack them, or no attack.
    (Forge's AI's own attack is played out too, as the default.)"""
    by_defender: "OrderedDict[str, list]" = OrderedDict()
    for label in decision["options"]:
        creature, _, defender = label.partition(" -> ")
        attackers = by_defender.setdefault(defender, [])
        if not any(a.partition(" -> ")[0] == creature for a in attackers):
            attackers.append(label)
    lines = {f"attack {defender} with everything that can": labels for defender, labels in by_defender.items()}
    lines["no attack"] = []
    return lines


class TableDecider(model.Decider):
    """A seat's decisions at a table; see the module's description."""

    def lines(self, decision: dict) -> Dict[str, list]:
        if decision["kind"] == "attack":
            return attack_lines(decision)
        return model.lines_to_try(decision)

    def line_name(self, decision: dict, picked: List[str], tries: Dict[str, list]) -> str:
        if decision["kind"] == "attack":
            for name, labels in tries.items():
                if sorted(labels) == sorted(picked):
                    return name
            return "the attack Forge's AI would make"
        return model.line_name(decision, picked, tries)

    def context(self, state: dict, decision: dict, so_far: str, guidance: Optional[str]) -> str:
        return model.describe(self.guide, state, decision, self.opponents, so_far, guidance, table=TABLE,
                              others=["Other players:"] + others(state))
