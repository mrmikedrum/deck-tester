"""Try ways of presenting a decision to the decision model on captured situations, and score them.

Each variant is a set of choices about what the model reads (see KNOBS). Every labelled situation is asked
as one choice among its options; the score is how often the model picks a right answer, and how much
probability it puts on the right answers.

    python3 bench/try.py base goal=win history=none          # variants: name, then knob=value pairs
    python3 bench/try.py --show dack-cedh-3001-T3-9 base     # print what the model would read
"""

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from goldfish import model, records, render  # noqa: E402

SITUATIONS = Path(__file__).resolve().parent / "situations"

KNOBS = {
    "goal": ("develop", "win", "both"),          # what the table line asks for
    "plan": ("on", "off"),
    "board": ("full", "compact"),               # full state view, or turn/mana, hand and board only
    "text": ("all", "options", "none"),         # card text for hand, board and command; options' cards; none
    "history": ("decisions", "summary", "none"),  # this turn: events and decisions; events; nothing
    "criteria": ("text", "short", "outcome", "both"),  # what describes each option
    "result": ("hand", "nohand", "words", "after"),  # result with counts, without hand count, compared in words, or an absolute after-line
    "order": ("engine", "passlast", "reverse", "avg"),  # option order; avg averages engine and reversed orders
    "format": ("text", "json"),                  # state as lines of text, or as named JSON fields
    "method": ("choice", "nouls", "scores"),     # one pick; a yes/no per option; a 0-4 score per option
    "trim": ("none", "light"),                   # light drops opponents, exile and library from the board
    "default": ("none", "line", "mark"),         # Forge's choice: not shown; a line in the state; marked option
    "keys": ("labels", "verbs"),                 # option names as the engine labels them, or as actions
    "ask": ("current", "plain"),                 # the question's wording
    "facts": ("off", "on"),                      # derived facts the model can't count itself (lands in hand at a mulligan)
    "mulligan": ("labels", "described"),         # a mulligan's two answers as bare labels, or described
    "advice": ("off", "on"),                     # a line of general advice on keeping hands, as a plan might carry
}
BASE = {"goal": "develop", "plan": "on", "board": "full", "text": "all", "history": "decisions",
        "criteria": "text", "default": "none", "keys": "labels", "ask": "current", "result": "hand",
        "order": "engine", "format": "text", "method": "choice", "trim": "none", "facts": "off",
        "mulligan": "labels", "advice": "off"}

GOALS = {
    "develop": ("Commander goldfish: you play alone against {opponents} opponents at 40 life who only play a land each "
                "turn and never attack, block or interact. Develop the deck as its plan says, as fast as you can."),
    "win": ("Commander goldfish: you play alone against {opponents} opponents at 40 life who only play a land each "
            "turn and never block or interact. You win by reducing them all to 0 life as early as possible: build "
            "your mana and board, and attack with creatures that can deal damage, since nothing blocks."),
    "both": model.GAME,
}
ASK = {"current": None,
       "plain": "Which of these should you do now?"}


def load(only=None, everything=False, unlabelled=False):
    found = []
    for path in sorted(SITUATIONS.glob("*.json")):
        x = json.loads(path.read_text())
        if x["id"].startswith("blue-moon") and not (everything or only):
            continue  # its engine is beyond any decider; kept for curiosity
        if (x.get("expected") or unlabelled) and (not only or x["id"] in only):
            found.append(x)
    return found


def options(x):
    """The situation's lines other than Forge's default, as the choices to ask about."""
    return [name for name in x["lines"] if name != "default"]


def default_option(x):
    """The option Forge's AI would take: named by newer captures; in older ones, the option whose line matches
    the default line, preferring a real action."""
    if x.get("default"):
        return x["default"]
    lines = x["lines"]
    if "default" not in lines:
        return None
    same = [n for n in options(x) if records.happened(lines[n]["facts"]) == records.happened(lines["default"]["facts"])
            and lines[n]["state"] == lines["default"]["state"]]
    real = [n for n in same if n not in ("pass", "nothing", "no attack")]
    return (real or same or [None])[0]


def verb(name, label_text):
    if name in ("pass", "nothing", "yes", "no", "attack with everything", "no attack") or name.startswith("X ="):
        return name
    if name.endswith(" (land)"):
        return "play " + name[:-7]
    if name.endswith(" (commander)"):
        return "cast " + name[:-12] + " from the command zone"
    if ": " in name:
        return "activate " + name.split(": ")[0]
    if re.search(r" \((warp|flashback|foretell|evoke|dash|overload|kicker)\)$", name):
        return "cast " + name
    return ("cast " if label_text and " — " in label_text else "choose ") + name


