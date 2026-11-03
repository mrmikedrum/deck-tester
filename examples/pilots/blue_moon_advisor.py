"""Advisor for the Blue Moon deck. Its engines are tap and untap loops around legendary permanents and the
commander's second life as a land, so the lines say which loop pieces are on the board and what each tap or
untap is worth right now. Facts only; the played-out options show what each line does."""

from goldfish.advice import Advisor

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
adv.role("moon maker", "Imprisoned in the Moon")
adv.role("land copier", "Copy Land", "Vesuva", "Thespian's Stage")
adv.role("clone", "Phantasmal Image", "Phyrexian Metamorph", "Vizier of Many Faces", "Clever Impersonator", "Mirror Image",
         "Glasspool Mimic", "Sakashima's Student", "Omni-Changeling", "Metamorphic Alteration", "Machine God's Effigy")
adv.role("devotion payoff", "Nykthos, Shrine to Nyx", "Master of Waves")


def on_board(p, role):
    return [n for n in p.board if adv.matches(role, n, p)]


# The commander as a land: Moon taps for mana or scries, and untaps as a legendary permanent.
adv.when("Princess Yue is on the board as a creature; when she dies she returns as a land named Moon that taps for {C} or to scry 2.",
         board=[YUE], test=lambda p: "Land" not in p.text(YUE).split(" — ")[1] if " — " in p.text(YUE) else True)
adv.when(lambda p: "Moon (Princess Yue as a land) is on the board and Matoya is too: each scry 2 from Moon draws a card, and "
                   + ", ".join(on_board(p, "untap legendary") + on_board(p, "untap land")) + " can untap it.",
         board=["Moon", "scry payoff"], any_of={"board": ["untap legendary", "untap land"]})
adv.when("Princess Yue's death trigger is on the stack: she returns as the land Moon, tapped.",
         stack=[YUE], kinds=("play", "targets", "confirm"))
# The line: a clone of Princess Yue dies to the legend rule and the clone card returns as Moon, entering as a
# copy of whatever creature is chosen then: a land with that creature's abilities, which Deserted Temple and
# Minamo can untap. The choice is asked as "Choose a card (Moon)".
adv.when("This choice makes Moon a land with the chosen creature's abilities, and Deserted Temple and Minamo can untap a land: "
         "Tui and La's tap and untap triggers on it draw a card and grow it each time; copying Princess Yue again only scries.",
         kinds=("choose",), test=lambda p: "(Moon)" in p.decision.get("prompt", ""))
adv.when("A clone that copies Princess Yue dies to the legend rule and returns as the land Moon copying another creature; "
         "a Phantasmal Image copy is sacrificed when targeted, so it can't be untapped by Deserted Temple or Minamo, while a Phyrexian Metamorph or Vizier copy can.",
         board=[YUE], test=lambda p: any(adv.matches("clone", n, p) for n in p.castable))
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
adv.when(lambda p: "A clone is castable (" + ", ".join(n for n in p.castable if adv.matches("clone", n, p)) + "); the plan copies your best creature on the board.",
         test=lambda p: any(adv.matches("clone", n, p) for n in p.castable) and len(p.board) > 0)
adv.when(lambda p: "Imprisoned in the Moon is castable: on Princess Yue it makes her a land now without her dying.",
         castable=["moon maker"], board=[YUE])
adv.when(lambda p: "Nykthos is on the board: its second ability makes mana equal to your devotion to blue, which grows with every blue permanent.",
         board=["Nykthos, Shrine to Nyx"])
adv.when(lambda p: "Castable from the graveyard or exile now: " + ", ".join(p.castable_from["graveyard"] + p.castable_from["exile"]) + ".",
         test=lambda p: bool(p.castable_from["graveyard"] or p.castable_from["exile"]))

advise = adv.advise
