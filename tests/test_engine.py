"""End-to-end check against the real engine. Skipped when Forge isn't installed (as in CI)."""

import threading
import unittest
from pathlib import Path

from unittest import mock

from deckmaster import batch, decklist, engine, model, records, report

DECK = Path(__file__).resolve().parent / "fixtures" / "decks" / "marath-tokens.txt"


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ManualGameTest(unittest.TestCase):
    @unittest.skipUnless(engine.FORGE_BUILD.exists(), "requires installed Forge")
    def test_station_changes_the_spacecraft_type_in_the_client_view(self):
        ship = "Wurmwall Sweeper"
        crew = "Siege Wurm"
        reply = engine.request({"cmd": "start", "commanders": ["Marath, Will of the Wild"],
                                "main": [[99, "Forest"]], "seed": 11, "turns": 2})
        session = reply["session"]

        def request(cmd, **args):
            return engine.request(dict(args, cmd=cmd, session=session))

        def battlefield():
            view = request("view")["view"]
            return {c["name"]: c for c in view["players"][0]["battlefield"]}

        try:
            request("answer", answer=[1])
            request("override", args=["create", ship])
            reply = request("override", args=["create", crew])
            before = battlefield()[ship]
            self.assertIn("Spacecraft", before["type"])
            self.assertNotIn("Creature", before["type"])

            decision = reply["decision"]
            self.assertEqual(decision["kind"], "play")
            [station] = [i for i, label in enumerate(decision["options"], 1)
                         if label.startswith(ship + ":") and "Station" in label]
            request("answer", answer=[station])  # Forge taps the only eligible creature.

            field = battlefield()
            after = field[ship]
            self.assertEqual(after["id"], before["id"])
            self.assertTrue(field[crew]["tapped"])
            self.assertEqual(after["counters"]["Charge"], 5)
            self.assertIn("Creature", after["type"])
        finally:
            request("end")

    def test_seeded_game_keeps_lands_restores_and_records(self):
        deck = decklist.load(DECK)
        start = {"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 2}
        reply = engine.request(start)
        session = reply["session"]
        try:
            self.assertEqual(reply["decision"]["kind"], "mulligan")
            reply = engine.request({"cmd": "answer", "session": session, "answer": [1]})
            play = reply["decision"]
            self.assertEqual(play["kind"], "play")
            self.assertIn("Forest (land)", play["options"])

            engine.request({"cmd": "snapshot", "session": session, "name": "t1"})
            engine.request({"cmd": "answer", "session": session, "answer": [play["options"].index("Forest (land)") + 1]})
            reply = engine.request({"cmd": "restore", "session": session, "name": "t1"})
            self.assertEqual(reply["decision"]["options"], play["options"])

            fixed = engine.request({"cmd": "override", "session": session, "args": ["life", "33"]})
            self.assertEqual(fixed["result"], "You life 33")
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        facts = records.timeline(records.load(reply["records"]))
        seen, played = records.cards(facts)
        self.assertEqual(len(seen), 8)  # the opening seven and the turn-1 draw
        self.assertEqual(played, [])    # the land play was undone by the restore

    def test_a_dead_commander_may_go_to_the_command_zone(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 2})
        session = reply["session"]
        try:
            engine.request({"cmd": "answer", "session": session, "answer": [1]})
            engine.request({"cmd": "override", "session": session, "args": ["move", "Marath, Will of the Wild", "battlefield"]})
            engine.request({"cmd": "override", "session": session, "args": ["destroy", "Marath, Will of the Wild"]})
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        # asked during an override, the choice goes to Forge's AI and is recorded as its answer
        asked = [f for f in records.load(reply["records"]) if f["t"] == "decision" and "command zone" in f.get("prompt", "")]
        self.assertEqual([f["by"] for f in asked], ["ai"])

    def test_a_copy_may_have_new_targets(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 2})
        session = reply["session"]

        def answer(label):
            options = reply["decision"]["options"]
            pick = next(i for i, o in enumerate(options) if o.startswith(label)) + 1
            return engine.request({"cmd": "answer", "session": session, "answer": [pick]})
        try:
            engine.request({"cmd": "answer", "session": session, "answer": [1]})
            for args in (["move", "Marath, Will of the Wild", "battlefield"], ["counter", "Marath, Will of the Wild", "+1/+1", "4"],
                         ["create", "Unbound Flourishing"], ["create", "Grizzly Bears"], ["create", "Plains"]):
                engine.request({"cmd": "override", "session": session, "args": args})
            engine.request({"cmd": "snapshot", "session": session, "name": "set"})
            reply = engine.request({"cmd": "restore", "session": session, "name": "set"})
            reply = answer("Marath, Will of the Wild:")
            while reply["decision"]["kind"] != "targets":  # X and the mode, in the order Forge asks them
                reply = (engine.request({"cmd": "answer", "session": session, "answer": [1]})
                         if reply["decision"]["kind"] == "number" else answer("Put X +1/+1 counters"))
            reply = answer("Marath")
            self.assertTrue(reply["decision"]["prompt"].startswith("choose new targets for the copy of Marath"))
            reply = answer("yes")
            self.assertEqual(reply["decision"]["kind"], "targets")
            answer("Grizzly Bears")
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        targets = [f["answer"] for f in records.load(reply["records"]) if f["t"] == "decision" and f["kind"] == "targets"]
        self.assertEqual(targets[-1], ["Grizzly Bears 2/2"])


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
@unittest.skipUnless(engine.RES.is_dir() and engine.FORGE_BUILD.exists(), "Forge not installed; run scripts/bootstrap-forge.sh")
class CombatFactsTest(unittest.TestCase):
    """The combat's facts in the view, from a real game: Forge's combat ordinal, its blocked verdict per attacker, and the
    combat damage dealt in this combat by source and target (to a player and to an ordinary planeswalker), summed
    over a first-strike and a regular damage step, with an attacker's noncombat pings left out, and kept after the
    planeswalker it killed has left the battlefield."""

    def test_combat_damage_by_source_and_target_across_both_damage_steps(self):
        reply = engine.request({"cmd": "start", "commanders": ["Marath, Will of the Wild"], "main": [[99, "Forest"]],
                                "seed": 11, "turns": 3, "opponents": 1, "stops": "all"})
        session = reply["session"]

        def request(cmd, **args):
            return engine.request(dict(args, cmd=cmd, session=session))

        def card(view, name):
            return next(c for p in view["players"] for c in p["battlefield"] if c["name"] == name)

        try:
            decision = request("answer", answer=[1])["decision"]   # keep
            request("override", args=["create", "Jace Beleren", "battlefield", "Opp 1"])
            request("override", args=["counter", "Jace Beleren", "LOYALTY", "+3"])   # an override enters it without them
            # something to cast at every step, so the pilot is asked in each damage step (and we see the view there)
            request("override", args=["create", "Giant Growth", "hand"])
            for name in ("Hellrider", "Boros Swiftblade", "Grizzly Bears"):
                decision = request("override", args=["create", name])["decision"]
            view = request("view")["view"]
            hellrider, swiftblade, bears = (card(view, n)["id"] for n in ("Hellrider", "Boros Swiftblade", "Grizzly Bears"))
            jace = card(view, "Jace Beleren")["id"]
            seen, attacked = {}, False
            for _ in range(200):
                kind = decision["kind"]
                if kind == "attack":
                    refs = decision["refs"]
                    if not any(r["card"] == swiftblade for r in refs):   # turn 1: only the hasty one may attack
                        answer = []
                    else:
                        wanted = {(hellrider, "Opp 1"), (swiftblade, "Opp 1"), (bears, jace)}
                        answer = [i for i, r in enumerate(refs, 1) if (r["card"], r["to"]) in wanted]
                        self.assertEqual(len(answer), 3, refs)
                        attacked = True
                elif kind == "play":
                    # a land when one is offered (mana for the Giant Growth held), else pass
                    land = "Forest (land)" in decision["options"]
                    answer = [decision["options"].index("Forest (land)" if land else "pass") + 1]
                else:
                    answer = list(range(1, decision["min"] + 1))
                decision = request("answer", answer=answer)["decision"]
                view = request("view")["view"]
                if attacked and view.get("combat") and view["phase"] in ("COMBAT_FIRST_STRIKE_DAMAGE", "COMBAT_DAMAGE"):
                    seen[view["phase"]] = view
                if attacked and not view.get("combat") and "COMBAT_DAMAGE" in seen:
                    break
                if decision is None:
                    break
            self.assertIn("COMBAT_FIRST_STRIKE_DAMAGE", seen)
            self.assertIn("COMBAT_DAMAGE", seen)

            def damage(view):
                return {(d["source"], d["target"]): d["amount"] for d in view["combat"]["damage"]}

            first, regular = seen["COMBAT_FIRST_STRIKE_DAMAGE"], seen["COMBAT_DAMAGE"]
            # the first strike step: the Swiftblade's first blow alone
            self.assertEqual(damage(first), {(swiftblade, "Opp 1"): 1})
            # the regular step: summed over both steps; the planeswalker's 2 kept though Jace has died of it
            self.assertEqual(damage(regular), {(swiftblade, "Opp 1"): 2, (hellrider, "Opp 1"): 3, (bears, jace): 2})
            self.assertNotIn(jace, [c["id"] for p in regular["players"] for c in p["battlefield"]])
            # Hellrider's pings (1 to the player per attacker at the player, 1 to Jace) are noncombat: not in the facts
            opp = next(p for p in regular["players"] if p["name"] == "Opp 1")
            self.assertEqual(opp["life"], 40 - 2 - 5)
            self.assertEqual(regular["combat"]["ordinal"], 1)
            self.assertEqual({a["id"]: a["blocked"] for a in regular["combat"]["attackers"]},
                             {hellrider: False, swiftblade: False, bears: False})
        finally:
            request("end")


