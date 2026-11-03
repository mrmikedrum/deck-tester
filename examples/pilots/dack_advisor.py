"""Advisor for the Dack cEDH deck: fast mana into the commander, and the untap engines around monoliths."""

from goldfish.advice import Advisor

adv = Advisor()
adv.role("fast mana", "Sol Ring", "Mana Vault", "Mana Crypt", "Chrome Mox", "Mox Diamond", "Mox Opal", "Lotus Petal",
         "Lion's Eye Diamond", "Grim Monolith", "Basalt Monolith", "Jeweled Amulet", "Everflowing Chalice", "Fellwar Stone",
         "Arcane Signet", "Coalition Relic", "Prismatic Lens")
adv.role("untapper", "Voltaic Key", "Manifold Key")
adv.role("monolith", "Grim Monolith", "Basalt Monolith", "Mana Vault")
adv.role("stax", "Rule of Law", "Trinisphere", "Silence", "Deafening Silence", "Thorn of Amethyst", "Damping Sphere",
         "Cursed Totem", "Defense Grid", "Static Prison", "Suppression Field", "Disruptor Flute")

adv.when(lambda p: "Fast mana in hand now: " + ", ".join(n for n in p.hand if adv.matches("fast mana", n, p)) + "; the plan plays it before anything else.",
         any_of={"hand": ["fast mana"]}, test=lambda p: any(adv.matches("fast mana", n, p) and n in p.castable for n in p.hand))
adv.when("Dack Fayden is castable from the command zone now; the plan casts him as early as possible.",
         castable_from={"command": ["Dack Fayden, Helping Hand"]})
adv.when(lambda p: "An untapper and a monolith are both on the board (" + ", ".join(n for n in p.board if adv.matches("untapper", n, p) or adv.matches("monolith", n, p)) + "): untapping the monolith makes more mana than the untap costs.",
         board=["untapper", "monolith"])
adv.when(lambda p: "Stax pieces castable now (" + ", ".join(n for n in p.castable if adv.matches("stax", n, p)) + ") do little against these opponents; the plan casts them only with mana to spare.",
         test=lambda p: any(adv.matches("stax", n, p) for n in p.castable))

advise = adv.advise
