"""Decks as state: a deck database that Deckmaster reads decks from, filled from the decks repository and imports.

A deck has a slug, a name and where it came from, and a series of immutable revisions: the list (identified by its
hash, the revision game records name), the plan the decision model reads, and the advisor's file with its hash.
A new revision is added only when one of those changes, so every record points at exactly what it played.

The decks repository is loosely coupled: any folder in it may hold a `deckmaster/` folder with one manifest per deck,
`<slug>.json`, whose paths are relative to it:

    {"name": "Living Worlds III", "list": "../../../decks/manabox/<id>/deck.txt", "plan": "living-worlds-iii.plan.md",
     "advisor": "living-worlds-iii.py"}

`list` is a text decklist or a Forge .dck; `plan` and `advisor` are optional. Everything else in the repository is the
deck's own business. The database lives in ~/.local/share/deckmaster/ (DECKMASTER_DB to move it); the decks
repository is found from ~/.config/deckmaster/config.json ({"decks": PATH}), else the sibling mtg-decks folder.
"""
import hashlib
import json
import os
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

from . import decklist

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path.home() / ".config" / "deckmaster" / "config.json"


class DeckError(ValueError):
    pass


@dataclass
class Deck:
    slug: str
    name: str
    list: decklist.Decklist
    plan: Optional[str] = None
    advisor: Optional[str] = None   # the advisor's file, loaded by path (batch.load_pilot)
    revision: Optional[int] = None  # None for a deck read straight from a file
    source: str = ""


def db_path() -> Path:
    return Path(os.environ.get("DECKMASTER_DB") or Path.home() / ".local" / "share" / "deckmaster" / "deckmaster.db")


def decks_root(override: Optional[str] = None) -> Path:
    """The decks repository: the --decks flag, then the config file, then the sibling mtg-decks folder."""
    if override:
        return Path(override).expanduser().resolve()
    if CONFIG.exists():
        configured = json.loads(CONFIG.read_text()).get("decks")
        if configured:
            return Path(configured).expanduser().resolve()
    return (ROOT.parent / "mtg-decks").resolve()


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(path))
    db.executescript("""
        CREATE TABLE IF NOT EXISTS decks (slug TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
                                          added TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions (id INTEGER PRIMARY KEY, slug TEXT NOT NULL REFERENCES decks(slug),
                                              list_hash TEXT NOT NULL, commanders TEXT NOT NULL, main TEXT NOT NULL,
                                              plan TEXT, advisor TEXT, advisor_hash TEXT, added TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS revisions_by_deck ON revisions (slug, id);
    """)
    return db


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _file_hash(path: Optional[str]) -> Optional[str]:
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()[:8] if path else None


def slug_of(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def _store(db: sqlite3.Connection, slug: str, name: str, source: str, deck: decklist.Decklist, plan: Optional[str],
           advisor: Optional[str]) -> bool:
    """Add a revision when the list, plan or advisor differ from the deck's latest; True when one was added."""
    if not db.execute("SELECT 1 FROM decks WHERE slug = ?", (slug,)).fetchone():
        db.execute("INSERT INTO decks VALUES (?, ?, ?, ?)", (slug, name, source, _now()))
    else:
        db.execute("UPDATE decks SET name = ?, source = ? WHERE slug = ?", (name, source, slug))
    row = (deck.revision(), json.dumps(deck.commanders), json.dumps(deck.main), plan, advisor, _file_hash(advisor))
    latest = db.execute("SELECT list_hash, commanders, main, plan, advisor, advisor_hash FROM revisions WHERE slug = ? "
                        "ORDER BY id DESC LIMIT 1", (slug,)).fetchone()
    if latest == row:
        return False
    db.execute("INSERT INTO revisions (slug, list_hash, commanders, main, plan, advisor, advisor_hash, added) "
               "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (slug,) + row + (_now(),))
    return True


def read_manifest(path: Path) -> Tuple[str, decklist.Decklist, Optional[str], Optional[str]]:
    """A manifest's name, list, plan text and advisor path."""
    spec = json.loads(path.read_text())
    if "list" not in spec:
        raise DeckError(f"{path}: no list")
    here = path.parent
    deck = decklist.load(str(here / spec["list"]))
    plan = (here / spec["plan"]).read_text() if spec.get("plan") else None
    advisor = str((here / spec["advisor"]).resolve()) if spec.get("advisor") else None
    if advisor and not Path(advisor).is_file():
        raise DeckError(f"{path}: no advisor at {spec['advisor']}")
    return spec.get("name") or path.stem, deck, plan, advisor


def sync(root: Optional[str] = None) -> List[Tuple[str, str]]:
    """Read every deck manifest in the decks repository; returns (slug, what happened) for each."""
    base = decks_root(root)
    if not base.is_dir():
        raise DeckError(f"no decks repository at {base}; pass --decks or set it in {CONFIG}")
    found = sorted(p for p in base.rglob("deckmaster/*.json") if ".git" not in p.parts and "node_modules" not in p.parts)
    results = []
    with _connect() as db:
        for manifest in found:
            name, deck, plan, advisor = read_manifest(manifest)
            added = _store(db, manifest.stem, name, str(manifest.relative_to(base)), deck, plan, advisor)
            results.append((manifest.stem, f"revision {deck.revision()}" if added else "unchanged"))
    return results


def import_list(path: str, name: Optional[str] = None, slug: Optional[str] = None) -> Tuple[str, bool]:
    """Import a decklist (text or Forge .dck); returns its slug and whether a new revision was added."""
    text = Path(path).read_text(encoding="utf-8")
    deck = decklist.parse(text)
    name = name or decklist.dck_name(text) or Path(path).stem
    slug = slug or slug_of(name)
    with _connect() as db:
        return slug, _store(db, slug, name, f"import:{Path(path).name}", deck, None, None)


def get(slug: str) -> Deck:
    if not db_path().exists():
        raise DeckError(f"no deck {slug}: the deck database is empty; run deckmaster deck sync")
    with _connect() as db:
        deck = db.execute("SELECT name, source FROM decks WHERE slug = ?", (slug,)).fetchone()
        rev = db.execute("SELECT id, commanders, main, plan, advisor FROM revisions WHERE slug = ? ORDER BY id DESC "
                         "LIMIT 1", (slug,)).fetchone()
    if not deck or not rev:
        raise DeckError(f"no deck {slug}; deckmaster deck list shows them, deck sync and deck import add them")
    listed = decklist.Decklist(json.loads(rev[1]), [tuple(entry) for entry in json.loads(rev[2])])
    return Deck(slug, deck[0], listed, rev[3], rev[4], rev[0], deck[1])


def all_decks() -> List[Deck]:
    if not db_path().exists():
        return []
    with _connect() as db:
        slugs = [row[0] for row in db.execute("SELECT slug FROM decks ORDER BY slug")]
    return [get(slug) for slug in slugs]


def resolve(arg: str) -> Deck:
    """A deck named on the command line: a decklist file, a manifest, or a slug in the database."""
    path = Path(arg)
    if path.is_file() and path.suffix == ".json":
        name, deck, plan, advisor = read_manifest(path)
        return Deck(path.stem, name, deck, plan, advisor, None, str(path))
    if path.is_file():
        return Deck(path.stem, path.stem, decklist.load(arg), None, None, None, str(path))
    return get(arg[:-4] if arg.endswith(".txt") and not path.exists() else arg)
