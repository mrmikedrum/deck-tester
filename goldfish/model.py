"""Decisions by a small decision model (Jev, through a decisions API), guided by a plain-language
deck plan the agent writes once. At each decision of the agent's own turn, every option is played out in a
fork of the game (the engine replays the game's recorded decisions from its seed, then Forge's AI finishes
the turn), and the model picks among the options reading the plan, the board with card text, and each
option's text and the board it leads to. Anything it can't express (orderings, repeatable modes, mana payment) goes to
Forge's AI, and the record says so. What the model reads was chosen by measuring alternatives on captured
situations (bench/; docs/measurements.md).
"""

import itertools
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from . import engine, records, render

KEYS = Path.home() / ".config" / "goldfish"


class Provider:
    """A decisions API: OpenRouter's and Defapi's take the same request and give the same answers."""

    def __init__(self, name: str, url: str, model: str, variable: str):
        self.name, self.url, self.variable = name, url, variable
        self.model = os.environ.get("GOLDFISH_DECISION_MODEL", model)
        self.file = KEYS / f"{name}.key"

    def key(self) -> Optional[str]:
        return os.environ.get(self.variable) or (self.file.read_text().strip() if self.file.exists() else None)


PROVIDERS = [
    Provider("openrouter", "https://openrouter.ai/api/alpha/decisions", "typesafe/jev-1.14", "OPENROUTER_API_KEY"),
    Provider("defapi", "https://api.defapi.org/api/v1/decisions", "typesafe/jev-1.13", "DEFAPI_API_KEY"),
]


def provider() -> Provider:
    """GOLDFISH_DECISION_PROVIDER if set, otherwise the first provider with a key."""
    named = os.environ.get("GOLDFISH_DECISION_PROVIDER")
    for candidate in PROVIDERS:
        if candidate.name == named if named else candidate.key():
            return candidate
    where = "; ".join(f"{p.variable} or {p.file}" for p in PROVIDERS)
    raise ModelError(f"no decisions API key: set one of {where}" if not named else f"no provider {named}")


KINDS = ("mulligan", "play", "targets", "mode", "number", "confirm", "choose", "attack")
MAX_NUMBERS = 21  # an X with more choices than this goes to Forge's AI
MIN_KEEP = 4  # stop paying London cards at four; an opening-hand test must not start empty
MAX_OPTIONS = 30  # a pick with more options than this (creature types, say) goes to Forge's AI

GAME = ("Commander goldfish against {opponents} opponents at 40 life who only play lands and never block or "
        "interact. Follow the deck plan's development and sequencing goals. This tests whether the engine "
        "assembles and keeps offering useful plays, not the fastest damage race. Incidental damage, spending "
        "all available mana, or a larger next-turn mana total does not by itself make a line better. Preserve "
        "useful resources and interaction when spending them would not advance the plan.")

INSTRUCTIONS = {
    "mulligan": ("Keep this opening hand, or shuffle it away for a new one? Keep a hand with two to four lands "
                 "that make the colours its spells need; mulligan the rest."),  # it doesn't count: the rule and the facts are stated
    "play": ("You have priority. Pick the next thing to do, or pass. Passing in your first main phase moves on "
             "to combat and then your second main phase; passing there ends your turn. With something on the "
             "stack, you are responding to it."),
    "targets": "Pick the target.",
    "mode": "Pick the mode.",
    "number": "Pick the number.",
    "confirm": "Answer yes or no.",
    "choose": "Pick the requested cards or objects.",
    "attack": "Attack with this creature?",
}

DEFAULT = " (default selection)"  # marks the option Forge's AI would take


class ModelError(Exception):
    pass


def check() -> str:
    """One tiny real call: the key works, and how fast and dear a decision is."""
    usage = Usage()
    used = provider()
    began = time.time()
    answer = call("Turn 1, your main phase. Hand: Forest, Llanowar Elves. No lands on the battlefield.",
                  {"pick": {"type": "choice", "instructions": "What do you do first?",
                            "criteria": {"Forest": "play Forest as your land", "pass": "do nothing"}}}, usage)["pick"]
    return (f"{used.model} on {used.name}: picked {answer['choice']} ({answer.get('confidence', 0):.0%}) in "
            f"{time.time() - began:.2f}s, {usage.input_tokens} tokens, ${usage.cost:.6f}")


def key() -> str:
    used = provider()
    if not used.key():
        raise ModelError(f"no {used.name} key: set {used.variable} or put it in {used.file}")
    return used.key()


