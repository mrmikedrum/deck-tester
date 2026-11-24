"""A Commander table: seats played by the decision model (Jev), each with its deck, plan and advisor, and open seats
for people joining from their own Forge (Online Multiplayer, Join). The table engine hosts it: Forge's network
server, with the seats' decisions parked like a goldfish game's. Each seat looks ahead in copies of the game in
which the other players pass (and block), and hands what the model doesn't answer to Forge's AI.
"""

import socket
import threading
import time
from typing import Dict, List

from . import batch, decks, engine, model, table_model, table_report

PORT = 36743


class Seat:
    """One agent seat: a name and a deck, which brings its plan and advisor (decks.Deck)."""

    def __init__(self, name: str, deck: "decks.Deck"):
        self.name, self.slug, self.revision, self.plan, self.pilot = name, deck.slug, deck.revision, deck.plan, deck.advisor
        self.deck = deck.list
        self.handlers = batch.load_pilot(deck.advisor) if deck.advisor else {}

    def request(self) -> dict:
        asks = (set(self.handlers) - {"advise"}) | (set(table_model.ASKS) if self.plan else set())
        return {"name": self.name, "commanders": self.deck.commanders, "main": self.deck.main,
                "deck": self.slug, "hash": self.deck.revision(), "ask": sorted(asks), "mana": "auto"}


def address() -> str:
    """This machine's address on the local network, for people joining."""
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("10.255.255.255", 1))
        return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        probe.close()


def play(seat: Seat, session: str, players: int, usage: model.Usage, outcome: Dict[str, str]) -> None:
    """Answer one seat's decisions until the game is over."""
    decider = table_model.TableDecider(seat.plan, players - 1, usage, "outcomes", workers=4,
                                       advise=seat.handlers.get("advise")) if seat.plan else None
    asked: Dict[int, int] = {}
    guarded: dict = {}
    reply = engine.request({"cmd": "decision", "session": session})
    while True:
        if reply.get("decision"):
            try:
                reply = batch.respond(reply, seat.handlers, decider, asked, guarded)
            except engine.EngineError as error:
                print(f"{seat.name}: {error}")
                reply = engine.request({"cmd": "decision", "session": session})
        elif "over" in reply:
            outcome[seat.name] = reply.get("over") or "over"
            return
        else:
            reply = engine.request({"cmd": "decision", "session": session})


def host(seats: List[Seat], people: int, port: int = PORT) -> Dict[str, str]:
    """Open the table, print how to join, play every seat until the game ends; returns each seat's outcome."""
    if any(not seat.plan and "play" not in seat.handlers for seat in seats):
        raise ValueError("Real-deck table seats require a Jev plan or a manual play pilot; stock AI mode is disabled")
    engine.use_table()
    if any(seat.plan for seat in seats):
        model.key()
    reply = engine.request({"cmd": "table", "seats": [seat.request() for seat in seats], "people": people, "port": port})
    print(f"Table open on {address()}:{reply['port']} with {len(seats)} agent seat(s) and {people} open.")
    if people:
        print("Join from Forge: Online Multiplayer, Join a game, enter the address above, choose a Commander deck, ready up.")
    usage = model.Usage()
    outcome: Dict[str, str] = {}
    threads = []
    for seat in seats:
        thread = threading.Thread(target=play, args=(seat, reply["seats"][seat.name], len(seats) + people, usage, outcome),
                                  name=seat.name, daemon=True)
        thread.start()
        threads.append(thread)
    last = None
    began = time.time()
    state = {"state": "?", "slots": []}
    try:
        while any(thread.is_alive() for thread in threads):
            state = engine.request({"cmd": "table_state"})
            now = (state["state"], tuple(state["slots"]))
            if now != last:
                print(f"{state['state']}: " + "; ".join(state["slots"]))
                last = now
            time.sleep(2)
    except KeyboardInterrupt:
        engine.request({"cmd": "table_end"})
        print("table ended")
    for thread in threads:
        thread.join(timeout=5)
    result = engine.request({"cmd": "table_state"})["state"] if state["state"] != "stopped" else "stopped"
    engine.request({"cmd": "table_end"})  # lets the engine go of the game and its seats
    joined = [slot.split(" · ")[0] for slot in state["slots"] if " · remote" in slot]
    path = table_report.save(table_report.manifest(reply, seats, joined, began, result, usage))
    for line in table_report.build(table_report.load(path.stem)):
        print(line)
    return outcome
