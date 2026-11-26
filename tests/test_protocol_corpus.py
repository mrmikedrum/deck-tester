"""The protocol corpus (tests/fixtures/protocol): well-formed always, and still what the engine produces.

The first class needs no Forge. The second re-runs a short capture on a real table and checks that the live objects
have the key sets the corpus shows, so a change to what the engine sends fails here before the client meets it.
"""
import json
import pathlib
import unittest

from deckmaster import engine, game

from tests import protocol_capture as pc

CORPUS = pathlib.Path(__file__).resolve().parent / "fixtures" / "protocol"
STATES = {"no game", "starting", "playing", "over", "error", "interrupted", "reconnecting"}
KINDS = {"mulligan", "play", "number", "mode", "targets", "confirm", "order", "pay", "choose", "attack", "block"}


def load():
    return {p.name: json.loads(p.read_text()) for p in sorted(CORPUS.glob("[0-9]*.json"))}


class CorpusFormTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((CORPUS / "index.json").read_text())
        cls.envs = load()

    def test_index_lists_every_file(self):
        self.assertEqual(sorted(self.envs), sorted(self.index["files"]))
        self.assertGreaterEqual(len(self.envs), 30)

    def test_envelopes_have_the_bridge_fields(self):
        for name, env in self.envs.items():
            with self.subTest(name):
                self.assertIn(env["state"], STATES)
                self.assertIsInstance(env["v"], int)
                self.assertIn("error", env)
                if env["state"] in ("playing", "over"):
                    for key in ("gen", "view", "decision", "over", "pilots"):
                        self.assertIn(key, env)
                    self.assertEqual(env["state"] == "over", env["over"] is not None)
                if env["state"] == "starting":
                    self.assertIn("gen", env)
                if env["state"] == "error":
                    self.assertTrue(env["error"])

    def test_tags_match_the_files(self):
        for name, env in self.envs.items():
            with self.subTest(name):
                self.assertEqual(sorted(pc.features(env)), self.index["files"][name]["tags"])

    def test_decision_refs_align_with_options(self):
        for name, env in self.envs.items():
            d = env.get("decision")
            if not d:
                continue
            with self.subTest(name):
                self.assertIn(d["kind"], KINDS)
                for key in ("id", "turn", "prompt", "options", "min", "max", "repeat", "mine"):
                    self.assertIn(key, d)
                self.assertIsInstance(d["id"], int)
                self.assertGreaterEqual(d["id"], 1)
                if "details" in d:
                    self.assertEqual(len(d["details"]), len(d["options"]))
                if d["options"]:
                    self.assertLessEqual(d["min"], d["max"])
                    if not d["repeat"]:
                        self.assertLessEqual(d["max"], len(d["options"]))
                if "refs" in d:
                    self.assertEqual(len(d["refs"]), len(d["options"]))
                    self.check_refs(d, env["view"])
                else:   # no refs; a choose asked by label only (a colour, a type, a yes or no) has none either
                    self.assertIn(d["kind"], ("mulligan", "number", "confirm", "order", "mode", "choose"))

    def check_refs(self, d, view):
        ids = {c["id"] for _, c in pc.cards_of(view)}
        names = {p["name"] for p in view["players"]}
        for option, ref in zip(d["options"], d["refs"]):
            if d["kind"] == "play":
                self.assertEqual(ref == {}, option == "pass")
                if ref:
                    self.assertIsInstance(ref["spell"], bool)
                    self.assertLessEqual(set(ref), {"card", "spell", "mana"})
            elif d["kind"] == "attack":
                self.assertEqual(set(ref), {"card", "to"})
                self.assertIn(ref["to"], ids | names)
            elif d["kind"] == "block":
                self.assertEqual(set(ref), {"card", "blocks"})
                self.assertIn(ref["card"], ids)
                self.assertIn(ref["blocks"], ids)
            elif "player" in ref:
                self.assertIn(ref["player"], names)
            elif "card" in ref:
                self.assertIsInstance(ref["card"], int)

    def test_view_references_resolve(self):
        for name, env in self.envs.items():
            view = env.get("view")
            if not view:
                continue
            with self.subTest(name):
                names = {p["name"] for p in view["players"]}
                seats = names | {name for name, _ in pc.SEATS}   # an eliminated player can still be named
                ids = {c["id"] for _, c in pc.cards_of(view)}
                if view["me"] in names:   # when I have lost, the engine no longer lists me and the rotation stops
                    self.assertEqual(view["players"][0]["name"], view["me"])
                for p in view["players"]:
                    self.assertEqual("hand" in p, p["name"] == view["me"])
                    self.assertEqual("handCount" in p, p["name"] != view["me"])
                stacked = {i["id"] for i in view["stack"]} | {i["source"]["id"] for i in view["stack"] if i.get("source")}
                for s in view["stack"]:
                    for t in s.get("targets", []):
                        if isinstance(t, str):
                            self.assertIn(t, seats)
                        elif t not in ids | stacked:   # a card gone from the game (a token exiled mid-resolution)
                            self.assertIn("(%d)" % t, s["text"])   # is still named in the item's text
                for a in (view.get("combat") or {}).get("attackers", []):
                    self.assertIn(a["id"], ids)
                    if isinstance(a.get("defender"), str):
                        self.assertIn(a["defender"], seats)
                for b in (view.get("combat") or {}).get("blockers", []):
                    self.assertIn(b["id"], ids)
                    self.assertIn(b["blocking"], ids)

    def test_answers_fit_their_decisions(self):
        asked = 0
        for name, entry in self.index["files"].items():
            answer, d = entry["answer"], self.envs[name].get("decision")
            if not answer:
                continue
            asked += 1
            with self.subTest(name):
                self.assertEqual(answer["key"], game.key(d))
                self.assertEqual(answer["id"], d["id"])
                picks = answer["answer"]
                if d["options"]:
                    self.assertTrue(all(1 <= p <= len(d["options"]) for p in picks))
                    if not d["repeat"]:
                        self.assertEqual(len(picks), len(set(picks)))
                    if "refused" not in answer:
                        self.assertTrue(d["min"] <= len(picks) <= d["max"])
                else:
                    self.assertEqual(len(picks), 1)
        self.assertGreater(asked, 20)

    def test_a_choice_asked_by_label_only_is_in_the_corpus(self):
        labels_only = [n for n, e in self.envs.items() if (e.get("decision") or {}).get("kind") == "choose"
                       and "refs" not in e["decision"]]
        self.assertTrue(labels_only)

    def test_every_decision_kind_but_few_is_covered(self):
        covered = {t.split(":")[1] for t in self.index["coverage"] if t.startswith("decision:") and t.count(":") == 1}
        self.assertTrue({"mulligan", "play", "pay", "targets", "choose", "attack", "confirm"} <= covered, covered)


@unittest.skipUnless(engine.FORGE_BUILD.exists(), "requires installed Forge")
class CorpusProducerTest(unittest.TestCase):
    def test_live_shapes_match_the_corpus(self):
        index = json.loads((CORPUS / "index.json").read_text())
        capture = pc.Capture(seed=index["seed"], steps=18, arena_turn=1, finish=False, seconds=240).run()
        envs = [o["env"] for o in capture.observed]
        self.assertGreater(len(envs), 10)
        self.assertEqual(pc.check_shapes(envs, index["shapes"]), [])
        # the bridge's own key function accepts every answer the policy sent
        sent = [o for o in capture.observed if o["answer"]]
        self.assertTrue(sent)
        for o in sent:
            self.assertEqual(o["answer"]["key"], game.key(o["env"]["decision"]))
        # decision ids strictly increase: a decision seen again keeps its id, and an answered one is never reused
        last, answered = 0, False
        for o in capture.observed:
            d = o["env"].get("decision")
            if d:
                if answered:
                    self.assertGreater(d["id"], last)
                else:
                    self.assertGreaterEqual(d["id"], last)
                last, answered = d["id"], False
            answered = answered or bool(o["answer"])


if __name__ == "__main__":
    unittest.main()
