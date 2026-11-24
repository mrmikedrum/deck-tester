"""A bench pilot that activates Marath for tokens whenever it can, so other seats meet its ability on the stack."""


def play(d):
    for i, option in enumerate(d["options"]):
        if option.startswith("Marath, Will of the Wild: {X}"):
            return i + 1
    return None


def mode(d):
    for i, option in enumerate(d["options"]):
        if "token" in option.lower():
            return i + 1
    return None


def number(d):
    return d["max"] if d["max"] >= 1 else None
