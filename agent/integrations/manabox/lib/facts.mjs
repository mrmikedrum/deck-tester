import fs from "node:fs";
import path from "node:path";
import { atomic, read, hash } from "./store.mjs";
import { retryDelay } from "./network.mjs";
import { saveOracle } from "./card-cache.mjs";
export async function facts(
  store,
  ids,
  { force = false, fetcher = fetch } = {},
) {
  const dir = store.file("scryfall"),
    out = [],
    missing = [];
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cooldown = path.join(dir, "cooldown.json");
  if (fs.existsSync(cooldown) && read(cooldown).until > Date.now())
    throw Error(
      "Scryfall requested a cooldown; retry after " +
        new Date(read(cooldown).until).toISOString(),
    );
  for (const id of [...new Set(ids)]) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error("Invalid Scryfall ID");
    const file = path.join(dir, id + ".json");
    if (!force && fs.existsSync(file)) {
      const saved = read(file);
      if (Number.isFinite(Date.parse(saved.retrieved_at))) {
        await saveOracle(store.repo, saved.card, saved.retrieved_at);
        out.push(saved);
        continue;
      }
    }
    missing.push(id);
  }
  // Scryfall accepts up to 75 exact IDs per collection request. This POST only reads.
  for (let start = 0; start < missing.length; start += 75) {
    const batch = missing.slice(start, start + 75),
      pace = path.join(dir, "last-request.json"),
      last = fs.existsSync(pace) ? read(pace).time : 0;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 150 - (Date.now() - last))),
    );
    atomic(pace, { time: Date.now() });
    const r = await fetcher("https://api.scryfall.com/cards/collection", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "mtg-decks-manabox/0.1 (personal deck checks)",
      },
      body: JSON.stringify({ identifiers: batch.map((id) => ({ id })) }),
    });
    if (r.status === 429)
      atomic(cooldown, {
        until: Date.now() + (retryDelay(r.headers.get("retry-after")) ?? 60000),
      });
    if (!r.ok)
      throw Error(
        "Scryfall HTTP " +
          r.status +
          (r.status === 429
            ? "; retry after " + (r.headers.get("retry-after") ?? "waiting")
            : ""),
      );
    const payload = await r.json();
    if (
      payload.object !== "list" ||
      !Array.isArray(payload.data) ||
      payload.not_found?.length
    )
      throw Error(
        "Some card facts were not returned by Scryfall; no legality conclusion available",
      );
    for (const id of batch) {
      const card = payload.data.find((c) => c.id === id && c.object === "card");
      if (!card) throw Error("Missing Scryfall card facts");
      const saved = {
        retrieved_at: new Date().toISOString(),
        source_url: "https://api.scryfall.com/cards/" + id,
        card,
      };
      atomic(path.join(dir, id + ".json"), saved);
      await saveOracle(store.repo, card, saved.retrieved_at);
      out.push(saved);
    }
  }
  return out;
}
export async function checkDeck(store, doc, { force = false } = {}) {
  const included = doc.cards.filter((c) =>
      ["main", "commander"].includes(c.board),
    ),
    missing = included.filter((c) => !c.scryfall_id);
  if (missing.length)
    throw Error("Unresolved catalog references; refresh catalog first");
  const data = await facts(
      store,
      included.map((c) => c.scryfall_id),
      { force },
    ),
    byid = new Map(data.map((f) => [f.card.id, f.card])),
    commanders = included.filter((c) => c.board === "commander");
  const colors = new Set(
      commanders.flatMap((c) => byid.get(c.scryfall_id).color_identity),
    ),
    issues = [],
    warnings = [];
  const count = included.reduce((n, c) => n + c.quantity + c.proxies, 0);
  if (count !== 100)
    issues.push({ code: "deck_size", actual: count, expected: 100 });
  if (!commanders.length) issues.push({ code: "missing_commander" });
  if (commanders.length > 1)
    warnings.push(
      "Commander pairing/partner/background legality requires a rules review.",
    );
  const totals = new Map();
  let lands = 0;
  const curve = {};
  for (const c of included) {
    const card = byid.get(c.scryfall_id),
      qty = c.quantity + c.proxies;
    if (card.legalities?.commander !== "legal")
      issues.push({
        code: "card_legality",
        card: card.name,
        status: card.legalities?.commander,
      });
    if (card.color_identity.some((c) => !colors.has(c)))
      issues.push({ code: "color_identity", card: card.name });
    const record = totals.get(card.oracle_id) ?? { qty: 0, card };
    record.qty += qty;
    totals.set(card.oracle_id, record);
    if (card.type_line.includes("Land")) lands += qty;
    else curve[card.cmc] = (curve[card.cmc] ?? 0) + qty;
    if (c.board === "commander" && qty !== 1)
      issues.push({ code: "commander_quantity", card: card.name });
    if (
      c.board === "commander" &&
      !card.type_line.includes("Legendary Creature") &&
      !/can be your commander/i.test(card.oracle_text ?? "") &&
      !card.card_faces?.some((f) => f.type_line?.includes("Legendary Creature"))
    )
      issues.push({ code: "commander_eligibility", card: card.name });
  }
  for (const { qty, card } of totals.values())
    if (qty > 1 && !card.type_line.includes("Basic Land")) {
      if (
        /A deck can have any number of cards named/i.test(
          card.oracle_text ?? "",
        )
      )
        continue;
      if (/A deck can have up to/i.test(card.oracle_text ?? ""))
        warnings.push("Review special copy limit: " + card.name);
      else issues.push({ code: "singleton", card: card.name, quantity: qty });
    }
  return {
    deck: doc.name,
    format: "commander",
    cards: count,
    lands,
    nonland_mana_curve: curve,
    color_identity: [...colors].sort(),
    issues,
    warnings,
    status: issues.length
      ? "issues_found"
      : warnings.length
        ? "basic_checks_passed_with_review_needed"
        : "basic_checks_passed",
    coverage:
      "Current/cached Scryfall card legality, size, colors, basic singleton and commander eligibility. Does not certify every pairing, special rule, or bracket.",
    sources: data.map((f) => ({
      url: f.source_url,
      retrieved_at: f.retrieved_at,
    })),
  };
}