def outcome(x, name, now, hand=True):
    """What this option leads to, as changes from now to the start of the next turn."""
    line, before = x["lines"][name], x["state"]
    after = line["state"]
    if after is None:
        return "the game ends"
    this_turn = [f for f in line["facts"] if f.get("turn") == now]
    acts = records.happened(this_turn) or "nothing else this turn"
    gone = [p["name"] for p in before["battlefield"]]
    new = [p["name"] for p in after["battlefield"]]
    for n in list(gone):
        if n in new:
            new.remove(n)
            gone.remove(n)
    life = sum(o["life"] for o in before["opponents"]) - sum(o["life"] for o in after["opponents"])
    parts = [acts, f"next turn: {after['mana']} mana available (now {before['mana']})"] + ([f"hand {len(after['hand'])}"] if hand else [])
    if new:
        parts.append("new on battlefield: " + ", ".join(new))
    if gone:
        parts.append("gone from battlefield: " + ", ".join(gone))
    if life:
        parts.append(f"opponents lose {life} life" if life > 0 else f"opponents gain {-life} life")
    return "; ".join(parts)


def after_line(x, name, now):
    """The decider's own wording: the board after the line, in absolute terms (model.after_line)."""
    line = x["lines"][name]
    return model.after_line(x["state"], line["facts"], line["state"], now)


def worded(x, name, now):
    """The decider's own wording of results (model.worded), over this situation's lines."""
    names = options(x)
    results = {n: model.summarize(x["state"], x["lines"][n]["facts"], x["lines"][n]["state"], now) for n in names}
    return model.worded(results)[name]


def detail_of(x, name):
    d = x["decision"]
    if name in d["options"]:
        i = d["options"].index(name)
        if d.get("details") and i < len(d["details"]) and d["details"][i]:
            return d["details"][i]
    return name


ADVISOR = None  # advise(state, decision, this_turn) from --advisor, if any


def render_case(x, v):
    """The state text and the question for one situation under variant v."""
    d, state, now = x["decision"], x["state"], model.turn(x["decision"])
    lines = []
    if v["plan"] == "on":
        lines.append("Deck plan: " + x["plan"].strip() + (" Keep an opening hand with two to four lands; mulligan the rest."
                                                        if v["advice"] == "on" else ""))
    lines.append(GOALS[v["goal"]].format(opponents=3))
    guidance = ADVISOR(state, d, x.get("so_far", [])) if ADVISOR else None
    if guidance:
        lines.append(f"Guidance for this position: {guidance.strip()}")
    if v["board"] == "full":
        for l in render.state(state, full=True):
            if v["trim"] == "light":
                if l.startswith(("opponents:", "exile:")):
                    continue
                l = re.sub(r" · library \d+", "", l)
            lines.append(l)
    else:
        lines += render.state(state)[:3]
        if state["command"]:
            lines.append("command: " + ", ".join(state["command"]))
    if v["facts"] == "on" and d["kind"] == "mulligan":
        lines.append(model.mulligan_facts(state))
    names = options(x)
    if v["order"] == "passlast":
        names = [n for n in names if n != "pass"] + [n for n in names if n == "pass"]
    elif v["order"] == "reverse":
        names = names[::-1]
    if v["text"] == "all" and state.get("text"):
        lines.append("Card text:")
        lines += [f"- {t}" for t in state["text"].values()]
    elif v["text"] == "options":
        texts = {detail_of(x, n) for n in names if detail_of(x, n) not in (n, "pass priority")}
        if texts:
            lines.append("Card text:")
            lines += [f"- {t}" for t in texts]
    if v["history"] != "none" and d["kind"] != "mulligan":
        digest = records.digest([f for f in x["so_far"]], decisions=v["history"] == "decisions")
        if digest:
            lines.append("This turn so far:")
            lines += [l.strip() for l in (digest[:1] + digest[1:][-10:])]
    lines.append(f"Now: {d['turn']}, {d['kind']}" + (f" ({d['prompt']})" if d.get("prompt") else ""))
    fallback = default_option(x)
    keys = {}
    for n in names:
        key = verb(n, detail_of(x, n)) if v["keys"] == "verbs" else n
        if v["default"] == "mark" and n == fallback:
            key += model.DEFAULT
        keys[n] = key
    if v["default"] == "line" and fallback:
        lines.append(f"Default choice: {keys[fallback]}")
    criteria = {}
    for n in names:
        text = detail_of(x, n)
        if d["kind"] == "mulligan":  # a mulligan's line would show the next hand
            c = {"keep": "keep these seven cards and start", "mulligan": "shuffle them back and draw seven new cards, then put one on the bottom"}[n] \
                if v["mulligan"] == "described" else text
        elif v["criteria"] == "text":
            c = text
        elif v["criteria"] == "short":
            c = keys[n]
        else:
            result = (worded(x, n, now) if v["result"] == "words" else after_line(x, n, now) if v["result"] == "after"
                      else outcome(x, n, now, v["result"] == "hand"))
            if v["criteria"] == "outcome":
                c = result
            elif v["format"] == "json":
                c = {"action": keys[n], "card": text if text != n else None, "result": result}
            else:
                c = (text + " → " if text != n else "") + result
        criteria[keys[n]] = c
    instructions = ASK[v["ask"]] or (model.INSTRUCTIONS.get(d["kind"], "Pick one.") +
                                     (f" ({d['prompt']})" if d.get("prompt") else ""))
    text = "\n".join(lines)
    if v["format"] == "json":
        text = as_json(x, v, fallback and keys.get(fallback))
    return text, {"pick": {"type": "choice", "instructions": instructions, "criteria": criteria}}, keys


