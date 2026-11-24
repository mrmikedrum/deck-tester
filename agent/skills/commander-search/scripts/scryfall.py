#!/usr/bin/env python3
"""Read-only Scryfall retrieval with explicit provenance and coverage."""

import argparse
import datetime
import json
import subprocess
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


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
        "User-Agent": "mtg-decks-partner/0.1 (read-only personal deck research)",
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
    repo = Path(__file__).resolve().parents[3]
    cache = repo / "tools/manabox/lib/card-cache.mjs"
    try:
        saved = None
        if args.mode == "inspect":
            with open(args.value, encoding="utf-8") as handle:
                result = inspect_result(json.load(handle), args.name)
        elif args.mode == "named" and not args.refresh:
            response = subprocess.run(["node", str(cache), "get", str(repo), args.value],
                                      text=True, capture_output=True, check=True)
            saved = json.loads(response.stdout)
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
            subprocess.run(["node", str(cache), "save", str(repo)], input=json.dumps(result),
                           text=True, capture_output=True, check=True)
        if getattr(args, "output", None):
            with args.output.open("w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        result = {"status": "error", "complete": False, "error": str(error)}
    print(json.dumps(display_view(result, args.view, args.offset, args.limit), ensure_ascii=False, indent=2))
    return 1 if result["status"] in ("error", "not_found") else 0


if __name__ == "__main__":
    sys.exit(main())