class Usage:
    """Calls, cost and time across threads, for the batch manifest."""

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = 0
        self.input_tokens = 0
        self.cost = 0.0
        self.seconds = 0.0
        self.failed = 0  # calls the API never answered, even after retries: Forge's AI decided those
        self.api_retries = 0
        self.api_timeouts = 0
        self.api_wall_seconds = 0.0
        self.routed = 0  # fast mode: decisions answered from the text alone, confidently enough to skip the forks
        self.played_out = 0  # lines played out in forks to show the model their results
        self.drifted = 0  # decisions whose forks failed: didn't replay into the same game, or stalled in Forge
        self.fork_ms = 0  # replaying the game to the decision
        self.setup_ms = 0  # of which, building the game
        self.rollout_ms = 0  # playing the line out to the next turn
        self.rollout_steps = 0  # decisions Forge's AI answered while doing so
        self.end_ms = 0

    def add(self, usage: dict, seconds: float) -> None:
        with self.lock:
            self.calls += 1
            self.input_tokens += usage.get("input_tokens", 0)
            self.cost += float(usage.get("consumed") or usage.get("cost") or 0.0)  # what was billed, where given
            self.seconds += seconds

    def summary(self) -> dict:
        return {"model": provider().model, "calls": self.calls, "input_tokens": self.input_tokens, "cost": round(self.cost, 4),
                "seconds_per_call": round(self.seconds / self.calls, 2) if self.calls else None,
                "api_retries": self.api_retries, "api_timeouts": self.api_timeouts,
                "api_wall_seconds": round(self.api_wall_seconds, 2),
                "routed": self.routed, "failed": self.failed, "played_out": self.played_out, "drifted": self.drifted,
                "fork_ms": round(self.fork_ms / self.played_out) if self.played_out else None,
                "setup_ms": round(self.setup_ms / self.played_out) if self.played_out else None,
                "rollout_ms": round(self.rollout_ms / self.played_out) if self.played_out else None,
                "rollout_steps": round(self.rollout_steps / self.played_out, 1) if self.played_out else None,
                "end_ms": round(self.end_ms / self.played_out) if self.played_out else None}