class AutomatedGameTest(unittest.TestCase):
    def test_ai_plays_a_whole_game_and_records_end_of_turn(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 5,
                                "turns": 3, "ask": [], "mana": "auto"})
        self.assertEqual(reply.get("over"), "turn limit")
        self.assertIn("Marath, Will of the Wild", reply["ai_avoids"])
        reply = engine.request({"cmd": "end", "session": reply["session"]})
        facts = records.load(reply["records"])
        self.assertEqual([f["turn"] for f in facts if f["t"] == "eot"], [1, 2, 3])

    def test_a_decision_can_be_handed_to_the_ai(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 1})
        session = reply["session"]
        try:
            self.assertEqual(reply["decision"]["kind"], "mulligan")
            reply = engine.request({"cmd": "answer", "session": session, "defer": True})
            self.assertEqual(reply["decision"]["kind"], "play")
        finally:
            reply = engine.request({"cmd": "end", "session": session})
        decisions = [f for f in records.load(reply["records"]) if f["t"] == "decision" and f["kind"] == "mulligan"]
        self.assertEqual(decisions[-1]["by"], "ai")
        self.assertEqual(decisions[-1]["answer"], ["keep"])  # the AI's answer is recorded like anyone's

    def test_an_answer_naming_a_decision_reaches_only_that_decision(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 2})
        session = reply["session"]

        def answer(**req):
            return engine.request(dict(req, cmd="answer", session=session))
        try:
            mulligan = reply["decision"]
            with self.assertRaisesRegex(engine.EngineError, "pick exactly 1"):   # a bad answer leaves it parked
                answer(id=mulligan["id"], answer=[1, 2])
            play = answer(id=mulligan["id"], answer=[1])["decision"]
            self.assertEqual(play["kind"], "play")
            self.assertGreater(play["id"], mulligan["id"])
            # an answer meant for the mulligan, arriving after it moved on, is refused and never answers the play
            with self.assertRaisesRegex(engine.EngineError, "that decision has passed"):
                answer(id=mulligan["id"], answer=[1])
            self.assertEqual(engine.request({"cmd": "view", "session": session})["decision"], play)
            # two answers to one decision at once: one is applied, the other refused
            outcomes = []

            def race():
                try:
                    outcomes.append(answer(id=play["id"], answer=[1])["decision"]["id"])
                except engine.EngineError as error:
                    outcomes.append(str(error))
            racers = [threading.Thread(target=race) for _ in range(2)]
            for r in racers:
                r.start()
            for r in racers:
                r.join(60)
            self.assertEqual(sorted(outcomes, key=str).count("that decision has passed"), 1, outcomes)
            after = next(o for o in outcomes if o != "that decision has passed")
            self.assertGreater(after, play["id"])
            self.assertEqual(engine.request({"cmd": "view", "session": session})["decision"]["id"], after)
            # without an id, an answer goes to whatever is parked, as before
            self.assertIn("decision", answer(answer=[1]))
        finally:
            engine.request({"cmd": "end", "session": session})


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ForkTest(unittest.TestCase):
    def test_a_fork_replays_the_recorded_decisions_into_the_same_game(self):
        deck = decklist.load(DECK)
        reply = engine.request({"cmd": "start", "commanders": deck.commanders, "main": deck.main, "seed": 11, "turns": 4,
                                "ask": ["play"], "mana": "auto"})
        session = reply["session"]
        forks = []
        try:
            while reply.get("decision") and model.turn(reply["decision"]) < 3:
                reply = engine.request({"cmd": "answer", "session": session, "defer": True})
            parked = reply["decision"]
            fork = engine.request({"cmd": "fork", "session": session, "via": "replay"})
            forks.append(fork["session"])
            self.assertEqual(fork["parent"], session)
            self.assertGreaterEqual(fork["replayed"], 2)  # the mulligan and turn 1 and 2 plays, at least

            def same(d):   # each session numbers its own decisions
                return {k: v for k, v in d.items() if k != "id"}
            self.assertEqual(same(fork["decision"]), same(parked))
            # A copy fork (the default) starts from a copy of the game here: nothing to replay, same decision.
            copy = engine.request({"cmd": "fork", "session": session})
            forks.append(copy["session"])
            self.assertEqual(copy["replayed"], 0)
            self.assertEqual(same(copy["decision"]), same(parked))
            # The fork is a game of its own: answering it leaves the parent parked where it was.
            engine.request({"cmd": "answer", "session": fork["session"], "defer": True})
            self.assertEqual(engine.request({"cmd": "decision", "session": session})["decision"], parked)
        finally:
            for fork_id in forks:
                engine.request({"cmd": "end", "session": fork_id})
            reply = engine.request({"cmd": "end", "session": session})
        facts = records.load(reply["records"])
        self.assertTrue(any(f["t"] == "fork" and "failed" not in f for f in facts))


