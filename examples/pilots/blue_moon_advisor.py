"""Advisor for the Blue Moon deck. Its engine is Moons: a copy of Princess Yue dies to the legend rule and returns
as a land keeping a creature's abilities, and tap and untap loops work on those lands. The lines say what makes a
Moon now, what a choice turns it into, and which loop pieces are on the board. Facts only; the played-out options
show what each line does."""

from deckmaster.advice import Advisor

adv = Advisor()
YUE = "Princess Yue"
adv.role("untap legendary", "Minamo, School at Water's Edge")
adv.role("untap land", "Deserted Temple")
adv.role("untap any", "North Pole Patrol", "Roll-Roll-Roll-Roll", "Silver Surfer, Cosmic Voyager", "Teferi's Time Twist", "Ghostly Flicker")
adv.role("tap outlet", "Springleaf Drum", "Holdout Settlement", "Survivors' Encampment", "Moonsnare Prototype", "Paradise Mantle")
adv.role("tap payoff", "Tui and La, Moon and Ocean", "Fallowsage", "Gran-Gran")
adv.role("untap payoff", "Wake Thrasher", "Tui and La, Moon and Ocean")
adv.role("scry payoff", "Matoya, Archon Elder")
adv.role("draw payoff", "Alandra, Sky Dreamer", "Mischievous Mystic", "Emrakul's Messenger")
adv.role("land copier", "Copy Land", "Vesuva", "Thespian's Stage")
# A clone that copies Yue returns as a Moon copying a creature chosen then; a Yue maker's creature returns as itself.
# Machine God's Effigy is in neither: its copy isn't a creature, so it doesn't die and return.
adv.role("clone", "Phantasmal Image", "Phyrexian Metamorph", "Vizier of Many Faces", "Clever Impersonator", "Mirror Image",
         "Glasspool Mimic", "Sakashima's Student", "Omni-Changeling", "Naga Fleshcrafter", "Visage Bandit", "Waxen Shapethief")
adv.role("yue maker", "Metamorphic Alteration", "Blade of Shared Souls")
adv.role("devotion payoff", "Nykthos, Shrine to Nyx", "Master of Waves")
adv.role("moon payoff", "Tui and La, Moon and Ocean", "Fallowsage", "Gran-Gran", "Pestered Wellguard", "Nanoform Sentinel")


def on_board(p, role):
    return [n for n in p.board if adv.matches(role, n, p)]


def yue_is_creature(p):
    return "Creature" in p.text(YUE).split(" — ")[1] if " — " in p.text(YUE) else True


def clones_now(p):
    """The clones being cast now, or the one whose copy choice this is ("Choose a card (Phyrexian Metamorph)")."""
    if p.kind == "choose":
        return [n for n in adv.roles["clone"] if f"({n})" in p.decision.get("prompt", "")]
    return [n for n in p.castable if adv.matches("clone", n, p)]


# Making a Moon: a copy of Yue dies to the legend rule (the commander stays) and returns as a land.
adv.when(lambda p: "Princess Yue is on the battlefield: a copy of her made by " + ", ".join(clones_now(p))
                   + " dies to the legend rule while she stays, and returns as a Moon copying a creature chosen then"
                   + ("; a Phantasmal Image Moon is sacrificed when targeted, so Deserted Temple and Minamo can't untap it"
                      if "Phantasmal Image" in clones_now(p) else "") + ".",
         board=[YUE], kinds=("play", "choose"), test=lambda p: yue_is_creature(p) and bool(clones_now(p)))
adv.when(lambda p: ", ".join(n for n in p.castable if adv.matches("yue maker", n, p))
                   + " can make one of your creatures a copy of Princess Yue: that card dies to the legend rule while she stays, "
                   "and returns as a Moon with its own abilities (a token doesn't return).",
         board=[YUE], castable=["yue maker"], test=yue_is_creature)
adv.when(lambda p: "Princess Yue can be cast from the command zone, and " + ", ".join(n for n in p.hand if adv.matches("clone", n, p) or adv.matches("yue maker", n, p))
                   + " in hand can copy her once she is on the battlefield.",
         castable_from={"command": [YUE]}, any_of={"hand": ["clone", "yue maker"]})