def as_json(x, v, fallback):
    """The same information as named fields."""
    d, s = x["decision"], x["state"]
    out = {}
    if v["plan"] == "on":
        out["deck_plan"] = x["plan"].strip()
    out["game"] = GOALS[v["goal"]].format(opponents=3)
    out["you"] = {"turn": d["turn"], "life": s["life"], "mana_available": s["mana"], "hand": s["hand"],
                  "battlefield": [render._permanent(p) for p in s["battlefield"]], "command_zone": s["command"],
                  "graveyard": s["graveyard"]}
    if v["trim"] == "none":
        out["you"]["library"] = s["library"]
        out["opponents"] = s["opponents"]
    if v["text"] == "all" and s.get("text"):
        out["card_text"] = s["text"]
    if v["history"] != "none":
        digest = records.digest(x["so_far"], decisions=v["history"] == "decisions")
        if digest:
            out["this_turn"] = [l.strip() for l in digest[:1] + digest[1:][-10:]]
    out["decision"] = d["kind"] + (f": {d['prompt']}" if d.get("prompt") else "")
    if v["default"] == "line" and fallback:
        out["default_choice"] = fallback
    return out


LEVELS = ["harmful to the plan", "a waste of this turn", "fine", "good", "the best thing to do now"]


def odds_for(x, v, usage):
    """Probability (or normalised score) per option name under variant v."""
    text, question, keys = render_case(x, v)
    back = {k: n for n, k in keys.items()}
    pick = question["pick"]
    if v["method"] == "choice":
        answer = model.call(text, question, usage)["pick"]
        odds = {back.get(k, k): p for k, p in (answer.get("probabilities") or {}).items()}
        if not odds and answer.get("choice"):
            odds = {back.get(answer["choice"], answer["choice"]): answer.get("confidence", 1.0)}
        return odds, text, question
    asked = {}
    for i, (key, criterion) in enumerate(pick["criteria"].items()):
        about = criterion if isinstance(criterion, str) else json.dumps(criterion)
        if v["method"] == "nouls":
            asked[f"o{i}"] = {"type": "noul", "instructions": f"{pick['instructions']} Is this the best choice now: {key}?",
                              "criteria": {"true": f"yes: {about}", "false": "no, another option is better"}}
        else:
            asked[f"o{i}"] = {"type": "score", "instructions": f"{pick['instructions']} How good is this choice now: {key}? ({about})",
                              "criteria": LEVELS}
    answers = model.call(text, asked, usage)
    names = list(pick["criteria"])
    raw = {back[names[i]]: (a["noul"] if v["method"] == "nouls" else a["score"] / (len(LEVELS) - 1))
           for i, a in ((int(k[1:]), a) for k, a in answers.items())}
    total = sum(raw.values()) or 1
    return {n: r / total for n, r in raw.items()}, text, asked


