import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomic, read, withLock } from "./store.mjs";

const fields = [
  "oracle_id", "name", "layout", "mana_cost", "cmc", "type_line",
  "oracle_text", "color_identity", "colors", "color_indicator", "keywords",
  "power", "toughness", "loyalty", "defense", "produced_mana", "hand_modifier",
  "life_modifier",
];

function canonicalCard(card) {
  const result = Object.fromEntries(fields.filter((key) => key in card).map((key) => [key, card[key]]));
  if (card.card_faces) result.card_faces = card.card_faces.map(canonicalCard);
  return result;
}

export async function saveOracle(repo, card, retrievedAt = new Date().toISOString()) {
  if (!card.oracle_id) return;
  if (!/^[a-f0-9-]{36}$/.test(card.oracle_id)) throw Error("Invalid Oracle ID");
  const file = path.join(repo, ".card-cache", "oracle", card.oracle_id + ".json");
  if (!Number.isFinite(Date.parse(retrievedAt))) throw Error("Invalid Oracle retrieval time");
  const current = () => fs.existsSync(file) && Date.parse(read(file).retrieved_at) >= Date.parse(retrievedAt);
  if (current()) return;
  return withLock(file + ".lock", async () => {
    if (current()) return;
    atomic(file, {
      schema: "deckmaster/oracle-v1",
      retrieved_at: retrievedAt,
      source_url: "https://api.scryfall.com/cards/search?q=oracleid%3A" + card.oracle_id,
      card: canonicalCard(card),
    });
  });
}

// Name index over the cache directory, rebuilt only when the directory changes.
const names = new Map();
function nameIndex(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const mtime = fs.statSync(dir).mtimeMs;
  if (names.get(dir)?.mtime !== mtime) {
    const index = new Map();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const entry = read(path.join(dir, file)), key = entry.card.name?.toLowerCase();
      if (key !== undefined) index.set(key, [...(index.get(key) ?? []), entry]);
    }
    names.set(dir, { mtime, index });
  }
  return names.get(dir).index;
}

export function findOracle(repo, name) {
  const matches = nameIndex(path.join(repo, ".card-cache", "oracle")).get(name.toLowerCase()) ?? [];
  if (matches.length !== 1) return null;
  const saved = matches[0];
  if (!Number.isFinite(Date.parse(saved.retrieved_at))) return null;
  return saved;
}

export function readOracle(repo, oracleId) {
  if (!repo || !/^[a-f0-9-]{36}$/.test(oracleId ?? "")) return null;
  const file = path.join(repo, ".card-cache", "oracle", oracleId + ".json");
  if (!fs.existsSync(file)) return null;
  const saved = read(file);
  if (saved.card?.oracle_id !== oracleId || !Number.isFinite(Date.parse(saved.retrieved_at))) throw Error("Invalid cached Oracle record: " + oracleId);
  return saved;
}

// ManaBox's numeric Oracle key is not a Scryfall UUID. Bridge through the
// existing printing cache, then allow only an unambiguous non-token name.
export function readCatalogOracle(repo, ref, { state } = {}) {
  if (!repo || !ref) return null;
  const direct = readOracle(repo, ref.cv_oracle_id);
  if (direct) return direct;
  const printingId = ref.cv_scryfall_id;
  if (/^[a-f0-9-]{36}$/.test(printingId ?? "")) {
    const file = path.join(state ?? process.env.MANABOX_STATE_DIR ?? path.join(repo, ".manabox"), "scryfall", printingId + ".json");
    if (fs.existsSync(file)) {
      const printing = read(file);
      if (printing.card?.id === printingId && Number.isFinite(Date.parse(printing.retrieved_at))) {
        const saved = readOracle(repo, printing.card.oracle_id);
        if (saved && saved.card.name === printing.card.name && saved.card.name === ref.c_name) return saved;
      }
    }
  }
  // Token names can coincide with real cards; a name alone cannot bind them.
  if (ref.c_layout === undefined || [10, 11].includes(ref.c_layout) || typeof ref.c_name !== "string") return null;
  const saved = findOracle(repo, ref.c_name);
  return saved && !["token", "double_faced_token"].includes(saved.card.layout) ? saved : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, repo, name] = process.argv.slice(2);
    if (operation === "save") {
      const payload = JSON.parse(fs.readFileSync(0, "utf8"));
      for (const card of payload.cards) await saveOracle(repo, card, payload.retrieved_at);
      console.log(JSON.stringify({ status: "cached" }));
    } else if (operation === "get") {
      console.log(JSON.stringify(findOracle(repo, name)));
    } else throw Error("Expected save or get");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
