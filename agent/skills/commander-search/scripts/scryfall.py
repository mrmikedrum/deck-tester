#!/usr/bin/env python3
"""Read-only Scryfall retrieval with explicit provenance, coverage and canonical Oracle cache."""

import argparse
import datetime
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE = "https://api.scryfall.com"
FIELDS = (
    "id", "oracle_id", "name", "mana_cost", "cmc", "type_line", "oracle_text",
    "color_identity", "colors", "keywords", "card_faces", "legalities", "games",
    "game_changer", "prices", "set", "collector_number", "released_at",
    "scryfall_uri", "rulings_uri", "image_uris", "all_parts", "layout",
    "power", "toughness", "loyalty", "defense", "produced_mana", "color_indicator",
)
NAME_FIELDS = ("oracle_id", "name", "layout", "mana_cost", "type_line", "card_faces")
RULE_FIELDS = NAME_FIELDS + (
    "cmc", "oracle_text", "color_identity", "colors", "color_indicator", "keywords",
    "power", "toughness", "loyalty", "defense", "produced_mana", "legalities",
    "games", "game_changer", "scryfall_uri", "rulings_uri", "all_parts",
)
ORACLE_FIELDS = (
    "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line",
    "oracle_text", "color_identity", "colors", "color_indicator", "keywords",
    "power", "toughness", "loyalty", "defense", "produced_mana", "hand_modifier",
    "life_modifier",
)
UUID_RE = re.compile(r"^[a-f0-9-]{36}$")


