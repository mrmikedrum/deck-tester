"""The decision model at a table, where the other players act. The goldfish decider (model.Decider) stays as it is,
measured against passive opponents; this one changes only what differs at a table, through the decider's hooks:
what the model reads (the table, the other players' boards, everyone's life after each line), which decisions it
plays out (its plays on the others' turns too) and, in the engine, forks in which the other players block. Measure a change here at a table (bench/table_fidelity.py, table reports), not on the goldfish bench.
"""

from collections import OrderedDict
from typing import Dict, List, Optional

from . import model, render

# What a seat's engine asks. Blocks are asked so the record shows them, and left to Forge's AI, which made every
# labelled block right where the model missed one, at no cost (docs/measurements.md).
ASKS = model.KINDS + ("block",)

# On another player's turn, what the moment is (measured: one wording for all of them made the model pass)
END_OF_TURN = ("It is the end of another player's turn and you have priority. Your lands untap at the start of your own "
               "turn, so mana you leave unused until then is wasted. Play something now, or pass.")
ATTACKED = "Another player is attacking you, and you have priority before blockers are declared. Play something now, or pass."
RESPONDING = ("It is another player's turn and you have priority, with something on the stack to respond to. Play "
              "something now, or pass.")

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


def lost(before: List[dict], after: List[dict], state: dict) -> List[str]:
    """Nonland permanents in before that aren't in after (by id: a permanent that transformed is still there)."""
    left = {p.get("id") for p in after}
    return [p["name"] for p in before if p.get("id") not in left and not model.is_land(p["name"], state)]


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

    def explores(self, decision: dict) -> bool:
        """Its own turn, and plays on the others' turns: a response, a removal spell for an attacker or a play
        at the end of the turn is weighed by playing it out like any other."""
        return model.ours(decision) or decision["kind"] == "play" and not decision["turn"].endswith("setup")

    def instructions(self, decision: dict, state: dict) -> str:
        if decision["kind"] == "play" and not model.ours(decision):
            if state.get("stack"):
                return RESPONDING
            if decision["turn"].endswith(" attackers"):
                return ATTACKED
            return END_OF_TURN
        return model.instructions(decision, state)

    def result(self, before: dict, line: model.Line, now: int) -> str:
        """As in a goldfish game, with what each player lost and everyone's life: at a table, what a line costs or
        saves counts as much as what it builds."""
        text = super().result(before, line, now)
        eot = next((f for f in line.facts if f["t"] == "eot" and f.get("others_power") is not None), None)
        if eot:
            # what the forks can't show, since the others pass in them: what could come back at you
            text += (f"; until your next turn: {eot['untapped']} of your creatures untapped to block; the others' "
                     "creatures could attack you for " + ", ".join(f"{name} {power}" for name, power in eot["others_power"].items()))
        held = next((f for f in line.facts if f["t"] == "held"), None)
        if held and not eot:  # a line from your own turn says what its end step left unspent already
            text += f"; leaves {held['unspent']} mana unspent before your turn"
        if line.state:
            gone = [f"your {n}" for n in lost(before["battlefield"], line.state["battlefield"], before)]
            after = {o["name"]: o for o in line.state.get("opponents", [])}
            for o in before.get("opponents", []):
                gone += [f"{o['name']}'s {n}" for n in lost(o.get("battlefield", []), after.get(o["name"], {}).get("battlefield", []), before)]
            if gone:
                text += "; gone: " + ", ".join(gone)
            text += "; life: you " + str(line.state["life"]) + "".join(
                f", {o['name']} {o['life']}" for o in line.state.get("opponents", []))
        return text

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