# The choice is asked as "Choose a card (Moon)": what the returning clone copies.
adv.when(lambda p: "This choice decides what the Moon is: a land with the chosen creature's abilities that taps for mana and can be untapped like a land"
                   + (f"; on it, the tap triggers of {', '.join(on_board(p, 'moon payoff'))} fire each time it taps" if on_board(p, "moon payoff") else "")
                   + ". A Moon copying Princess Yue only scries.",
         kinds=("choose",), test=lambda p: "(Moon)" in p.decision.get("prompt", ""))
adv.when("Yes puts Princess Yue in the command zone, to be recast as a creature that clones can copy; no leaves her in the graveyard, "
         "and she returns as a land, a Moon that only scries.",
         kinds=("confirm",), test=lambda p: "command zone" in p.decision.get("prompt", "") and p.decision.get("prompt", "").startswith(YUE))
adv.when(lambda p: "A Moon that scries is on the board and Matoya is too: each scry draws a card, and "
                   + ", ".join(on_board(p, "untap legendary") + on_board(p, "untap land")) + " can untap it.",
         board=["Moon", "scry payoff"], any_of={"board": ["untap legendary", "untap land"]}, test=lambda p: "Scry" in p.text("Moon"))
adv.when(lambda p: "Tap loop on the board: " + ", ".join(on_board(p, "tap outlet")) + " taps "
                   + ", ".join(on_board(p, "tap payoff")) + " for mana and a card each time, and "
                   + ", ".join(on_board(p, "untap legendary") + on_board(p, "untap any")) + " untaps it again.",
         board=["tap outlet", "tap payoff"], any_of={"board": ["untap legendary", "untap any"]})
# The loop, one step at a time, as facts about what is untapped right now.
TUI = "Tui and La, Moon and Ocean"
adv.when(lambda p: ", ".join(n for n in on_board(p, "tap outlet") if not p.tapped(n)) + f" can tap {TUI} now: a card and a mana.",
         board=["tap outlet", TUI], test=lambda p: not p.tapped(TUI) and any(not p.tapped(n) for n in on_board(p, "tap outlet")))
adv.when(f"{TUI} is untapped, so untapping it now does nothing; its untap counter comes only after it has been tapped.",
         board=["untap legendary", TUI], test=lambda p: not p.tapped(TUI) and any(not p.tapped(n) for n in on_board(p, "untap legendary")))
adv.when(lambda p: ", ".join(n for n in on_board(p, "untap legendary") if not p.tapped(n)) + f" can untap {TUI} now, which is tapped: a +1/+1 counter on it.",
         board=["untap legendary", TUI], test=lambda p: p.tapped(TUI) and any(not p.tapped(n) for n in on_board(p, "untap legendary")))
adv.when(lambda p: "Deserted Temple can untap " + ", ".join(n for n in on_board(p, "untap legendary") if p.tapped(n)) + " now, which is tapped.",
         board=["Deserted Temple", "untap legendary"], test=lambda p: not p.tapped("Deserted Temple") and any(p.tapped(n) for n in on_board(p, "untap legendary")))
adv.when(lambda p: "Wake Thrasher is on the board: every permanent of yours that untaps this turn gives it +1/+1; untap effects on the board: "
                   + ", ".join(on_board(p, "untap legendary") + on_board(p, "untap land") + on_board(p, "untap any")) + ".",
         board=["Wake Thrasher"], any_of={"board": ["untap legendary", "untap land", "untap any"]})
adv.when(lambda p: "Nykthos is on the board: its second ability makes mana equal to your devotion to blue, which grows with every blue permanent.",
         board=["Nykthos, Shrine to Nyx"])
adv.when(lambda p: "Castable from the graveyard or exile now: " + ", ".join(p.castable_from["graveyard"] + p.castable_from["exile"]) + ".",
         test=lambda p: bool(p.castable_from["graveyard"] or p.castable_from["exile"]))

advise = adv.advise
