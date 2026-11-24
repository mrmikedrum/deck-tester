"""Example pilot: cast the commander whenever it's offered; Forge's AI makes every other decision."""


def play(decision):
    for number, option in enumerate(decision["options"], 1):
        if option.endswith("(commander)"):
            return number
    return None