def stand_in_model(state, questions, usage=None, session=None):
    """Stands in for the decisions API: prefers anything over passing or doing nothing."""
    answers = {}
    for name, question in questions.items():
        keys = list(question["criteria"])
        ranked = [k for k in keys if k not in ("pass", "nothing", "no attack")] + \
                 [k for k in keys if k in ("pass", "nothing", "no attack")]
        answers[name] = {"choice": ranked[0], "confidence": 0.5, "probabilities": {k: 1 / len(keys) for k in keys}}
    if usage:
        usage.add({"input_tokens": len(state) // 4}, 0.0)
    return answers


@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed; run scripts/bootstrap-forge.sh")
class ModelGameTest(unittest.TestCase):
    def play(self, hybrid):
        with mock.patch.object(model, "call", stand_in_model), mock.patch.object(model, "key", lambda: "test"), \
                mock.patch.object(model, "provider", lambda: model.PROVIDERS[0]):
            return batch.run(decklist.load(DECK), "test", games=1, seed=7, turns=3, opponents=3, pilot=None,
                             workers=1, guide="Ramp, then cast Marath.", hybrid=hybrid)

    def test_options_are_played_out_in_forks_and_the_game_keeps_only_its_own_line(self):
        manifest = self.play("outcomes")
        self.assertGreater(manifest["model"]["played_out"], 0)
        self.assertEqual(manifest["model"]["drifted"], 0)
        self.assertEqual(manifest["games"][0]["over"], "turn limit")
        facts = records.load(manifest["games"][0]["records"])
        self.assertEqual([f["turn"] for f in facts if f["t"] == "eot"][:3], [1, 2, 3])
        lands = [f["turn"] for f in facts if f["t"] == "land"]
        self.assertEqual(len(lands), len(set(lands)))  # played-out lines live in the forks' records
        self.assertIn("model", {f.get("by") for f in facts if f["t"] == "decision"})
        self.assertEqual([], engine.request({"cmd": "sessions"})["sessions"])  # every fork was ended
        lines = report.build(manifest)
        self.assertTrue(any(line.startswith("decided by") for line in lines), lines)
        self.assertTrue(any(line.startswith("power") for line in lines), lines)

    def test_plain_plays_a_whole_game_without_playing_out(self):
        self.assertEqual(self.play("plain")["model"]["played_out"], 0)



@unittest.skipUnless(engine.RES.is_dir(), "Forge not installed")
class OpeningPolicyGameTest(unittest.TestCase):
    def test_london_bottoms_before_keep_and_policy_stops_at_four(self):
        reply = engine.request({"cmd": "start", "commanders": ["Marath, Will of the Wild"],
                                "main": [[99, "Wastes"]], "seed": 21003, "turns": 1, "ask": list(model.KINDS)})
        decider = model.Decider("Develop.", 3, model.Usage(), hybrid="plain")
        kept = []
        try:
            for _ in range(12):
                d = reply["decision"]
                if d["kind"] == "play":
                    break
                if d["kind"] == "mulligan":
                    state = engine.request({"cmd": "state", "session": reply["session"]})["state"]
                    kept.append(len(state["hand"]))
                    reply = decider.step(reply)
                else:
                    self.assertTrue(model.bottoming(d))
                    # All Wastes: identical bottoms; no remote model needed to verify native ordering.
                    reply = engine.request({"cmd": "answer", "session": reply["session"],
                                            "answer": list(range(1, d["min"] + 1)), "by": "test"})
            self.assertEqual(kept, [7, 7, 6, 5, 4])
            self.assertEqual(reply["decision"]["kind"], "play")
            facts = records.load(reply["records"])
            picks = [f for f in facts if f["t"] == "decision" and f["kind"] == "mulligan"]
            self.assertEqual([f["by"] for f in picks], ["policy"] * 5)
            self.assertEqual(picks[-1]["answer"], ["keep"])
        finally:
            engine.request({"cmd": "end", "session": reply["session"]})


if __name__ == "__main__":
    unittest.main()