def _parse_iso(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed


def _canonical_card(card):
    result = {key: card[key] for key in ORACLE_FIELDS if key in card}
    if "card_faces" in card and isinstance(card["card_faces"], list):
        result["card_faces"] = [_canonical_card(face) for face in card["card_faces"]]
    return result


def cache_root(repo=None):
    """Directory holding .card-cache/oracle/: DECKMASTER_CARD_CACHE, MTG_DECKS_REPO, configured decks repo, else repo."""
    if os.environ.get("DECKMASTER_CARD_CACHE"):
        return Path(os.environ["DECKMASTER_CARD_CACHE"]).expanduser().resolve()
    if os.environ.get("MTG_DECKS_REPO"):
        return Path(os.environ["MTG_DECKS_REPO"]).expanduser().resolve() / ".card-cache"
    cfg = Path(os.environ.get("DECKMASTER_CONFIG") or Path.home() / ".config" / "deckmaster" / "config.json")
    if cfg.is_file():
        try:
            configured = json.loads(cfg.read_text(encoding="utf-8")).get("decks")
            if configured:
                return Path(configured).expanduser().resolve() / ".card-cache"
        except (OSError, ValueError):
            pass
    base = Path(repo) if repo is not None else Path(__file__).resolve().parents[4]
    sibling = base.parent / "mtg-decks"
    if sibling.is_dir():
        return sibling / ".card-cache"
    return base / ".card-cache"


def save_oracle(cache_dir, card, retrieved_at=None):
    oracle_id = card.get("oracle_id") if isinstance(card, dict) else None
    if not oracle_id:
        return
    if not isinstance(oracle_id, str) or not UUID_RE.match(oracle_id):
        raise ValueError("Invalid Oracle ID")
    stamp = retrieved_at or datetime.datetime.now(datetime.timezone.utc).isoformat()
    stamp_dt = _parse_iso(stamp)
    if stamp_dt is None:
        raise ValueError("Invalid Oracle retrieval time")
    oracle_dir = Path(cache_dir) / "oracle"
    target = oracle_dir / f"{oracle_id}.json"
    if target.is_file():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
            existing_dt = _parse_iso(existing.get("retrieved_at"))
            if existing_dt is not None and existing_dt >= stamp_dt:
                return
        except (OSError, ValueError):
            pass
    oracle_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema": "deckmaster/oracle-v1",
        "retrieved_at": stamp,
        "source_url": "https://api.scryfall.com/cards/search?q=oracleid%3A" + oracle_id,
        "card": _canonical_card(card),
    }
    fd, tmp_name = tempfile.mkstemp(prefix=f"{oracle_id}-", suffix=".tmp", dir=str(oracle_dir))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(tmp_name, target)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def find_oracle(cache_dir, name):
    oracle_dir = Path(cache_dir) / "oracle"
    if not oracle_dir.is_dir():
        return None
    wanted = name.lower()
    matches = []
    for entry_path in oracle_dir.iterdir():
        if entry_path.suffix != ".json":
            continue
        try:
            entry = json.loads(entry_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        card = entry.get("card") if isinstance(entry, dict) else None
        if not isinstance(card, dict):
            continue
        card_name = card.get("name")
        if isinstance(card_name, str) and card_name.lower() == wanted:
            matches.append(entry)
    if len(matches) != 1:
        return None
    saved = matches[0]
    if _parse_iso(saved.get("retrieved_at")) is None:
        return None
    return saved


def display_view(result, view, offset=0, limit=None):
    if view not in ("full", "names", "rules"):
        raise ValueError("view must be full, names or rules")
    if offset < 0 or limit is not None and limit < 1:
        raise ValueError("offset must be nonnegative and limit must be positive")
    displayed = result
    if offset or limit is not None:
        cards = result.get("cards", [])
        page = cards[offset:offset + limit if limit is not None else None]
        next_offset = offset + len(page)
        displayed = {**result, "cards": page, "view_offset": offset,
                     "view_total_cards": len(cards), "displayed_cards": len(page),
                     "next_offset": next_offset if next_offset < len(cards) else None}
    if view == "full":
        return displayed
    fields = NAME_FIELDS if view == "names" else RULE_FIELDS

    def project(card):
        selected = {key: card[key] for key in fields if key in card and key != "card_faces"}
        if "card_faces" in card:
            selected["card_faces"] = [project(face) for face in card["card_faces"]]
        return selected

    return {**displayed, "view": view, "cards": [project(card) for card in displayed.get("cards", [])]}


def inspect_result(result, names):
    if not isinstance(result, dict) or not isinstance(result.get("cards"), list):
        raise ValueError("Expected a saved retrieval result with a cards array")
    if any(not isinstance(card, dict) or not isinstance(card.get("name"), str) for card in result["cards"]):
        raise ValueError("Expected named card objects in the saved result")
    if not names:
        return result
    wanted = {name.casefold() for name in names}
    cards = [card for card in result["cards"] if card.get("name", "").casefold() in wanted]
    found = {card["name"].casefold() for card in cards}
    missing = [name for name in names if name.casefold() not in found]
    selected = {**result, "cards": cards, "returned_cards": len(cards),
                "source_returned_cards": result.get("returned_cards", len(result["cards"])),
                "selected_names": names, "missing_names": missing}
    if missing:
        selected.update(status="error", error="Names absent from this saved result: " + ", ".join(missing))
    return selected


def request_json(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != "api.scryfall.com":
        raise ValueError("Refusing a pagination URL outside the Scryfall API")
    request = urllib.request.Request(url, headers={
        "User-Agent": "deckmaster-partner/0.1 (read-only personal deck research)",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
        except (ValueError, UnicodeError):
            raise RuntimeError(f"Scryfall HTTP {error.code}") from error
        if error.code == 404 and payload.get("code") == "not_found":
            return payload
        raise RuntimeError(f"Scryfall HTTP {error.code}: {payload.get('details', '')}") from error


def retrieve(mode, value, max_pages=1, unique="cards", fetch=request_json, pause=time.sleep):
    if max_pages < 1:
        raise ValueError("max_pages must be positive")
    if mode not in ("search", "named"):
        raise ValueError("mode must be search or named")
    params = {"q": value, "unique": unique, "order": "name"} if mode == "search" else {"exact": value}
    url = BASE + ("/cards/search?" if mode == "search" else "/cards/named?") + urllib.parse.urlencode(params)
    result = {
        "operation": mode, "input": value, "unique": unique if mode == "search" else None,
        "retrieved_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "status": "pending", "complete": False, "pages_fetched": 0,
        "total_cards": None, "returned_cards": 0, "next_page": None,
        "source_urls": [], "warnings": [], "cards": [],
    }
    try:
        while url:
            payload = fetch(url)
            if payload.get("object") == "error":
                if payload.get("code") == "not_found" and result["pages_fetched"] == 0:
                    result.update(status="no_matches" if mode == "search" else "not_found",
                                  complete=mode == "search", total_cards=0)
                    result["source_urls"].append(url)
                    result["detail"] = payload.get("details")
                    break
                raise ValueError(payload.get("details", "Unexpected API error"))
            if mode == "named":
                if payload.get("object") != "card":
                    raise ValueError("Expected a card response")
                cards = [payload]
                has_more = False
                total = 1
            else:
                if payload.get("object") != "list" or not isinstance(payload.get("data"), list):
                    raise ValueError("Expected a paginated list response")
                if not isinstance(payload.get("has_more"), bool):
                    raise ValueError("Missing pagination coverage flag")
                cards = payload["data"]
                has_more = payload["has_more"]
                total = payload.get("total_cards")
                if has_more and not payload.get("next_page"):
                    raise ValueError("More results exist but next_page is missing")
            if any(card.get("object") != "card" for card in cards):
                raise ValueError("Response contains a non-card item")
            result["cards"].extend({key: card[key] for key in FIELDS if key in card} for card in cards)
            result["pages_fetched"] += 1
            result["source_urls"].append(url)
            result["warnings"].extend(payload.get("warnings", []))
            result["total_cards"] = total
            result["next_page"] = payload.get("next_page") if has_more else None
            if not has_more:
                result.update(status="complete", complete=True)
                break
            if result["pages_fetched"] >= max_pages:
                result["status"] = "partial"
                break
            url = result["next_page"]
            pause(0.15)
    except (OSError, ValueError, RuntimeError) as error:
        result.update(status="error", complete=False, error=str(error), failed_url=url)
    result["returned_cards"] = len(result["cards"])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="mode", required=True)
    search = commands.add_parser("search", help="Retrieve candidates, not ranked recommendations")
    search.add_argument("value", help="Scryfall query")
    search.add_argument("--max-pages", type=int, default=1)
    search.add_argument("--unique", choices=("cards", "prints", "art"), default="cards")
    named = commands.add_parser("named", help="Verify one exact card name")
    named.add_argument("value")
    named.add_argument("--refresh", action="store_true", help="Fetch fresh Oracle and printing details")
    named.add_argument("--offline", action="store_true", help="Use cached facts only; never fetch on a cache miss")
    inspect = commands.add_parser("inspect", help="Inspect saved search results locally, without fetching")
    inspect.add_argument("value", help="Saved full JSON result")
    inspect.add_argument("--name", action="append", default=[], help="Select an exact card name; repeat for several")
    for command in (search, named, inspect):
        command.add_argument("--view", choices=("full", "names", "rules"),
                             default="rules" if command is inspect else "full",
                             help="Display full data, a discovery name index, or complete card rules")
        command.add_argument("--offset", type=int, default=0, help="Start display at this zero-based card offset")
        command.add_argument("--limit", type=int, help="Display at most this many cards; retrieval and saved data stay complete")
    for command in (search, named):
        command.add_argument("--output", type=Path, help="Save the full result while displaying the selected view")
    args = parser.parse_args()
    if getattr(args, "max_pages", 1) < 1:
        parser.error("--max-pages must be positive")
    if args.offset < 0 or args.limit is not None and args.limit < 1:
        parser.error("--offset must be nonnegative and --limit must be positive")
    if getattr(args, "offline", False) and getattr(args, "refresh", False):
        parser.error("--offline and --refresh cannot be combined")
    cache_dir = cache_root()
    try:
        saved = None
        if args.mode == "inspect":
            with open(args.value, encoding="utf-8") as handle:
                result = inspect_result(json.load(handle), args.name)
        elif args.mode == "named" and not args.refresh:
            saved = find_oracle(cache_dir, args.value)
        if args.mode == "inspect":
            pass
        elif saved:
            result = {"status": "cached", "complete": True, "cards": [saved["card"]],
                      "returned_cards": 1, "retrieved_at": saved["retrieved_at"],
                      "source_urls": [saved["source_url"]],
                      "warnings": ["Canonical cached facts only; no printing, price, legality, or Game Changer data."]}
            if args.offline:
                result["warnings"].append("Offline snapshot; current Oracle wording is not confirmed.")
        elif getattr(args, "offline", False):
            result = {"status": "not_found", "complete": False, "cards": [],
                      "error": "No unambiguous cached card; fetch it online first."}
        else:
            result = retrieve(args.mode, args.value, getattr(args, "max_pages", 1), getattr(args, "unique", "cards"))
            for card in result.get("cards", []):
                save_oracle(cache_dir, card, result.get("retrieved_at"))
        if getattr(args, "output", None):
            with args.output.open("w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
    except (OSError, ValueError) as error:
        result = {"status": "error", "complete": False, "error": str(error)}
    print(json.dumps(display_view(result, args.view, args.offset, args.limit), ensure_ascii=False, indent=2))
    return 1 if result["status"] in ("error", "not_found") else 0


if __name__ == "__main__":
    sys.exit(main())
