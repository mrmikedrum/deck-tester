import { randomBytes } from "node:crypto";
import {
  canonical,
  auditSnapshot,
  cardKey,
  relationCardKey,
} from "./account.mjs";
import { columns } from "./schema.mjs";
import { digest } from "./store.mjs";
export const BOARDS = { main: 0, side: 1, commander: 2, maybe: 3 };
export const BOARD_NAMES = {
  0: "main",
  1: "side",
  2: "commander",
  3: "maybe",
  4: "oathbreaker",
  5: "signature",
};
export const MANAGED = [
  "decks_folders",
  "deck_card_tags",
  "decks",
  "deck_cards",
  "deck_card_tags_rel",
];
const identity = {
  decks: "d_id",
  decks_folders: "df_id",
  deck_card_tags: "dct_id",
};
export function uuid() {
  const b = randomBytes(16);
  b.writeUIntBE(Date.now(), 0, 6);
  b[6] = (b[6] & 15) | 112;
  b[8] = (b[8] & 63) | 128;
  return b.toString("base64");
}
export function named(v, label = "Name") {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > 200 ||
    /[\u0000-\u001f]/.test(v)
  )
    throw Error(label + " must be 1–200 printable characters");
  return v.trim();
}
export function quantity(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0 || n > 10000)
    throw Error("Quantity must be an integer from 0 to 10000");
  return n;
}
export function board(v = "main") {
  if (!Object.hasOwn(BOARDS, v))
    throw Error("Board must be main, commander, side, or maybe");
  return BOARDS[v];
}
export function valid(s) {
  const a = auditSnapshot(s);
  if (a.issues.length)
    throw Error("Account integrity check failed: " + a.issues[0].code);
  if (Object.keys(s.untyped_tables ?? {}).length)
    throw Error("Unknown cloud tables received; review schema before writing");
  return a;
}
export function folderPath(s, id) {
  if (id == null) return "";
  const seen = new Set(),
    names = [];
  while (id != null) {
    if (seen.has(id)) throw Error("Folder cycle");
    seen.add(id);
    const f = s.tables.decks_folders.find((r) => r.id === id);
    if (!f) throw Error("Missing folder");
    names.unshift(f.df_name);
    id = f.df_parent_folder;
  }
  return names.join("/");
}
export function resolveFolder(s, ref) {
  if (ref === "/" || ref === "root") return null;
  const exact = s.tables.decks_folders.find((f) => f.id === ref);
  if (exact) return exact;
  const matches = s.tables.decks_folders.filter(
    (f) => folderPath(s, f.id) === ref.replace(/^\/|\/$/g, ""),
  );
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? "Ambiguous folder path; use its ID"
        : "Folder not found: " + ref,
    );
  return matches[0];
}
export function resolveDeck(s, ref) {
  if (!ref) throw Error("Provide a deck name, folder/name, or exact ID");
  const exact = s.tables.decks.find((d) => d.id === ref);
  if (exact) return exact;
  let matches = s.tables.decks.filter(
    (d) =>
      [folderPath(s, d.d_parent_folder), d.d_name].filter(Boolean).join("/") ===
      ref,
  );
  if (!matches.length) matches = s.tables.decks.filter((d) => d.d_name === ref);
  if (matches.length !== 1)
    throw Error(
      matches.length
        ? "Ambiguous deck name; use folder/name or its ID"
        : "Deck not found: " + ref,
    );
  return matches[0];
}
export function resolveTag(s, ref) {
  const exact = s.tables.deck_card_tags.find((t) => t.id === ref);
  if (exact) return exact;
  const matches = s.tables.deck_card_tags.filter((t) => t.dct_name === ref);
  if (matches.length !== 1)
    throw Error(
      matches.length ? "Ambiguous tag; use its ID" : "Tag not found: " + ref,
    );
  return matches[0];
}
export function editable(s, d) {
  if (d.d_locked !== 0) throw Error("Deck is locked");
  if (s.tables.binders.some((b) => b.b_linked_deck_id === d.id))
    throw Error(
      "Deck is linked to a collection; linked writes are not supported",
    );
  if (d.d_format !== 4)
    throw Error("Edits are currently restricted to Commander decks");
}
export function touch(d) {
  d.d_edit_date = new Date().toISOString();
}
export function createFolder(s, ref) {
  const parts = ref.replace(/^\/|\/$/g, "").split("/");
  let parent = null,
    last;
  for (const part of parts) {
    named(part, "Folder name");
    const found = s.tables.decks_folders.filter(
      (f) => f.df_parent_folder === parent && f.df_name === part,
    );
    if (found.length > 1) throw Error("Ambiguous folder");
    last = found[0];
    if (!last) {
      const id = uuid();
      last = {
        id,
        df_id: id,
        owner_id: s.uid,
        df_name: part,
        df_parent_folder: parent,
        df_cv_id_image_1: null,
        df_cv_id_image_2: null,
        df_cv_face_index_image_1: null,
        df_cv_face_index_image_2: null,
      };
      s.tables.decks_folders.push(last);
    }
    parent = last.id;
  }
  return last;
}
export function createDeck(
  s,
  name,
  { folder = "Claw", commander = null, notes = null } = {},
) {
  named(name, "Deck name");
  const parent = folder === "/" ? null : createFolder(s, folder).id;
  if (
    s.tables.decks.some(
      (d) => d.d_parent_folder === parent && d.d_name === name,
    )
  )
    throw Error("A deck with this name already exists in that folder");
  const id = uuid(),
    now = new Date().toISOString();
  const d = {
    id,
    d_id: id,
    owner_id: s.uid,
    d_name: name,
    d_format: 4,
    d_timestamp: now,
    d_edit_date: now,
    d_locked: 0,
    d_cv_id_image: commander?.cv_id ?? null,
    d_notes: notes,
    d_parent_folder: parent,
    d_cv_face_index_image: 0,
    d_last_shared_timestamp: null,
    d_config: null,
  };
  s.tables.decks.push(d);
  if (commander) addCard(s, d, commander.cv_id, 1, 2);
  return d;
}
export function addCard(s, d, cv, qty = 1, b = 0, finish = 0) {
  editable(s, d);
  qty = quantity(qty);
  if (!qty) throw Error("Add quantity must be positive");
  if (![0, 1, 2].includes(finish)) throw Error("Unknown card finish");
  const id = [d.id, cv, finish, b].join(".");
  let c = s.tables.deck_cards.find((c) => c.id === id);
  if (c) c.dc_quantity = quantity(c.dc_quantity + qty);
  else {
    c = {
      id,
      dc_d_id: d.id,
      dc_cv_id: cv,
      dc_foil: finish,
      dc_board_category: b,
      dc_quantity: qty,
      dc_proxy_qty: 0,
    };
    s.tables.deck_cards.push(c);
  }
  touch(d);
  return c;
}
export function deleteCard(s, d, c) {
  editable(s, d);
  s.tables.deck_card_tags_rel = s.tables.deck_card_tags_rel.filter(
    (r) => relationCardKey(r) !== c.id,
  );
  s.tables.deck_cards = s.tables.deck_cards.filter((r) => r.id !== c.id);
  touch(d);
}
export function setCard(s, d, c, qty) {
  editable(s, d);
  qty = quantity(qty);
  if (!qty && c.dc_proxy_qty === 0) deleteCard(s, d, c);
  else {
    c.dc_quantity = qty;
    touch(d);
  }
}
export function moveCard(s, d, c, b) {
  editable(s, d);
  if (c.dc_board_category === b) return c;
  const tags = s.tables.deck_card_tags_rel
    .filter((r) => relationCardKey(r) === c.id)
    .map((r) => r.dctr_dct_id);
  const target = [d.id, c.dc_cv_id, c.dc_foil, b].join(".");
  let to = s.tables.deck_cards.find((r) => r.id === target);
  if (to) {
    to.dc_quantity += c.dc_quantity;
    to.dc_proxy_qty += c.dc_proxy_qty;
  } else {
    to = { ...c, id: target, dc_board_category: b };
    s.tables.deck_cards.push(to);
  }
  deleteCard(s, d, c);
  for (const tag of tags) tagCard(s, to, tag);
  touch(d);
  return to;
}
export function createTag(s, name) {
  named(name, "Tag name");
  const found = s.tables.deck_card_tags.filter((t) => t.dct_name === name);
  if (found.length > 1) throw Error("Ambiguous tag name");
  if (found.length) return found[0];
  const id = uuid(),
    t = { id, dct_id: id, dct_name: name, owner_id: s.uid };
  s.tables.deck_card_tags.push(t);
  return t;
}
export function tagCard(s, c, tag) {
  const id = tag + "." + c.id;
  if (!s.tables.deck_card_tags_rel.some((r) => r.id === id))
    s.tables.deck_card_tags_rel.push({
      id,
      owner_id: s.uid,
      dctr_dct_id: tag,
      dctr_dc_d_id: c.dc_d_id,
      dctr_dc_cv_id: c.dc_cv_id,
      dctr_dc_foil: c.dc_foil,
      dctr_dc_board_category: c.dc_board_category,
    });
}
export function copyDeck(s, d, name, folder = "Claw") {
  if (d.d_format !== 4) throw Error("Only Commander decks may be copied");
  const n = createDeck(s, name, { folder });
  const keep = {
    id: n.id,
    d_id: n.id,
    owner_id: s.uid,
    d_name: name,
    d_parent_folder: n.d_parent_folder,
    d_timestamp: n.d_timestamp,
    d_edit_date: n.d_edit_date,
    d_locked: 0,
    d_last_shared_timestamp: null,
  };
  if (
    Object.keys(d).some((k) => k !== "id" && !Object.hasOwn(columns.decks, k))
  )
    throw Error("Deck has unknown fields; refusing an incomplete copy");
  Object.assign(n, d, keep);
  for (const c of s.tables.deck_cards.filter((c) => c.dc_d_id === d.id)) {
    const next = { ...c, dc_d_id: n.id };
    next.id = cardKey(next);
    s.tables.deck_cards.push(next);
  }
  for (const r of s.tables.deck_card_tags_rel.filter(
    (r) => r.dctr_dc_d_id === d.id,
  )) {
    const next = { ...r, dctr_dc_d_id: n.id };
    next.id = next.dctr_dct_id + "." + relationCardKey(next);
    s.tables.deck_card_tags_rel.push(next);
  }
  return n;
}
export function removeDeck(s, d) {
  editable(s, d);
  s.tables.deck_card_tags_rel = s.tables.deck_card_tags_rel.filter(
    (r) => r.dctr_dc_d_id !== d.id,
  );
  s.tables.deck_cards = s.tables.deck_cards.filter((r) => r.dc_d_id !== d.id);
  s.tables.decks = s.tables.decks.filter((r) => r.id !== d.id);
}
export function diff(base, next) {
  if (base.uid !== next.uid) throw Error("Different accounts");
  const ops = [];
  for (const table of Object.keys(base.tables)) {
    const b = new Map(base.tables[table].map((r) => [r.id, r])),
      n = new Map((next.tables[table] ?? []).map((r) => [r.id, r]));
    for (const id of new Set([...b.keys(), ...n.keys()])) {
      const before = b.get(id),
        after = n.get(id);
      if (canonical(before) === canonical(after)) continue;
      if (!MANAGED.includes(table))
        throw Error("Unmanaged table change: " + table);
      if (!after) ops.push({ op: "DELETE", table, id, before, data: null });
      else if (!before) {
        const { id: _, ...data } = after;
        ops.push({ op: "PUT", table, id, before: null, data });
      } else {
        const data = {};
        for (const k of new Set([
          ...Object.keys(before),
          ...Object.keys(after),
        ]))
          if (k !== "id" && canonical(before[k]) !== canonical(after[k])) {
            if (!Object.hasOwn(after, k))
              throw Error("Fields cannot be removed: " + k);
            data[k] = after[k];
          }
        ops.push({ op: "PATCH", table, id, before, data });
      }
    }
  }
  const order = {
    deck_card_tags_rel: 0,
    deck_cards: 1,
    decks: 2,
    deck_card_tags: 3,
    decks_folders: 4,
  };
  // Parent-before-child creates, child-before-parent deletes. Folder depth handled by compiler.
  const depth = (o) => {
    let id = (
        next.tables.decks_folders.find((f) => f.id === o.id) ??
        base.tables.decks_folders.find((f) => f.id === o.id)
      )?.df_parent_folder,
      n = 0;
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      seen.add(id);
      n++;
      id = (
        next.tables.decks_folders.find((f) => f.id === id) ??
        base.tables.decks_folders.find((f) => f.id === id)
      )?.df_parent_folder;
    }
    return n;
  };
  return ops.sort((a, b) =>
    a.table === "decks_folders" && b.table === "decks_folders" && a.op === b.op
      ? a.op === "DELETE"
        ? depth(b) - depth(a)
        : depth(a) - depth(b)
      : a.op === "DELETE" && b.op !== "DELETE"
        ? -1
        : b.op === "DELETE" && a.op !== "DELETE"
          ? 1
          : a.op === "DELETE"
            ? order[a.table] - order[b.table]
            : MANAGED.indexOf(a.table) - MANAGED.indexOf(b.table),
  );
}
export function applyOps(base, ops) {
  const s = structuredClone(base),
    tables = new Map();
  for (const o of ops) {
    if (!tables.has(o.table))
      tables.set(o.table, new Map(s.tables[o.table].map((r) => [r.id, r])));
    const t = tables.get(o.table),
      row = t.get(o.id);
    if (o.op === "DELETE") t.delete(o.id);
    else if (o.op === "PUT") {
      if (row) throw Error("PUT would replace row");
      t.set(o.id, { id: o.id, ...o.data });
    } else {
      if (!row) throw Error("PATCH row missing");
      t.set(o.id, { ...row, ...o.data });
    }
  }
  for (const [table, rows] of tables) s.tables[table] = [...rows.values()];
  return s;
}
export function merge(base, local, remote) {
  if (base.uid !== local.uid || base.uid !== remote.uid)
    throw Error("Account mismatch");
  const merged = structuredClone(remote),
    conflicts = [],
    index = {},
    deleted = new Set();
  for (const o of diff(base, local)) {
    const rows = merged.tables[o.table],
      r = (index[o.table] ??= new Map(rows.map((r) => [r.id, r]))).get(o.id);
    if (o.op === "PUT") {
      if (r && canonical(r) !== canonical({ id: o.id, ...o.data }))
        conflicts.push({ table: o.table, id: o.id, field: "row" });
      else if (!r) rows.push({ id: o.id, ...o.data });
    } else if (o.op === "DELETE") {
      if (r && canonical(r) !== canonical(o.before))
        conflicts.push({ table: o.table, id: o.id, field: "deleted_row" });
      else if (r) deleted.add(r);
    } else if (!r)
      conflicts.push({ table: o.table, id: o.id, field: "missing_row" });
    else
      for (const [k, v] of Object.entries(o.data)) {
        if (
          canonical(r[k]) !== canonical(o.before[k]) &&
          canonical(r[k]) !== canonical(v)
        )
          conflicts.push({ table: o.table, id: o.id, field: k });
        else r[k] = v;
      }
  }
  for (const table of Object.keys(index))
    merged.tables[table] = merged.tables[table].filter((r) => !deleted.has(r));
  if (conflicts.length)
    throw Object.assign(
      Error(
        "Local/cloud edits conflict. Local files were preserved; inspect deckmaster diff before retrying.",
      ),
      { conflicts },
    );
  valid(merged);
  return merged;
}
const patchFields = {
  decks: [
    "d_name",
    "d_notes",
    "d_parent_folder",
    "d_edit_date",
    "d_cv_id_image",
    "d_cv_face_index_image",
  ],
  deck_cards: ["dc_quantity", "dc_proxy_qty"],
  decks_folders: [
    "df_name",
    "df_parent_folder",
    "df_cv_id_image_1",
    "df_cv_id_image_2",
    "df_cv_face_index_image_1",
    "df_cv_face_index_image_2",
  ],
  deck_card_tags: ["dct_name"],
  deck_card_tags_rel: [],
};
export function validatePlan(
  base,
  ops,
  { protectedDecks = [], allowDelete = false } = {},
) {
  valid(base);
  if (!Array.isArray(ops) || ops.length > 10000)
    throw Error("Operation limit is 10000; do not split automatically");
  const seen = new Set(),
    rows = Object.fromEntries(
      Object.entries(base.tables).map(([t, rs]) => [t, new Map(rs.map((r) => [r.id, r]))]),
    );
  const next = applyOps(base, ops);
  valid(next);
  for (const d of next.tables.decks) named(d.d_name, "Deck name");
  for (const f of next.tables.decks_folders) {
    named(f.df_name, "Folder name");
    if (f.df_name.includes("/")) throw Error("Folder name cannot contain /");
  }
  for (const t of next.tables.deck_card_tags) named(t.dct_name, "Tag name");
  for (const o of ops) {
    if (
      !MANAGED.includes(o.table) ||
      !["PUT", "PATCH", "DELETE"].includes(o.op) ||
      seen.has(o.table + o.id)
    )
      throw Error("Invalid or duplicate operation");
    seen.add(o.table + o.id);
    const prior = rows[o.table].get(o.id) ?? null;
    if (canonical(prior) !== canonical(o.before))
      throw Error("Stale operation");
    if ((o.op === "PUT" && prior) || (o.op !== "PUT" && !prior))
      throw Error("Operation identity mismatch");
    if (o.op !== "DELETE")
      for (const [k, v] of Object.entries(o.data)) {
        if (!Object.hasOwn(columns[o.table], k))
          throw Error("Unknown field: " + k);
        if (
          (v !== null && !["string", "number"].includes(typeof v)) ||
          (typeof v === "number" && !Number.isSafeInteger(v))
        )
          throw Error("Invalid scalar");
        if (o.op === "PATCH" && !patchFields[o.table].includes(k))
          throw Error("Identity/unsupported field edit: " + k);
      }
    if (
      o.op === "PUT" &&
      o.table === "deck_card_tags_rel" &&
      o.data.owner_id !== base.uid
    )
      throw Error("Tag assignment owner is required");
    if (
      o.op === "PUT" &&
      identity[o.table] &&
      (o.data[identity[o.table]] !== o.id || o.data.owner_id !== base.uid)
    )
      throw Error("Invalid row owner/identity");
    const deckId =
      o.table === "decks"
        ? o.id
        : o.table === "deck_cards"
          ? (o.data?.dc_d_id ?? prior?.dc_d_id)
          : o.table === "deck_card_tags_rel"
            ? (o.data?.dctr_dc_d_id ?? prior?.dctr_dc_d_id)
            : null;
    if (deckId) {
      if (protectedDecks.includes(deckId))
        throw Error("Original deck is protected during CLI testing");
      const d = rows.decks.get(deckId);
      if (d) editable(base, d);
    }
    if (o.table === "decks" && o.op === "PUT" && o.data.d_format !== 4)
      throw Error("Only Commander creation is supported");
    if (o.table === "decks" && o.op === "DELETE" && !allowDelete)
      throw Error(
        "Deck deletion requires --confirm-delete with the exact deck name",
      );
    if (
      o.table === "deck_card_tags" &&
      o.op !== "PUT" &&
      base.tables.deck_card_tags_rel.some(
        (r) =>
          r.dctr_dct_id === o.id && protectedDecks.includes(r.dctr_dc_d_id),
      )
    )
      throw Error("Tag is used by a protected deck");
    if (
      o.table === "decks_folders" &&
      o.op !== "PUT" &&
      protectedDecks.length
    ) {
      let protectedFolder = false;
      for (const id of protectedDecks) {
        let f = base.tables.decks.find((d) => d.id === id)?.d_parent_folder;
        const seen = new Set();
        while (f != null && !seen.has(f)) {
          seen.add(f);
          if (f === o.id) protectedFolder = true;
          f = base.tables.decks_folders.find(
            (r) => r.id === f,
          )?.df_parent_folder;
        }
      }
      if (protectedFolder)
        throw Error("Original folder is protected during testing");
    }
  }
  // Catch direct local-file edits of non-managed/untyped data.
  for (const [t, rows] of Object.entries(base.tables))
    if (!MANAGED.includes(t) && canonical(rows) !== canonical(next.tables[t]))
      throw Error("Unmanaged changes");
  return next;
}
export function compilePlan(base, next, policy = {}) {
  const operations = diff(base, next);
  validatePlan(base, operations, policy);
  return {
    version: 1,
    uid: base.uid,
    base_digest: digest(base),
    created_at: new Date().toISOString(),
    operations,
    allow_delete: policy.allowDelete === true,
  };
}
export function verifyPlan(plan, observed) {
  const rows = Object.fromEntries(
    Object.entries(observed.tables).map(([t, rs]) => [t, new Map(rs.map((r) => [r.id, r]))]),
  );
  const result = plan.operations.map((o) => {
    const r = rows[o.table].get(o.id);
    return {
      table: o.table,
      id: o.id,
      ok:
        o.op === "DELETE"
          ? !r
          : !!r &&
            Object.entries(o.data).every(
              ([k, v]) => canonical(r[k] ?? null) === canonical(v),
            ),
    };
  });
  return { ok: result.every((r) => r.ok), operations: result };
}