def ask(x, v, usage):
    if v["order"] == "avg":
        a, text, question = odds_for(x, dict(v, order="engine"), usage)
        b, _, _ = odds_for(x, dict(v, order="reverse"), usage)
        odds = {n: (a.get(n, 0) + b.get(n, 0)) / 2 for n in set(a) | set(b)}
    else:
        odds, text, question = odds_for(x, v, usage)
    chosen = max(odds, key=odds.get) if odds else None
    right = sum(odds.get(e, 0) for e in x["expected"] or [])
    size = len(text if isinstance(text, str) else json.dumps(text)) + len(json.dumps(question))
    return {"id": x["id"], "chosen": chosen, "ok": chosen in x["expected"] if x.get("expected") else None, "p_right": right,
            "confidence": odds.get(chosen, 0) if chosen else 0, "bytes": size, "default": default_option(x)}


def run(name, v, cases):
    usage = model.Usage()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda x: ask(x, v, usage), cases))
    n = len(results)
    acc = sum(1 for r in results if r["ok"]) / n
    p = sum(r["p_right"] for r in results) / n
    sure = [r["confidence"] for r in results if r["ok"]]
    conf = sum(sure) / len(sure) if sure else 0
    size = sum(r["bytes"] for r in results) / n
    print(f"{name:28s} right {acc:4.0%} · p(right) {p:.2f} · confidence when right {conf:.2f} · bytes {size:5.0f} · ${usage.cost:.4f}")
    return results


def parse(spec):
    name, *pairs = spec.split()
    v = dict(BASE)
    for pair in pairs:
        k, val = pair.split("=")
        assert val in KNOBS[k], f"{k} is one of {KNOBS[k]}"
        v[k] = val
    return name, v


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("variants", nargs="+", help='"name knob=value ..." for each variant')
    parser.add_argument("--show", help="print what the model reads for this situation, for the first variant")
    parser.add_argument("--only", help="comma-separated situation ids")
    parser.add_argument("--misses", action="store_true", help="list the situations each variant got wrong")
    parser.add_argument("--all", action="store_true", help="include Blue Moon")
    parser.add_argument("--attacks", action="store_true", help="include attack decisions (left to Forge's AI otherwise)")
    parser.add_argument("--repeat", type=int, default=1, help="run each variant this many times")
    parser.add_argument("--scenarios", action="store_true", help="only the hand-built scenarios (bench/scenarios.py)")
    parser.add_argument("--by-case", action="store_true", help="per situation, how often each variant was right over the repeats")
    parser.add_argument("--dump", help="append every answer (variant, repeat, id, chosen, confidence, p_right, ok) as JSON lines here")
    parser.add_argument("--advisor", help="a pilot file whose advise(state, decision, this_turn) adds a guidance line")
    parser.add_argument("--unlabelled", action="store_true", help="include situations without an expected answer (ok is then null)")
    args = parser.parse_args()
    global ADVISOR
    if args.advisor:
        from goldfish import batch
        ADVISOR = batch.load_pilot(args.advisor).get("advise")
    cases = load(args.only.split(",") if args.only else None, args.all, args.unlabelled)
    if args.scenarios:
        cases = [x for x in cases if x["id"].startswith("scenario-")]
    if not args.attacks:
        cases = [x for x in cases if x["decision"]["kind"] != "attack"]
    if args.show:
        x = load([args.show])[0]
        text, question, _ = render_case(x, parse(args.variants[0])[1])
        print(text if isinstance(text, str) else json.dumps(text, indent=1, ensure_ascii=False))
        print(json.dumps(question, indent=1, ensure_ascii=False))
        return 0
    for spec in args.variants:
        name, v = parse(spec)
        runs = []
        for r in range(args.repeat):
            results = run(name if args.repeat == 1 else f"{name} #{r + 1}", v, cases)
            runs.append(results)
            if args.dump:
                with open(args.dump, "a") as out:
                    for item in results:
                        out.write(json.dumps(dict(item, variant=name, repeat=r)) + "\n")
        if args.repeat > 1:
            acc = sum(1 for rs in runs for r in rs if r["ok"]) / sum(len(rs) for rs in runs)
            print(f"{name:28s} over {args.repeat} runs: right {acc:4.0%}")
        if args.by_case:
            for i, x in enumerate(cases):
                oks = [bool(rs[i]["ok"]) for rs in runs]
                chosen = sorted({str(rs[i]["chosen"]) for rs in runs if not rs[i]["ok"]})
                print(f"    {x['id']:36s} right {sum(oks)}/{len(oks)}" + (f" · wrong picks: {', '.join(chosen)}" if chosen else ""))
        if args.misses:  # from the last repeat
            for r in results:
                if not r["ok"]:
                    print(f"    miss {r['id']}: chose {r['chosen']} (p right {r['p_right']:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
