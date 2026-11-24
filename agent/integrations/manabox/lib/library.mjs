import fs from "node:fs";
import path from "node:path";
import { atomic, read, hash } from "./store.mjs";
import { BOARD_NAMES, BOARDS, folderPath, valid } from "./model.mjs";
import { cardKey, relationCardKey, canonical } from "./account.mjs";
import { readCatalogOracle } from "./card-cache.mjs";
const schema = "mtg-decks/manabox-v1";
export function deckDocument(s, d, catalog) {
  const tags = new Map();
  for (const r of s.tables.deck_card_tags_rel)
    if (r.dctr_dc_d_id === d.id) {
      const key = relationCardKey(r);
      tags.set(key, [...(tags.get(key) ?? []), r.dctr_dct_id]);
    }
  const cards = s.tables.deck_cards
    .filter((c) => c.dc_d_id === d.id)
    .map((c) => {
      const ref = catalog ? catalog.lookup(c.dc_cv_id) : null;
      return {
        cv_id: c.dc_cv_id,
        name: ref?.c_name ?? null,
        scryfall_id: ref?.cv_scryfall_id ?? null,
        board: BOARD_NAMES[c.dc_board_category] ?? c.dc_board_category,
        finish: c.dc_foil,
        quantity: c.dc_quantity,
        proxies: c.dc_proxy_qty,
        tags: (tags.get(c.id) ?? []).sort(),
      };
    })
    .sort(
      (a, b) =>
        String(a.board).localeCompare(String(b.board)) ||
        String(a.name).localeCompare(String(b.name)) ||
        a.cv_id - b.cv_id ||
        a.finish - b.finish,
    );
  return {
    schema,
    id: d.id,
    name: d.d_name,
    format: d.d_format === 4 ? "commander" : d.d_format,
    folder_id: d.d_parent_folder,
    folder: folderPath(s, d.d_parent_folder),
    notes: d.d_notes,
    locked: d.d_locked === 1,
    cards,
  };
}
function cardLine(card, { enriched, repo, state, catalog, tagNames, oracle }) {
  const ref = catalog?.lookup(card.cv_id);
  const printing = ref?.cv_set_id && ref?.cv_collector_number
    ? ` (${ref.cv_set_id.toUpperCase()}) ${ref.cv_collector_number}` : "";
  if (![0, 1, 2].includes(card.finish)) throw Error("Unknown card finish");
  const line = `${card.quantity + card.proxies} ${card.name ?? "cv:" + card.cv_id}${printing}${card.finish === 1 ? " *F*" : card.finish === 2 ? " *E*" : ""}`;
  if (!enriched) return line;
  const saved = oracle ? oracle(ref) : readCatalogOracle(repo, ref, { state });
  const details = {
    facts: saved ? { ...saved.card, retrieved_at: saved.retrieved_at, source_url: saved.source_url } : { status: "missing", reason: "Not in local Oracle cache; do not infer card text" },
    tags: card.tags.map((tag) => tagNames[tag] ?? tag),
    finish: card.finish,
    proxies: card.proxies,
  };
  return line + " | " + JSON.stringify(details);
}

