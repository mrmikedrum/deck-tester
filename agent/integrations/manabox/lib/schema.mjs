// PowerSync column types, inlined so local commands never load the sync SDK.
const column = { text: { type: "TEXT" }, integer: { type: "INTEGER" } };
export const columns = {
  decks: {
    d_id: column.text,
    owner_id: column.text,
    d_name: column.text,
    d_format: column.integer,
    d_timestamp: column.text,
    d_edit_date: column.text,
    d_locked: column.integer,
    d_cv_id_image: column.integer,
    d_notes: column.text,
    d_parent_folder: column.text,
    d_cv_face_index_image: column.integer,
    d_last_shared_timestamp: column.text,
    d_config: column.text,
  },
  deck_cards: {
    dc_d_id: column.text,
    dc_cv_id: column.integer,
    dc_foil: column.integer,
    dc_board_category: column.integer,
    dc_quantity: column.integer,
    dc_proxy_qty: column.integer,
  },
  decks_folders: {
    df_id: column.text,
    owner_id: column.text,
    df_name: column.text,
    df_parent_folder: column.text,
    df_cv_id_image_1: column.integer,
    df_cv_id_image_2: column.integer,
    df_cv_face_index_image_1: column.integer,
    df_cv_face_index_image_2: column.integer,
  },
  deck_card_tags: {
    dct_id: column.text,
    dct_name: column.text,
    owner_id: column.text,
  },
  deck_card_tags_rel: {
    owner_id: column.text,
    dctr_dct_id: column.text,
    dctr_dc_d_id: column.text,
    dctr_dc_cv_id: column.integer,
    dctr_dc_foil: column.integer,
    dctr_dc_board_category: column.integer,
  },
  binders: {
    b_id: column.text,
    owner_id: column.text,
    b_name: column.text,
    b_type: column.integer,
    b_linked_deck_id: column.text,
  },
  inventory_cards: {
    ic_id: column.text,
    ic_binder_id: column.text,
    ic_cv_id: column.integer,
    ic_quantity: column.integer,
  },
  archived_decks: {},
  filters: {},
  collection_metadata: {},
};
export function wireEntry(e) {
  return {
    op: e.op,
    table: e.table,
    id: e.id,
    client_id: e.clientId,
    tx_id: e.transactionId ?? null,
    data: e.opData ?? null,
  };
}
