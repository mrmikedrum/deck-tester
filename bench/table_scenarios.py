"""Table situations with one right answer, for evidence that Jev decides well where other players act: blocks,
answering an attacker, using mana at the end of the turn before its own, whom to attack, what to remove. Each is
set up in a real three-player table (Jev with the Marath deck; Ana and Bo pass everything and attack only as the
situation says), and Jev's seat decides it the way it does at a table (TableDecider: forks, then the model).
Forge's AI's pick (the default line) is scored too, as the baseline. Expected answers are fixed here, before any
run.

    python3 bench/table_scenarios.py                    # every situation once
    python3 bench/table_scenarios.py --repeat 3 chump-to-survive deathtouch-attacker
"""

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from goldfish import decklist, engine, model, table_model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DECKS = {"Jev": "eternities-living-worlds-iii", "Ana": "eternities-assimilation-iii", "Bo": "blue-moon-combat-revision"}
PLAN = ("Marath ramp: make land drops and ramp, cast Marath, grow a board of creatures and tokens. Keep your life "
        "total and the creatures the plan needs safe; deal with threats that matter.")

# setup: overrides made at Jev's first main phase ("create CARD ZONE PLAYER" for the others); Jev's hand is emptied
# first. attack: what each other player attacks Jev with, on their first turn after the setup. at: the decision
# judged, the first after the setup that matches (kind; mine: Jev's own turn or not; phase: the turn label's end;
# later: not in the setup turn). first: labels Jev answers before it. expected: the right answers, as sets of labels
# (a label prefix is enough); [] is answering nothing (no blocks, pass). must, instead: parts of labels the answer
# has to include, whatever else it picks.
SCENARIOS = {
    "good-block": {
        "note": "A 6/4 blocks the attacking 2/2: the bear dies, the wurm doesn't.",
        "setup": [["create", "Craw Wurm", "battlefield"], ["create", "Grizzly Bears", "battlefield", "Ana"]],
        "attack": {"Ana": ["Grizzly Bears"]}, "at": {"kind": "block"},
        "expected": [["Craw Wurm 6/4 blocks Grizzly Bears"]]},
    "no-chump": {
        "note": "At 40 life, don't throw the mana elf in front of a 3/3.",
        "setup": [["create", "Llanowar Elves", "battlefield"], ["create", "Hill Giant", "battlefield", "Ana"]],
        "attack": {"Ana": ["Hill Giant"]}, "at": {"kind": "block"},
        "expected": [[]]},
    "chump-to-survive": {
        "note": "At 3 life the 3/3 is lethal: block it with the elf.",
        "setup": [["create", "Llanowar Elves", "battlefield"], ["create", "Hill Giant", "battlefield", "Ana"], ["life", "3"]],
        "attack": {"Ana": ["Hill Giant"]}, "at": {"kind": "block"},
        "expected": [["Llanowar Elves 1/1 blocks Hill Giant"]]},
    "survive-several-attackers": {
        "note": "At 6 life Ana attacks with a 6/4, a 3/3 and a 2/2: the 6/4 alone is lethal, so it must be blocked; the elves can block the rest too.",
        "setup": [["create", "Llanowar Elves", "battlefield"], ["create", "Elvish Mystic", "battlefield"],
                  ["create", "Fyndhorn Elves", "battlefield"], ["create", "Craw Wurm", "battlefield", "Ana"],
                  ["create", "Hill Giant", "battlefield", "Ana"], ["create", "Grizzly Bears", "battlefield", "Ana"], ["life", "6"]],
        "attack": {"Ana": ["Craw Wurm", "Hill Giant", "Grizzly Bears"]}, "at": {"kind": "block"},
        "must": ["blocks Craw Wurm"]},
    "deathtouch-attacker": {
        "note": "At 40 life, a deathtouch 1/1 would kill the 6/4 that blocks it: take the one damage.",
        "setup": [["create", "Craw Wurm", "battlefield"], ["create", "Typhoid Rats", "battlefield", "Ana"]],
        "attack": {"Ana": ["Typhoid Rats"]}, "at": {"kind": "block"},
        "expected": [[]]},
    "remove-lethal-attacker": {
        "note": "At 6 life with no blockers, the attacking 6/6 is lethal: Swords it now.",
        "setup": [["create", "Plains", "battlefield"], ["create", "Swords to Plowshares", "hand"],
                  ["create", "Colossal Dreadmaw", "battlefield", "Ana"], ["life", "6"]],
        "attack": {"Ana": ["Colossal Dreadmaw"]}, "at": {"kind": "play", "mine": False},
        "expected": [["Swords to Plowshares"]]},
    "flash-at-end-of-turn": {
        "note": "Four open mana at the end of the turn before Jev's: flash in Restoration Angel now rather than leave it unused.",
        "setup": [["create", "Plains", "battlefield"], ["create", "Plains", "battlefield"], ["create", "Forest", "battlefield"],
                  ["create", "Forest", "battlefield"], ["create", "Restoration Angel", "hand"]],
        "at": {"kind": "play", "mine": False, "phase": "end"},
        "expected": [["Restoration Angel"]]},
    "tokens-at-end-of-turn": {
        "note": "Four open Plains at the end of the turn before Jev's: Secure the Wastes makes three tokens now, with mana that would go unused.",
        "setup": [["create", "Plains", "battlefield"], ["create", "Plains", "battlefield"], ["create", "Plains", "battlefield"],
                  ["create", "Plains", "battlefield"], ["create", "Secure the Wastes", "hand"]],
        "at": {"kind": "play", "mine": False, "phase": "end"},
        "expected": [["Secure the Wastes"]]},
    "no-attack-into-blockers": {
        "note": "Ana and Bo each have an untapped 6/4: the 3/3 would die attacking either, so it stays home.",
        "setup": [["create", "Hill Giant", "battlefield"], ["create", "Craw Wurm", "battlefield", "Ana"],
                  ["create", "Craw Wurm", "battlefield", "Bo"]],
        "at": {"kind": "attack", "later": True},
        "expected": [[]]},
    "finish-a-player": {
        "note": "Ana is at 3 life with no blockers: the 3/3 attacks Ana and knocks her out, rather than Bo at 40.",
        "setup": [["create", "Hill Giant", "battlefield"], ["life", "3", "Ana"]],
        "at": {"kind": "attack", "later": True},
        "expected": [["Hill Giant 3/3 -> Ana"]]},
    "hold-back-against-crack-back": {
        "note": "At 6 life, Bo has two untapped 3/3s: attacking Ana (at 40) with the 6/4 leaves nothing to block them on Bo's turn, which is lethal.",
        "setup": [["create", "Craw Wurm", "battlefield"], ["create", "Hill Giant", "battlefield", "Bo"],
                  ["create", "Hill Giant", "battlefield", "Bo"], ["life", "6"]],
        "at": {"kind": "attack", "later": True},
        "expected": [[]]},
    "attack-the-open-player": {
        "note": "Ana has a 6/4 untapped and Bo has nothing: the 3/3 attacks Bo.",
        "setup": [["create", "Hill Giant", "battlefield"], ["create", "Craw Wurm", "battlefield", "Ana"]],
        "at": {"kind": "attack", "later": True},
        "expected": [["Hill Giant 3/3 -> Bo"]]},
    "remove-the-threat": {
        "note": "Swords at the real threat: Bo's Avenger of Zendikar, not Ana's bear.",
        "setup": [["create", "Plains", "battlefield"], ["create", "Swords to Plowshares", "hand"],
                  ["create", "Grizzly Bears", "battlefield", "Ana"], ["create", "Avenger of Zendikar", "battlefield", "Bo"]],
        "first": ["Swords to Plowshares"], "at": {"kind": "targets"},
        "expected": [["Avenger of Zendikar"]]},
    "no-second-transform": {
        "note": "Jev's Incubator is transforming, the ability on the stack: activating it again does nothing once it has transformed (2 mana for nothing), so pass.",
        "setup": [["create", "Plains", "battlefield"]] * 7 + [["create", "Phyrexian Awakening", "hand"]],
        "first": ["Phyrexian Awakening", "Incubator Token"], "at": {"kind": "play", "mine": True},
        "expected": [[]]},
}


