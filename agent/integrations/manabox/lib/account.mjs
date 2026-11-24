// Recovered relationships, not a replacement for server validation.
export const ACCOUNT_TABLES = [
  "decks",
  "deck_cards",
  "decks_folders",
  "deck_card_tags",
  "deck_card_tags_rel",
  "binders",
  "inventory_cards",
];
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
      .join(",") +
    "}"
  );
}
export const cardKey = (r) =>
  [r.dc_d_id, r.dc_cv_id, r.dc_foil, r.dc_board_category].join(".");
export const relationCardKey = (r) =>
  [
    r.dctr_dc_d_id,
    r.dctr_dc_cv_id,
    r.dctr_dc_foil,
    r.dctr_dc_board_category,
  ].join(".");
export function auditSnapshot(s) {
  const issues = [],
    t = s.tables ?? {};
  const add = (code, table, id) => issues.push({ code, table, id });
  for (const table of ACCOUNT_TABLES)
    if (!Array.isArray(t[table])) add("table_not_captured", table, null);
  if (issues.length) return { issues, complete_for_known_relationships: false };
  const index = Object.fromEntries(
    ACCOUNT_TABLES.map((k) => [k, new Map(t[k].map((r) => [r.id, r]))]),
  );
  for (const table of ACCOUNT_TABLES) {
    if (index[table].size !== t[table].length) add("duplicate_id", table, null);
    for (const r of t[table]) {
      if (typeof r.id !== "string" || !r.id) add("invalid_id", table, r.id);
      if (r.owner_id !== undefined && r.owner_id !== s.uid)
        add("owner_mismatch", table, r.id);
    }
  }
  for (const [table, key] of [
    ["decks", "d_id"],
    ["decks_folders", "df_id"],
    ["deck_card_tags", "dct_id"],
    ["binders", "b_id"],
    ["inventory_cards", "ic_id"],
  ]) {
    for (const r of t[table])
      if (r[key] !== r.id) add("identity_mismatch", table, r.id);
  }
  for (const r of t.decks)
    if (
      r.d_parent_folder != null &&
      !index.decks_folders.has(r.d_parent_folder)
    )
      add("missing_parent_folder", "decks", r.id);
  for (const r of t.decks_folders) {
    const visited = new Set([r.id]);
    let parent = r.df_parent_folder;
    while (parent != null) {
      if (visited.has(parent)) {
        add("folder_cycle", "decks_folders", r.id);
        break;
      }
      visited.add(parent);
      const p = index.decks_folders.get(parent);
      if (!p) {
        add("missing_parent_folder", "decks_folders", r.id);
        break;
      }
      parent = p.df_parent_folder;
    }
  }
  for (const r of t.deck_cards) {
    if (!index.decks.has(r.dc_d_id)) add("missing_deck", "deck_cards", r.id);
    if (cardKey(r) !== r.id) add("card_key_mismatch", "deck_cards", r.id);
    if (!Number.isSafeInteger(r.dc_cv_id) || r.dc_cv_id < 0)
      add("invalid_card_version", "deck_cards", r.id);
    if (
      ![0, 1, 2].includes(r.dc_foil) ||
      ![0, 1, 2, 3, 4, 5].includes(r.dc_board_category)
    )
      add("unknown_finish_or_board", "deck_cards", r.id);
    if (
      !Number.isSafeInteger(r.dc_quantity) ||
      r.dc_quantity < 0 ||
      !Number.isSafeInteger(r.dc_proxy_qty) ||
      r.dc_proxy_qty < 0 ||
      r.dc_quantity + r.dc_proxy_qty < 1
    )
      add("invalid_quantity", "deck_cards", r.id);
  }
  for (const r of t.deck_card_tags_rel) {
    if (!index.deck_card_tags.has(r.dctr_dct_id))
      add("missing_tag", "deck_card_tags_rel", r.id);
    const key = relationCardKey(r);
    if (!index.deck_cards.has(key))
      add("missing_tagged_card", "deck_card_tags_rel", r.id);
    if (r.id !== r.dctr_dct_id + "." + key)
      add("tag_relation_key_mismatch", "deck_card_tags_rel", r.id);
  }
  for (const r of t.binders)
    if (r.b_linked_deck_id != null && !index.decks.has(r.b_linked_deck_id))
      add("missing_linked_deck", "binders", r.id);
  for (const r of t.inventory_cards)
    if (!index.binders.has(r.ic_binder_id))
      add("missing_binder", "inventory_cards", r.id);
  return {
    issues,
    complete_for_known_relationships: true,
    counts: Object.fromEntries(ACCOUNT_TABLES.map((k) => [k, t[k].length])),
    unknown_tables: Object.keys(s.untyped_tables ?? {}),
    scope:
      "Only rows delivered to this client; not proof of full account coverage.",
  };
}