export function textList(doc, { enriched = false, repo, state, catalog, tagNames = {}, oracle } = {}) {
  let out = "";
  for (const b of [
    "commander",
    "main",
    "side",
    "maybe",
    "oathbreaker",
    "signature",
  ]) {
    const cs = doc.cards.filter((c) => c.board === b);
    if (!cs.length) continue;
    out +=
      (b === "main" ? "" : `// ${{ commander: "COMMANDER", side: "SIDEBOARD", maybe: "MAYBEBOARD", oathbreaker: "OATHBREAKER", signature: "SIGNATURE" }[b]}\n`) +
      cs
        .map((c) => cardLine(c, { enriched, repo, state, catalog, tagNames, oracle }))
        .join("\n") +
      "\n\n";
  }
  return out ? out.trimEnd() + "\n" : "";
}
// Files are rewritten only when their content changes, so unchanged decks cost no I/O.
function write(p, data) {
  if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== data) atomic(p, data);
}
export function materialize(store, w, catalog) {
  let references;
  try {
    catalog.db;
    references = catalog;
  } catch {}
  const dir = store.library,
    manifest = path.join(dir, "library.json"),
    previous = fs.existsSync(manifest) ? read(manifest) : null;
  if (previous && previous.account !== hash(w.uid).slice(0, 24))
    throw Error(
      "This repository library belongs to another account. Use a separate repository.",
    );
  const facts = new Map(),
    oracle = (ref) => {
      const key = ref?.cv_id;
      if (!facts.has(key))
        facts.set(key, readCatalogOracle(store.repo, ref, { state: store.state }));
      return facts.get(key);
    },
    tagNames = Object.fromEntries(
      w.working.tables.deck_card_tags.map((tag) => [tag.id, tag.dct_name]),
    ),
    files = [];
  for (const d of w.working.tables.decks) {
    const key = hash(d.id).slice(0, 20),
      relative = key + "/deck.json",
      doc = deckDocument(w.working, d, references);
    write(path.join(dir, relative), JSON.stringify(doc, null, 2) + "\n");
    write(path.join(dir, key, "deck.txt"), textList(doc, { catalog: references }));
    write(path.join(dir, key, "deck.enriched.txt"), textList(doc, {
      catalog: references, repo: store.repo, state: store.state, enriched: true, tagNames, oracle,
    }));
    files.push({ id: d.id, file: relative });
  }
  // Only delete files we previously generated after explicit deck removal. Keep brief.md and other workshop files.
  const current = new Set(files.map((f) => f.id));
  for (const old of previous?.decks ?? [])
    if (!current.has(old.id)) {
      if (!/^[a-f0-9]{20}\/deck\.json$/.test(old.file))
        throw Error("Invalid library path");
      for (const p of [
        path.join(dir, old.file),
        path.join(dir, path.dirname(old.file), "deck.txt"),
        path.join(dir, path.dirname(old.file), "deck.enriched.txt"),
      ])
        if (fs.existsSync(p)) fs.unlinkSync(p);
      try {
        fs.rmdirSync(path.join(dir, path.dirname(old.file)));
      } catch (e) {
        if (!["ENOTEMPTY", "ENOENT"].includes(e.code)) throw e;
      }
    }
  write(manifest, JSON.stringify({
    schema,
    account: hash(w.uid).slice(0, 24),
    folders: w.working.tables.decks_folders.map((f) => ({
      id: f.id,
      name: f.df_name,
      parent_id: f.df_parent_folder,
      path: folderPath(w.working, f.id),
    })),
    tags: w.working.tables.deck_card_tags.map((t) => ({
      id: t.id,
      name: t.dct_name,
    })),
    decks: files,
  }, null, 2) + "\n");
}
function keys(obj, allowed) {
  if (Object.keys(obj).some((k) => !allowed.includes(k)))
    throw Error("Unknown deck-file property; check for a typo");
}
export function ingest(store, w, catalog) {
  const manifest = path.join(store.library, "library.json");
  if (!fs.existsSync(manifest)) return w;
  const m = read(manifest);
  if (m.schema !== schema || m.account !== hash(w.uid).slice(0, 24))
    throw Error("Library format/account mismatch");
  keys(m, ["schema", "account", "folders", "tags", "decks"]);
  const s = structuredClone(w.working),
    byId = (table) => new Map(s.tables[table].map((r) => [r.id, r])),
    folders = byId("decks_folders"),
    tags = byId("deck_card_tags"),
    decks = byId("decks"),
    cards = byId("deck_cards"),
    assigned = byId("deck_card_tags_rel");
  if (
    m.decks.length !== s.tables.decks.length ||
    new Set(m.decks.map((d) => d.id)).size !== m.decks.length
  )
    throw Error("Use deckmaster deck create/copy/delete to add or remove deck files");
  if (
    m.folders.length !== s.tables.decks_folders.length ||
    m.tags.length !== s.tables.deck_card_tags.length
  )
    throw Error("Use deckmaster folder/tag commands to add or remove definitions");
  for (const f of m.folders) {
    keys(f, ["id", "name", "parent_id", "path"]);
    const r = folders.get(f.id);
    if (!r) throw Error("Unknown folder ID");
    r.df_name = f.name;
    r.df_parent_folder = f.parent_id;
  }
  for (const t of m.tags) {
    keys(t, ["id", "name"]);
    const r = tags.get(t.id);
    if (!r) throw Error("Unknown tag ID");
    r.dct_name = t.name;
  }
  for (const entry of m.decks) {
    if (
      !/^[a-f0-9]{20}\/deck\.json$/.test(entry.file) ||
      hash(entry.id).slice(0, 20) + "/deck.json" !== entry.file
    )
      throw Error("Invalid deck-file path");
    const p = path.join(store.library, entry.file);
    if (!fs.existsSync(p))
      throw Error(
        "Deck file is missing; restore it or use deckmaster deck delete explicitly",
      );
    const doc = read(p),
      d = decks.get(entry.id);
    if (!d || doc.id !== entry.id || doc.schema !== schema)
      throw Error("Deck identity/format mismatch");
    keys(doc, [
      "schema",
      "id",
      "name",
      "format",
      "folder_id",
      "folder",
      "notes",
      "locked",
      "cards",
    ]);
    if (
      doc.format !== (d.d_format === 4 ? "commander" : d.d_format) ||
      doc.locked !== (d.d_locked === 1)
    )
      throw Error("Format/lock changes in files are unsupported");
    const old = deckDocument(s, d, catalog);
    // The folder path is a readable annotation; folder_id determines membership.
    d.d_name = doc.name;
    d.d_notes = doc.notes;
    d.d_parent_folder = doc.folder_id;
    if (!Array.isArray(doc.cards)) throw Error("cards must be an array");
    const newCards = [],
      relations = [];
    for (const c of doc.cards) {
      keys(c, [
        "cv_id",
        "name",
        "scryfall_id",
        "board",
        "finish",
        "quantity",
        "proxies",
        "tags",
      ]);
      const ref = catalog.lookup(c.cv_id);
      if (
        !ref ||
        ref.c_name !== c.name ||
        ref.cv_scryfall_id !== c.scryfall_id
      )
        throw Error(
          "Card name/reference mismatch. Use deckmaster card add to resolve new names.",
        );
      const b =
        typeof c.board === "number"
          ? c.board
          : Object.entries(BOARD_NAMES).find(([, v]) => v === c.board)?.[0];
      if (b === undefined) throw Error("Unknown board");
      const row = {
        dc_d_id: d.id,
        dc_cv_id: c.cv_id,
        dc_foil: c.finish,
        dc_board_category: Number(b),
        dc_quantity: c.quantity,
        dc_proxy_qty: c.proxies,
      };
      row.id = cardKey(row);
      const prior = cards.get(row.id);
      newCards.push({ ...prior, ...row });
      if (!Array.isArray(c.tags) || new Set(c.tags).size !== c.tags.length)
        throw Error("Invalid tag list");
      for (const tag of c.tags) {
        if (!tags.has(tag))
          throw Error("Unknown tag ID");
        const r = {
          owner_id: s.uid,
          dctr_dct_id: tag,
          dctr_dc_d_id: d.id,
          dctr_dc_cv_id: c.cv_id,
          dctr_dc_foil: c.finish,
          dctr_dc_board_category: Number(b),
        };
        r.id = tag + "." + relationCardKey(r);
        const prior = assigned.get(r.id);
        relations.push({ ...prior, ...r });
      }
    }
    if (new Set(newCards.map((r) => r.id)).size !== newCards.length)
      throw Error("Duplicate card/finish/board in deck file");
    s.tables.deck_cards = s.tables.deck_cards
      .filter((r) => r.dc_d_id !== d.id)
      .concat(newCards);
    s.tables.deck_card_tags_rel = s.tables.deck_card_tags_rel
      .filter((r) => r.dctr_dc_d_id !== d.id)
      .concat(relations);
    if (
      canonical({ ...old, folder: undefined }) !==
      canonical({ ...doc, folder: undefined })
    )
      d.d_edit_date = new Date().toISOString();
  }
  valid(s);
  return { ...w, working: s };
}
export function parseList(text) {
  let b = "main",
    rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(" | ", 1)[0].trim();
    if (!line) {
      if (b === "commander" && rows.at(-1)?.board === BOARDS.commander) b = "main";
      continue;
    }
    const header = line.replace(/^(?:#|\/\/)\s*|^\[|\]$/g, "").trim().toLowerCase();
    const aliases = { commander: "commander", main: "main", mainboard: "main", deck: "main", side: "side", sideboard: "side", maybe: "maybe", maybeboard: "maybe" };
    if (Object.hasOwn(aliases, header)) {
      b = aliases[header];
      continue;
    }
    if (line.startsWith("#")) {
      const v = line.slice(1).trim().toLowerCase();
      if (Object.hasOwn(BOARDS, v)) b = v;
      else throw Error("Unknown section: " + v);
      continue;
    }
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m || Number(m[1]) < 1)
      throw Error("Expected quantity and exact card name: " + line);
    const marker = /\s+\*([FE])\*$/i.exec(m[2]);
    const cardName = marker ? m[2].slice(0, marker.index) : m[2];
    const printing = /^(.*?)\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?$/.exec(cardName);
    rows.push({ quantity: Number(m[1]), name: printing ? printing[1] : cardName, board: BOARDS[b],
      ...(printing ? { set: printing[2], ...(printing[3] ? { number: printing[3] } : {}) } : {}),
      ...(marker ? { finish: marker[1].toUpperCase() === "F" ? 1 : 2 } : {}),
    });
  }
  if (!rows.length) throw Error("Deck list is empty");
  return rows;
}