def call(state: str, questions: Dict[str, dict], usage: Optional[Usage] = None, session: Optional[str] = None,
         retries: int = 6) -> Dict[str, dict]:
    """One request to the decisions API; returns the answers by question name."""
    used = provider()
    body = {"model": used.model, "state": state, "questions": questions}
    if session:
        body["session_id"] = session
    request = urllib.request.Request(used.url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    wall_began = time.monotonic()
    for attempt in range(retries + 1):
        began = time.time()
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                reply = json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            if error.code in (429, 500, 502, 503, 524, 529) and attempt < retries:
                if usage:
                    with usage.lock:
                        usage.api_retries += 1
                time.sleep(2 ** attempt)
                continue
            if usage:
                with usage.lock:
                    usage.api_wall_seconds += time.monotonic() - wall_began
            raise ModelError(f"decisions API {error.code}: {detail}") from None
        except OSError as error:  # URLError, and socket.timeout, which isn't TimeoutError before Python 3.10
            if usage:
                with usage.lock:
                    if isinstance(error, TimeoutError) or "timed out" in str(error).lower():
                        usage.api_timeouts += 1
                    if attempt < retries:
                        usage.api_retries += 1
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            if usage:
                with usage.lock:
                    usage.api_wall_seconds += time.monotonic() - wall_began
            raise ModelError(f"decisions API unreachable: {error}") from None
        if usage:
            usage.add(dict(reply.get("usage", {}), consumed=reply.get("consumed")), time.time() - began)
            with usage.lock:
                usage.api_wall_seconds += time.monotonic() - wall_began
        return reply["answers"]
    raise ModelError("decisions API: out of retries")


def turn(decision: dict) -> int:
    return int(re.match(r"T(\d+)", decision["turn"]).group(1))


def ours(decision: dict) -> bool:
    """A decision in the agent's own turn ("T3 main1", not "T3 Opp 1 upkeep" or another player's at a table)."""
    if decision["turn"].endswith("setup"):
        return False
    return decision["mine"] if "mine" in decision else not re.match(r"T\d+ Opp ", decision["turn"])


# ---- what the model reads ----

def this_turn(path: str, now: int) -> str:
    """This turn so far, as one line of what happened (more history measured no better)."""
    facts = [f for f in records.timeline(records.load(path)) if f.get("turn") == now]
    digest = records.digest(facts)
    return digest[0] if digest else ""


BASIC_LANDS = {"Plains": "W", "Island": "U", "Swamp": "B", "Mountain": "R", "Forest": "G", "Wastes": "C"}
COLOURS = "WUBRG"


def is_land(name: str, state: dict) -> bool:
    """A land: a basic by name, or by the type line in the state's card text."""
    return name.split(" ")[0] in BASIC_LANDS and name in BASIC_LANDS or (
        "Land" in (state.get("text", {}).get(name, "").split(" — ") + ["", ""])[1])


def lands_in(cards: List[str], state: dict) -> int:
    return sum(1 for name in cards if is_land(name, state))


def colours_made(name: str, state: dict) -> set:
    """The colours a land in hand would make, from its name or text ("Add {G} or {U}", "any color")."""
    if name in BASIC_LANDS:
        return {BASIC_LANDS[name]} - {"C"}
    text = state.get("text", {}).get(name, "")
    if "any color" in text or "any type" in text or "commander's color identity" in text:
        return set(COLOURS)
    return {c for c in COLOURS if "{" + c + "}" in text.split(" — ")[-1]}


def colours_needed(name: str, state: dict) -> set:
    """The colours in a spell's mana cost, from the cost after its name in the card text."""
    head = state.get("text", {}).get(name, "").split(" — ")[0]
    return {c for c in COLOURS if "{" + c + "}" in head or "/" + c + "}" in head}


def mulligan_facts(state: dict) -> str:
    """What the model can't count or infer about an opening hand: how many lands, which colours they make, and
    which cards need a colour they don't."""
    hand = state["hand"]
    lands = [n for n in hand if is_land(n, state)]
    made = set().union(*(colours_made(n, state) for n in lands)) if lands else set()
    short = [n for n in hand if n not in lands and colours_needed(n, state) - made]
    line = f"Lands in hand: {len(lands)} of {len(hand)}" + (f", making {' '.join(c for c in COLOURS if c in made)}" if made else "")
    if any("search your library" in state.get("text", {}).get(n, "").lower() for n in lands):
        line += ". Fetch/search lands can provide additional colours only if suitable targets remain; check their text"
    if short:
        line += f". Cards needing a colour not directly shown by these lands: {', '.join(short)}"
    return line + "."


def describe(guide: str, state: dict, decision: dict, opponents: int, so_far: str = "", guidance: Optional[str] = None,
             table: Optional[str] = None, others: Optional[List[str]] = None) -> str:
    """The plan, the table, the agent's board with card text, this turn so far, and the decision. The
    opponents, exile and library count are left out: they measured as noise. A mulligan says how many
    lands the hand holds and what they make, since the model doesn't count; a play decision says whether
    the land drop is still there. Guidance is the pilot's line about this position, when it gives one."""
    lines = [f"Deck plan: {guide.strip()}", (table or GAME).format(opponents=opponents)]
    if guidance:
        lines.append(f"Guidance for this position: {guidance.strip()}")
    for line in render.state(state, full=True):
        if not line.startswith(("opponents:", "exile:")):
            lines.append(re.sub(r" · library \d+", "", line))
    lines += others or []  # a table's decider shows the other players here
    if table is None and state.get("opponents") and all(o.get("other") == 0 for o in state["opponents"]):
        lines.append("Opponents have no nonland permanents. A removal spell has no opposing nonland target; "
                     "a creature wipe would remove only your own creatures. Keep those cards unless a concrete "
                     "self-target or death-trigger benefit is worth the resources lost.")
    if decision["kind"] == "mulligan" or bottoming(decision):
        lines.append(mulligan_facts(state))
    elif decision["kind"] == "play" and ours(decision) and "land_drop" in state and lands_in(state["hand"], state):
        lines.append("A land can still be played this turn." if state["land_drop"] else "The land drop is used this turn.")
    if state.get("text"):
        lines.append("Card text:")
        lines += [f"- {text}" for text in state["text"].values()]
    if so_far and decision["kind"] != "mulligan":
        lines.append(f"This turn so far: {so_far}")
    lines.append(f"Now: {decision['turn']}, {decision['kind']}" + (f" ({decision['prompt']})" if decision.get("prompt") else ""))
    return "\n".join(lines)


def bottoming(decision: dict) -> bool:
    """Forge's London mulligan hand-bottoming decision, not a library selection during play."""
    return decision["kind"] == "choose" and bool(re.fullmatch(r"put \d+ on the bottom", decision.get("prompt", "")))


def mulligan_policy(state: dict) -> Optional[str]:
    """Bound the existing two-to-four-land opening policy; colour/sequence judgments stay with the model.

    Forge has already bottomed the London cards when it asks keep, despite the prompt saying "then".
    Never apply the seven-card rule forever to a shrinking hand.
    """
    hand = state["hand"]
    if len(hand) <= MIN_KEEP:
        return "keep"
    if not 2 <= lands_in(hand, state) <= 4:
        return "mulligan"
    return None


def instructions(decision: dict, state: Optional[dict] = None) -> str:
    if decision["kind"] == "mulligan" and state is not None:
        return (f"Keep these {len(state['hand'])} cards, or take another mulligan? Further mulligans can shrink the hand. Forge has already "
                "bottomed any London cards: judge the hand shown, do not subtract the prompt's bottom count again. "
                "Prefer functional colours and early development, but weigh the cost of shrinking the hand further.")
    if bottoming(decision):
        return ("Choose the cards to put on the bottom for the London mulligan. Preserve the lands/colours "
                "and early development that make the kept hand functional; bottom redundant or late cards "
                "before the only source of a needed colour. " + decision["prompt"] + ".")
    if decision["kind"] == "number":
        return ("Choose the number. An X of zero can legally cast a spell without producing its intended "
                "resource; choose it only for a concrete useful trigger or other stated benefit, not merely "
                "because it is affordable. Budget mana for the follow-up. " + decision.get("prompt", ""))
    return INSTRUCTIONS[decision["kind"]] + (f" ({decision['prompt']})" if decision.get("prompt") else "")


def option_text(decision: dict, name: str) -> str:
    """An option's full text (the card or ability), or its name when there is nothing more to say."""
    if name in decision["options"]:
        i = decision["options"].index(name)
        details = decision.get("details") or []
        if i < len(details) and details[i] and details[i] != "pass priority":
            return details[i]
    return name


MAX_LINES = 10  # options played out per decision; a decision with more is asked without results


def lines_to_try(decision: dict) -> Dict[str, list]:
    """The options to play out, by the name the model sees, as answers (labels, or a number)."""
    options = decision["options"]
    if decision["kind"] == "mulligan" or bottoming(decision):
        return {}  # do not expose the next hand/draw while deciding the opening hand
    if not options:
        low, high = decision["min"], decision["max"]
        values = list(range(low, high + 1))
        if len(values) > MAX_LINES:
            # Always compare both endpoints and the smallest positive payment. Striding used to omit
            # X=1 or the maximum, even though those are often the meaningful tempo choices.
            anchors = {low, high} | ({1} if low <= 1 <= high else set())
            spread = [low + round((high - low) * i / (MAX_LINES - 1)) for i in range(1, MAX_LINES - 1)]
            middle = [n for n in spread if n not in anchors]
            values = sorted(anchors | set(middle[:MAX_LINES - len(anchors)]))
        return {f"X = {n}": [n] for n in values}
    if decision["max"] == 1:
        found: Dict[str, list] = {}
        for label in options:
            found.setdefault(label, [label])
        if decision["min"] == 0:
            found["nothing"] = []
        return found if len(found) <= MAX_LINES else {}
    if decision["kind"] == "attack":
        first: Dict[str, str] = {}
        for label in options:
            first.setdefault(label.split(" -> ")[0], label)
        return {"attack with everything": list(first.values()), "no attack": []}
    return {}


def line_name(decision: dict, picked: List[str], tries: Dict[str, list]) -> str:
    """The name, among the lines tried, of an answer given as labels (Forge's AI's default pick)."""
    if not decision["options"]:
        return f"X = {picked[0]}" if picked else "nothing"
    if decision["kind"] == "attack":
        return "attack with everything" if picked else "no attack"
    return picked[0] if picked else "nothing"


def summarize(before: dict, facts: List[dict], after: Optional[dict], now: int) -> Optional[dict]:
    """A played-out line, reduced to what the model compares: this turn's actions, next turn's mana,
    damage, and permanents gained or lost."""
    if after is None:
        return None
    gone = [p["name"] for p in before["battlefield"]]
    new = [p["name"] for p in after["battlefield"]]
    sizes = {p["name"]: p["pt"] for p in after["battlefield"] if p.get("pt")}
    for name in list(gone):
        if name in new:
            new.remove(name)
            gone.remove(name)
    # Lands leaving play are usually fetches doing their job; losing other permanents is what to flag.
    lands = {n for n, t in before.get("text", {}).items() if "Land" in (t.split(" — ") + ["", ""])[1]}
    eot = next((f for f in facts if f["t"] == "eot" and f.get("turn") == now), None)
    # Drawn cards stay hidden: a line that names the next draw would tell the model what the library holds.
    shown = [dict(f, card="a card") if f["t"] == "draw" else f for f in facts if f.get("turn") == now]
    return {"acts": records.happened(shown) or "nothing else this turn",
            "mana": after["mana"], "unspent": eot["unspent"] if eot else None,
            "damage": sum(o["life"] for o in before["opponents"]) - sum(o["life"] for o in after["opponents"]),
            "new": [n + (f" {sizes[n]}" if n in sizes else "") for n in new], "lost": [n for n in gone if n not in lands]}


def worded(results: Dict[str, Optional[dict]]) -> Dict[str, str]:
    """Each line's result compared with the others in words: the model reads words better than numbers."""
    every = [r for r in results.values() if r]
    best_mana = max((r["mana"] for r in every), default=0)
    best_damage = max((r["damage"] for r in every), default=0)
    out = {}
    for name, r in results.items():
        if r is None:
            out[name] = "the game ends"
            continue
        parts = [r["acts"], "the most mana next turn of these options" if r["mana"] == best_mana
                 else "less mana next turn than the best option"]
        if r.get("unspent") is not None:
            parts.append("spends all its mana this turn" if r["unspent"] == 0 else f"leaves {r['unspent']} mana unspent this turn")
        if best_damage > 0:
            parts.append("deals the most damage of these options" if r["damage"] == best_damage
                         else "deals no damage" if r["damage"] <= 0 else "deals less damage than the best option")
        if r["new"]:
            parts.append("adds " + ", ".join(r["new"]))
        if r["lost"]:
            parts.append("you lose your own " + ", ".join(r["lost"]))
        out[name] = "; ".join(parts)
    return out


def after_line(before: dict, facts: List[dict], after: Optional[dict], now: int) -> str:
    """A played-out line as the board it leads to, in absolute terms, the way a player pictures a play: what
    happened this turn (draws unnamed), then lands, mana next turn, cards in hand, mana left unspent, and the
    nonland permanents. Measured against the comparative wording on 29 labelled situations: 89% to 82%."""
    if after is None:
        return "the game ends"
    shown = [dict(f, card="a card") if f["t"] == "draw" else f for f in facts if f.get("turn") == now]
    lands = [p for p in after["battlefield"] if is_land(p["name"], before)]
    others = [render._permanent(p) for p in after["battlefield"]
              if p not in lands or p.get("counters") or p.get("pt")]
    eot = next((f for f in shown if f["t"] == "eot"), None)
    parts = [records.happened(shown) or "nothing else this turn",
             f"after: {len(lands)} lands, {after['mana']} mana next turn, {len(after['hand'])} cards in hand"]
    if after.get("exile"):
        parts.append(f"{len(after['exile'])} cards remain in exile; these are not hand cards and their "
                     "play permissions/duration depend on the source effect and may outlast this rollout horizon")
    if eot:
        parts.append(f"{eot['unspent']} mana unspent this turn")
    parts.append("board: " + (", ".join(others) if others else "no nonland permanents"))
    # Attribute losses explicitly; a same-named replacement is not the original engine surviving.
    remaining = {p["id"] for p in after["battlefield"] if "id" in p}
    lost = [p["name"] for p in before["battlefield"] if "id" in p and p["id"] not in remaining
            and not is_land(p["name"], before)]
    if lost:
        parts.append("you lose your own " + render.names(lost))
    failed = [f.get("card", f["t"]) for f in shown if f.get("failed") and f["t"] in ("cast", "activate", "attack")]
    if failed:
        parts.append(f"{len(failed)} failed action(s): " + render.names(failed))
    return "; ".join(parts)


def plain_options(decision: dict) -> Optional[Dict[str, list]]:
    """Options asked without results (outside the agent's turn, or too many to play out): single picks,
    numbers, and small London-bottom combinations; None hands the decision to Forge's AI."""
    if decision["kind"] not in KINDS or decision.get("repeat"):
        return None
    if not decision["options"]:
        if decision["max"] - decision["min"] + 1 > MAX_NUMBERS:
            return None
        return {str(n): [n] for n in range(decision["min"], decision["max"] + 1)}
    if decision["max"] != 1:
        if bottoming(decision) and decision["min"] == decision["max"]:
            # Seven-card opening hands have at most 35 ways to bottom any number. Do not silently
            # hand those strategic choices to Forge just because the UI asks for several cards.
            count = decision["min"]
            combinations = list(itertools.islice(itertools.combinations(decision["options"], count), 36))
            if len(combinations) <= 35:
                return {"bottom " + ", ".join(cards): list(cards) for cards in combinations}
        return None
    found: Dict[str, list] = {}
    for label in decision["options"]:
        found.setdefault(label, [label])
    if decision["min"] == 0:
        found["nothing"] = []
    return found if len(found) <= MAX_OPTIONS else None


ROLLOUT = 400  # decisions in one played-out line before it's abandoned
HYBRIDS = ("outcomes", "plain")
FAST = 0.7  # fast mode: a plain pick at least this confident is played without playing the options out (docs: "Routing")
# Forks replaying at once across every game in this process: throughput stops growing at about eight on ten
# cores (bench/forkbench.py), and beyond that each fork only waits longer.
FORKS_AT_ONCE = threading.BoundedSemaphore(int(os.environ.get("GOLDFISH_FORKS", "8")))


class Line:
    """One option played out in a fork: its facts, the state it ended in, and whether the game ended."""

    def __init__(self, picked: List[str], facts: List[dict], state: Optional[dict], over: Optional[str], ms: int):
        self.picked, self.facts, self.state, self.over, self.ms = picked, facts, state, over, ms


class Decider:
    """A game's decisions by the model. With outcomes (the default), each decision of the agent's own turn
    has its options played out, each in a fork of the game, by Forge's AI to the start of the next turn, and
    the model picks among them reading each option's text and result, with Forge's own pick marked as the
    default selection; elsewhere it picks from the text alone. Plain never plays out.
    """

    kinds = KINDS  # the decisions it answers; the rest go to Forge's AI

    def __init__(self, guide: str, opponents: int, usage: Usage, hybrid: str = "outcomes", workers: int = 4,
                 fast: bool = False, advise=None):
        self.guide, self.opponents, self.usage, self.hybrid, self.workers = guide, opponents, usage, hybrid, workers
        self.route = FAST if fast else 0.0  # the confidence at which a text-only pick skips the forks; 0 never skips
        self.advise = advise  # the pilot's advise(state, decision, this_turn), or None
        self._failed_states = {}  # session -> observed state, timeline length, rejected play labels
        self.fork_via = None  # "replay" or "copy" to choose how forks are made; None: as the game was set up

    # ---- the engine ----

    @staticmethod
    def send(reply: dict, answer: dict) -> dict:
        """Answer the waiting decision (option numbers, or defer)."""
        return engine.request(dict(answer, cmd="answer", session=reply["session"]))

    def play_out(self, reply: dict, first: Optional[list]) -> Line:
        """Fork the game and play the line that starts with first (labels or a number; None for Forge's AI's
        pick) to the start of the next turn, with Forge's AI deciding the rest. Raises EngineError when the
        fork didn't replay into the same game, or stalled."""
        decision = reply["decision"]
        now = turn(decision)
        with FORKS_AT_ONCE:
            return self._play_out(reply, decision, now, first)

    def _play_out(self, reply: dict, decision: dict, now: int, first: Optional[list]) -> Line:
        request = {"cmd": "fork", "session": reply["session"], "horizon": now + 1}
        if self.fork_via:
            request["via"] = self.fork_via
        fork = engine.request(request)
        session = fork["session"]
        # Passing means doing nothing more this turn (or, on another player's turn, before this player's next),
        # so a pass line keeps passing its later play decisions instead of letting Forge's AI play on and make
        # "pass" look productive.
        passing = decision["kind"] == "play" and first == ["pass"]
        steps = 0
        clock = time.time()
        try:
            began = os.path.getsize(fork["records"])  # the line's facts are what the fork's record gains from here
            request = {"cmd": "answer", "session": session, "by": "model"}
            request.update({"defer": True} if first is None else {"answer": _numbers(decision, first)})
            after = engine.request(request)
            state = None
            for _ in range(ROLLOUT):
                if not after.get("decision"):
                    break
                # the next turn, at rest: its first play decision with nothing on the stack, or its attack when
                # nothing could be played before it
                if after["decision"]["kind"] in ("play", "attack") and turn(after["decision"]) > now:
                    state = engine.request({"cmd": "state", "session": session})["state"]
                    if not state["stack"]:
                        break
                if (passing and after["decision"]["kind"] == "play" and turn(after["decision"]) == now
                        and ours(after["decision"]) == ours(decision)):
                    after = engine.request({"cmd": "answer", "session": session, "answer": [1], "by": "model"})
                else:
                    after = engine.request({"cmd": "answer", "session": session, "defer": True})
                steps += 1
            if after.get("over") == "horizon":
                # the engine stopped the line at the next turn's first main phase: nothing was asked on the way
                state = engine.request({"cmd": "state", "session": session})["state"]
                after = {}
            with open(fork["records"], encoding="utf-8") as handle:
                handle.seek(began)
                facts = [json.loads(line) for line in handle if line.strip()]
            rolled = time.time()
        finally:
            engine.request({"cmd": "end", "session": session})
        picked = next((f["answer"] for f in facts if f["t"] == "decision" and f["kind"] == decision["kind"]), [])
        with self.usage.lock:
            self.usage.played_out += 1
            self.usage.fork_ms += fork.get("ms", 0)
            self.usage.setup_ms += fork.get("setup_ms", 0)
            self.usage.rollout_ms += int(1000 * (rolled - clock))
            self.usage.rollout_steps += steps
            self.usage.end_ms += int(1000 * (time.time() - rolled))
        return Line(picked, facts, state, after.get("over"), fork.get("ms", 0))

    def explore(self, reply: dict, tries: Dict[str, list]) -> Tuple[Dict[str, Line], Optional[str]]:
        """Play out Forge's AI's pick and every line to try, in parallel forks. Returns the lines by name and
        the name of the AI's pick (added as a line of its own when it isn't among those tried), or None for
        the lines when a fork failed."""
        names = [None] + list(tries)
        with ThreadPoolExecutor(max_workers=max(1, min(self.workers, len(names)))) as pool:
            played = list(pool.map(lambda name: self.play_out(reply, None if name is None else tries[name]), names))
        lines = dict(zip(tries, played[1:]))
        default = played[0]
        decision = reply["decision"]
        if not default.picked and (decision["min"] >= 1 or not decision["options"]):
            return lines, None  # Forge's AI answered nothing where something was required: no line to show
        default_name = self.line_name(decision, default.picked, tries)
        if default_name not in lines:
            lines[default_name] = default
        return lines, default_name

    # ---- what the model reads, and which decisions it looks ahead on (a table's decider changes these) ----

    def context(self, state: dict, decision: dict, so_far: str, guidance: Optional[str]) -> str:
        return describe(self.guide, state, decision, self.opponents, so_far, guidance)

    def instructions(self, decision: dict, state: dict) -> str:
        return instructions(decision, state)

    def explores(self, decision: dict) -> bool:
        """Whether this decision's options are played out: the agent's own turn."""
        return ours(decision)

    def lines(self, decision: dict) -> Dict[str, list]:
        """The lines to play out, by the name the model sees."""
        return lines_to_try(decision)

    def line_name(self, decision: dict, picked: List[str], tries: Dict[str, list]) -> str:
        """The name of Forge's AI's own pick among the lines (added as a line of its own when it isn't one)."""
        return line_name(decision, picked, tries)

    def result(self, before: dict, line: Line, now: int) -> str:
        """A played-out line as the model reads it."""
        return after_line(before, line.facts, line.state, now)

    def rejected_plays(self, session: str, state: dict, facts: List[dict]) -> set:
        """Do not retry an engine-rejected action in an identical observed position.

        This uses actual failure feedback, not a second legality test. Any state change permits a retry.
        """
        previous, began, blocked = self._failed_states.get(session, (None, len(facts), set()))
        if previous != state:
            blocked, began = set(), len(facts)
        else:
            blocked.update(f["as"] for f in facts[began:] if f["t"] in ("cast", "activate")
                           and f.get("failed") and f.get("as"))
        self._failed_states[session] = (state, len(facts), blocked)
        return blocked

    # ---- deciding ----

    def step(self, reply: dict) -> dict:
        """Decide the waiting decision, answer it, and return the engine's next reply. A decision the API never
        answers goes to Forge's AI and is counted, rather than ending the game."""
        try:
            return self._step(reply)
        except ModelError:
            with self.usage.lock:
                self.usage.failed += 1
            return self.send(reply, {"defer": True})

    def _step(self, reply: dict) -> dict:
        decision, session = reply["decision"], reply["session"]
        if decision["kind"] not in self.kinds or decision.get("repeat"):
            return self.send(reply, {"defer": True})
        state = engine.request({"cmd": "state", "session": session, "text": True})["state"]
        if decision["kind"] == "mulligan":
            opening = mulligan_policy(state)
            if opening is not None:
                # This is an explicit pilot policy, not a model judgment or a forced rules decision.
                return self.send(reply, {"answer": _numbers(decision, [opening]), "by": "policy"})
        this_turn_facts = [f for f in records.timeline(records.load(reply["records"])) if f.get("turn") == turn(decision)]
        blocked = self.rejected_plays(session, state, this_turn_facts) if decision["kind"] == "play" else set()
        guidance = self.advise(state, decision, this_turn_facts) if self.advise else None
        digest = records.digest(this_turn_facts)
        context = self.context(state, decision, digest[0] if digest else "", guidance)
        failures = [f for f in this_turn_facts if f.get("failed") and f["t"] in ("cast", "activate", "attack")]
        if failures:
            # The turn digest deliberately lists successful plays only. Without this feedback a rejected
            # activation looks untried, so the model can spend its whole turn submitting it again.
            context += ("\nFailed actions this turn: " + records.happened(failures) +
                        ". Do not repeat an unchanged failed action; first change its unmet precondition, "
                        "choose another useful play, or pass.")
        tries = self.lines(decision) if self.hybrid != "plain" and self.explores(decision) else {}
        tries = {name: picks for name, picks in tries.items() if name not in blocked}
        lines, default = {}, None
        if len(tries) >= 2 and self.route > 0:
            # Fast mode: ask from the text first, play a confident pick as it is, and play the options out only
            # for an unsure one. Saves about a sixth of the forks for half as many calls again, and whether it
            # costs play quality couldn't be told from 20 games (docs/measurements.md), so it is off by default.
            plain = {name: option_text(decision, name) for name in tries}
            answer = call(context, {"pick": {"type": "choice", "instructions": self.instructions(decision, state), "criteria": plain}},
                          self.usage, session)["pick"]
            if answer.get("confidence", 0.0) >= self.route and answer.get("choice") in tries:
                with self.usage.lock:
                    self.usage.routed += 1
                try:
                    return self.send(reply, {"answer": _numbers(decision, tries[answer["choice"]]), "by": "model",
                                             "p": answer.get("confidence", 0.0)})
                except (ValueError, engine.EngineError):
                    pass
        if len(tries) >= 2:
            try:
                lines, default = self.explore(reply, tries)
                lines = {name: line for name, line in lines.items() if name not in blocked}
            except engine.EngineError as error:
                if "drifted" not in str(error) and "stalled" not in str(error):
                    raise
                with self.usage.lock:
                    self.usage.drifted += 1
                lines, default = {}, None
        if lines:
            tries = {name: (tries[name] if name in tries else _as_answer(decision, lines[name].picked)) for name in lines}
            criteria = {}
            for name, line in lines.items():
                text = option_text(decision, name)
                result = self.result(state, line, turn(decision))
                criteria[name] = (text + " → " if text != name else "") + result + (DEFAULT if name == default else "")
        else:
            tries = plain_options(decision)
            if tries is not None:
                tries = {name: picks for name, picks in tries.items() if name not in blocked}
            if tries and len(tries) == 1 and blocked:
                return self.send(reply, {"answer": _numbers(decision, next(iter(tries.values()))), "by": "policy"})
            if not tries or len(tries) < 2:
                return self.send(reply, {"defer": True})
            criteria = {name: option_text(decision, name) for name in tries}
        answer = call(context, {"pick": {"type": "choice", "instructions": self.instructions(decision, state), "criteria": criteria}},
                      self.usage, session)["pick"]
        try:
            picks = _numbers(decision, tries[answer["choice"]])
            return self.send(reply, {"answer": picks, "by": "model", "p": answer.get("confidence", 0.0)})
        except (KeyError, ValueError, engine.EngineError):
            return self.send(reply, {"defer": True})  # not an answer the engine takes: Forge's AI decides


def _as_answer(decision: dict, picked: List[str]) -> list:
    """Forge's AI's pick, recorded as labels (or a number), as an answer to give again."""
    return [int(p) for p in picked] if not decision["options"] else list(picked)


def _numbers(decision: dict, picked: list) -> List[int]:
    """Option numbers for labels (or numbers, for a number decision) in this listing of the decision."""
    if not decision["options"]:
        return [int(picked[0])]
    numbers, used = [], set()
    for label in picked:
        found = [i + 1 for i, option in enumerate(decision["options"]) if option == label and i + 1 not in used]
        if not found:
            raise ValueError(f"no option {label}")
        numbers.append(found[0])
        used.add(found[0])
    return numbers