// Replacing a text list retains the existing exact printing/finish and tags when
// a name and board identify one row. Ambiguous multiple printings require JSON.
export function importList(s, d, rows, catalog, { replace = false } = {}) {
  editable(s, d);
  const oldCards = s.tables.deck_cards.filter((c) => c.dc_d_id === d.id);
  const oldRelations = s.tables.deck_card_tags_rel.filter(
    (r) => r.dctr_dc_d_id === d.id,
  );
  if (oldCards.length && !replace)
    throw Error("Deck already has cards; use --replace or deckmaster card add");
  const grouped = new Map();
  for (const r of rows) {
    const ref = catalog.resolve(r.name, { set: r.set, number: r.number }),
      key = ref.cv_oracle_id + "." + r.board + (r.set ? "." + ref.cv_id : "") + (r.finish !== undefined ? ".finish" + r.finish : "");
    const item = grouped.get(key) ?? { ...r, quantity: 0, ref };
    item.quantity = quantity(item.quantity + r.quantity);
    grouped.set(key, item);
  }
  const selected = [];
  for (const r of grouped.values()) {
    const candidates = oldCards.filter(
      (c) =>
        c.dc_board_category === r.board &&
        catalog.lookup(c.dc_cv_id)?.cv_oracle_id === r.ref.cv_oracle_id,
    );
    const requestedFinish = r.finish ?? (r.set ? 0 : undefined);
    const exact = candidates.filter((card) => (!r.set || card.dc_cv_id === r.ref.cv_id) && (requestedFinish === undefined || card.dc_foil === requestedFinish));
    const matches = exact.length ? exact : candidates;
    if (matches.length > 1)
      throw Error(
        "Text import is ambiguous across printings/finishes for " +
          r.name +
          ". Edit deck.json to preserve exact rows.",
      );
    const prior = matches[0];
    const finish = requestedFinish ?? prior?.dc_foil ?? 0;
    const selectedRef = !r.set && prior ? catalog.lookup(prior.dc_cv_id) : r.ref;
    const available = selectedRef[["cv_non_foil", "cv_foil", "cv_etched"][finish]];
    if (available === 0) throw Error("Selected printing does not support the requested finish: " + r.name);
    selected.push({ r, prior, finish });
  }
  const identities = selected.map(({ r, prior, finish }) => [d.id, r.set ? r.ref.cv_id : prior?.dc_cv_id ?? r.ref.cv_id, finish, r.board].join("."));
  const retained = selected.filter(({ prior }) => prior).map(({ prior }) => prior.id);
  if (new Set(retained).size !== retained.length) throw Error("Text import would split existing printing metadata ambiguously; use deck.json for exact rows");
  if (new Set(identities).size !== identities.length) throw Error("Overlapping explicit and default printing entries; choose one representation per card row");
  for (const c of oldCards) deleteCard(s, d, c);
  for (const { r, prior, finish } of selected) {
    let c;
    if (prior) {
      c = {
        ...prior,
        dc_cv_id: r.set ? r.ref.cv_id : prior.dc_cv_id,
        dc_foil: finish,
        dc_quantity: Math.max(0, r.quantity - prior.dc_proxy_qty),
        dc_proxy_qty: Math.min(r.quantity, prior.dc_proxy_qty),
      };
      c.id = cardKey(c);
      s.tables.deck_cards.push(c);
      for (const rel of oldRelations.filter((t) => relationCardKey(t) === c.id))
        s.tables.deck_card_tags_rel.push(rel);
      if (c.id !== prior.id)
        for (const rel of oldRelations.filter((tag) => relationCardKey(tag) === prior.id)) tagCard(s, c, rel.dctr_dct_id);
    } else {
      c = addCard(s, d, r.ref.cv_id, r.quantity, r.board, finish);
    }
    if (r.board === 2) d.d_cv_id_image = c.dc_cv_id;
  }
  touch(d);
  return d;
}