def seat_request(name: str) -> dict:
    deck = decklist.load(ROOT / "examples" / "decks" / f"{DECKS[name]}.txt")
    return {"name": name, "commanders": deck.commanders, "main": deck.main, "deck": DECKS[name], "hash": deck.revision(),
            "ask": sorted(table_model.ASKS), "mana": "auto"}


def request(session: str, **fields) -> dict:
    return engine.request(dict(fields, session=session))


def pick(decision: dict, labels: list) -> list:
    """Option numbers for labels or label prefixes."""
    return [next(i + 1 for i, o in enumerate(decision["options"]) if o == label or o.startswith(label)) for label in labels]


class Run:
    """One build of a situation: the table, the other players' scripted seats, and Jev's judged decision."""

    def __init__(self, name: str, scenario: dict, usage: model.Usage):
        self.name, self.scenario, self.usage = name, scenario, usage
        self.setup_turn = None
        self.attacked = set()
        self.first = list(scenario.get("first", []))  # Jev's answers before the judged decision
        self.verdict = None  # (picked labels, right?, by, Forge's AI's pick right?)
        self.done = threading.Event()

    def other(self, name: str, session: str) -> None:
        try:
            self.scripted(name, session)
        except engine.EngineError:
            pass  # the table ended and its seats were let go

    def scripted(self, name: str, session: str) -> None:
        reply = request(session, cmd="decision")
        while not self.done.is_set():
            decision = reply.get("decision")
            if decision is None:
                if "over" in reply:
                    return
                reply = request(session, cmd="decision")
                continue
            if decision["kind"] == "play":
                answer = {"answer": [1]}
            elif decision["kind"] == "mulligan":
                answer = {"answer": pick(decision, ["keep"])}
            elif decision["kind"] == "attack":
                wanted = self.scenario.get("attack", {}).get(name, [])
                go = self.setup_turn is not None and name not in self.attacked and wanted
                labels = [o for o in decision["options"] if o.endswith("-> Jev") and any(o.startswith(w) for w in wanted)] if go else []
                if go:
                    self.attacked.add(name)
                answer = {"answer": pick(decision, labels)}
            elif decision["kind"] == "block":
                answer = {"answer": []}
            else:
                answer = {"defer": True}
            try:
                reply = request(session, cmd="answer", **answer)
            except engine.EngineError:
                reply = request(session, cmd="answer", defer=True)

    def judged(self, decision: dict) -> bool:
        at = self.scenario["at"]
        if self.setup_turn is None or decision["kind"] != at["kind"] or self.first:
            return False
        if "mine" in at and model.ours(decision) != at["mine"]:
            return False
        if at.get("phase") and not decision["turn"].endswith(" " + at["phase"]):
            return False
        return not at.get("later") or model.turn(decision) > self.setup_turn

    def right(self, labels) -> bool:
        if labels is None:
            return False
        if "must" in self.scenario:
            return all(any(m in label for label in labels) for m in self.scenario["must"])
        return any(len(labels) == len(want) and all(any(l == w or l.startswith(w) for l in labels) for w in want)
                   for want in self.scenario["expected"])

    def jev(self, session: str) -> None:
        decider = table_model.TableDecider(PLAN, 2, self.usage, "outcomes", workers=4)
        sent = {}
        send = decider.send

        def capture(reply, answer):
            sent.update(answer)
            return send(reply, answer)

        decider.send = capture
        ai = {}
        explore = decider.explore

        def explore_capturing(reply, tries):
            lines, default = explore(reply, tries)
            if default in lines:
                ai["picked"] = lines[default].picked
            return lines, default

        decider.explore = explore_capturing
        reply = request(session, cmd="decision")
        while True:
            decision = reply.get("decision")
            if decision is None:
                if "over" in reply:
                    self.verdict = (None, False, "game over before the decision", None)
                    return
                reply = request(session, cmd="decision")
                continue
            if self.setup_turn is None and decision["kind"] == "play" and model.ours(decision):
                state = request(session, cmd="state")["state"]
                for card in state["hand"]:
                    reply = request(session, cmd="override", args=["move", card, "library"])
                for args in self.scenario["setup"]:
                    reply = request(session, cmd="override", args=args)
                self.setup_turn = model.turn(decision)
                continue
            if self.first and self.setup_turn is not None and any(o.startswith(self.first[0]) for o in decision["options"]):
                reply = request(session, cmd="answer", answer=pick(decision, [self.first.pop(0)]))
                continue
            if self.judged(decision):
                options = decision["options"]
                decider.step(reply)
                numbers = sent.get("answer")
                labels = [options[n - 1] for n in numbers] if numbers is not None and options else numbers
                by = "model"
                if numbers is None:  # left to Forge's AI (blocks, at a table): what it answered, from the record
                    with open(reply["records"], encoding="utf-8") as handle:
                        facts = [json.loads(line) for line in handle if line.strip()]
                    labels = next((f["answer"] for f in reversed(facts) if f["t"] == "decision" and f["kind"] == decision["kind"]), None)
                    ai["picked"], by = labels, "Forge's AI"
                if decision["kind"] == "play" and labels == ["pass"]:
                    labels = []
                self.verdict = (labels, self.right(labels), by,
                                self.right([] if ai.get("picked") == ["pass"] else ai.get("picked")))
                return
            if decision["kind"] == "play":
                answer = {"answer": [1]}
            elif decision["kind"] in ("attack", "block"):
                answer = {"answer": []}
            elif decision["kind"] == "mulligan":
                answer = {"answer": pick(decision, ["keep"])}
            else:
                answer = {"defer": True}
            reply = request(session, cmd="answer", **answer)

    def play(self) -> tuple:
        engine.use_table()
        reply = engine.request({"cmd": "table", "seats": [seat_request(n) for n in DECKS], "people": 0})
        sessions = reply["seats"]
        threads = [threading.Thread(target=self.other, args=(n, sessions[n]), daemon=True) for n in ("Ana", "Bo")]
        for t in threads:
            t.start()
        try:
            self.jev(sessions["Jev"])
        finally:
            self.done.set()
            engine.request({"cmd": "table_end"})
        return self.verdict


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("names", nargs="*")
    p.add_argument("--repeat", type=int, default=1)
    a = p.parse_args()
    model.key()
    usage = model.Usage()
    right = total = ai_right = 0
    began = time.time()
    for name in a.names or list(SCENARIOS):
        for _ in range(a.repeat):
            labels, ok, by, ai_ok = Run(name, SCENARIOS[name], usage).play()
            total += 1
            right += bool(ok)
            ai_right += bool(ai_ok)
            print(f"{'right' if ok else 'WRONG'}  {name}: {labels if labels is not None else by} ({by}; Forge's AI "
                  f"{'right' if ai_ok else 'wrong'})"
                  + ("" if ok else f" · expected {SCENARIOS[name].get('expected', SCENARIOS[name].get('must'))} · "
                     f"{SCENARIOS[name]['note']}"), flush=True)
    print(f"{right} of {total} right (Forge's AI {ai_right}) · {usage.calls} calls, ${usage.cost:.2f} · "
          f"{usage.played_out} lines played out, {usage.drifted} drifted · {time.time() - began:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
