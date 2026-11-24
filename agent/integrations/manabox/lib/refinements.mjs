import { randomUUID } from "node:crypto";
import { digest, hash } from "./store.mjs";
import * as M from "./model.mjs";

const fields = ["finding", "decision", "reason", "alternatives", "tradeoffs", "checks"];

function revertedIds(records) {
  const reverted = new Set();
  for (const record of [...records].reverse()) {
    if (record.reverts && !reverted.has(record.id)) reverted.add(record.reverts);
  }
  return reverted;
}

export function refine(state, catalog, input) {
  if (!input || !Array.isArray(input.actions)) throw Error("Refinement requires an actions array");
  for (const key of Object.keys(input)) {
    if (![...fields, "actions", "decks"].includes(key)) throw Error("Unknown refinement field: " + key);
  }
  for (const key of fields) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw Error(key + " must be text");
  }
  if (input.decks !== undefined && !Array.isArray(input.decks)) throw Error("decks must be an array of selectors");
  const deckIds = (input.decks ?? []).map((selector) => M.resolveDeck(state, selector).id);
  const changes = [];
  for (const action of input.actions) {
    for (const key of Object.keys(action)) {
      if (!["action", "deck", "card", "quantity", "board", "to", "cv_id", "finish", "all"].includes(key)) throw Error("Unknown action field: " + key);
    }
    if (!["add", "set", "remove", "move"].includes(action.action)) throw Error("Unknown refinement action");
    const deck = M.resolveDeck(state, action.deck);
    M.editable(state, deck);
    const board = M.board(action.board);
    const finish = action.finish === undefined ? undefined : { normal: 0, foil: 1, etched: 2 }[action.finish];
    if (action.finish !== undefined && finish === undefined) throw Error("Unknown finish");
    if (action.cv_id !== undefined && (!Number.isSafeInteger(action.cv_id) || action.cv_id < 0)) throw Error("Invalid cv_id");
    if (action.all !== undefined && typeof action.all !== "boolean") throw Error("all must be boolean");
    if (action.all && action.quantity !== undefined) throw Error("Use all or quantity");
    if (action.all !== undefined && action.action !== "remove") throw Error("all applies only to remove");
    if (action.to !== undefined && action.action !== "move") throw Error("to applies only to move");
    if (action.action === "move" && (action.to === undefined || action.quantity !== undefined)) throw Error("move requires to and moves the entire row");
    const rows = state.tables.deck_cards.filter((card) => card.dc_d_id === deck.id && card.dc_board_category === board &&
      (action.cv_id !== undefined ? card.dc_cv_id === action.cv_id : catalog.lookup(card.dc_cv_id)?.c_name.toLowerCase() === action.card?.toLowerCase()) &&
      (finish === undefined || card.dc_foil === finish));
    if (rows.length > 1) throw Error("Ambiguous card; specify cv_id and finish");
    let card = rows[0];
    if (action.action === "add") {
      const ref = action.cv_id !== undefined ? catalog.lookup(action.cv_id) : catalog.resolve(action.card);
      if (!ref) throw Error("Card not found");
      if (action.card && action.cv_id !== undefined && ref.c_name.toLowerCase() !== action.card.toLowerCase()) throw Error("card and cv_id disagree");
      const selectedFinish = finish ?? card?.dc_foil ?? 0;
      const selected = card ? catalog.lookup(card.dc_cv_id) : ref;
      if (selected[["cv_non_foil", "cv_foil", "cv_etched"][selectedFinish]] === 0) throw Error("Printing does not support finish");
      card = M.addCard(state, deck, card?.dc_cv_id ?? ref.cv_id, M.quantity(action.quantity ?? 1), board, selectedFinish);
    } else {
      if (!card) throw Error("Card not found on selected board");
      if (action.action === "set") {
        if (action.quantity === undefined) throw Error("set requires quantity");
        M.setCard(state, deck, card, M.quantity(action.quantity));
      } else if (action.action === "move") M.moveCard(state, deck, card, M.board(action.to));
      else if (action.all) M.deleteCard(state, deck, card);
      else {
        const amount = M.quantity(action.quantity ?? 1);
        if (!amount || amount > card.dc_quantity) throw Error("Removal exceeds real quantity; use all to remove proxies too");
        M.setCard(state, deck, card, card.dc_quantity - amount);
      }
    }
    changes.push({ ...action, deck: deck.id, deck_name: deck.d_name, card: catalog.lookup(card.dc_cv_id)?.c_name, cv_id: card.dc_cv_id });
  }
  return { ...Object.fromEntries(fields.map((key) => [key, input[key]?.trim() ?? ""])), actions: changes, deck_ids: [...new Set([...deckIds, ...changes.map((action) => action.deck)])] };
}

export function recordRefinement(workspace, before, after, decision) {
  const records = workspace.refinements ?? [];
  const previous = records.at(-1);
  const entry = {
    id: randomUUID(), created_at: new Date().toISOString(),
    before: digest(before), after: digest(after), ...decision,
    changes: M.diff(before, after),
  };
  entry.warnings = fields.filter((key) => !entry[key]).map((key) => "Missing " + key + "; explain this decision before review.");
  const pair = (record) => record?.actions?.length === 2 && record.actions.some((action) => action.action === "add" && (action.quantity ?? 1) === 1) && record.actions.some((action) => (action.action === "remove" && !action.all && (action.quantity ?? 1) === 1) || (action.action === "move" && (action.board ?? "main") === "main" && ["side", "maybe"].includes(action.to)));
  if (pair(entry) && pair(previous)) entry.warnings.push("Consecutive one-for-one edits: group by substantive decision, not by card pair, when they share a rationale.");
  if (records.length + 1 - (workspace.refinements_reviewed ?? 0) > 20) entry.warnings.push("More than 20 refinements since review; review decisions and consolidate related thinking.");
  workspace.refinements = [...records, entry];
  workspace.refinement_pass_id ??= randomUUID();
  workspace.refinement_base ??= structuredClone(before);
  return entry;
}

export function reviseRefinement(workspace, catalog, id, input) {
  const entries = workspace.refinements ?? [];
  if (!workspace.refinement_base || !entries.some((entry) => entry.id === id)) throw Error("Unknown refinement in active pass");
  const retained = input === null ? entries.filter((entry) => entry.id !== id && entry.reverts !== id) : entries;
  const replay = { base: workspace.base, working: structuredClone(workspace.refinement_base), refinement_pass_id: workspace.refinement_pass_id, refinement_base: workspace.refinement_base };
  let previous = structuredClone(workspace.refinement_base);
  for (const entry of entries) previous = M.applyOps(previous, entry.changes);
  for (const entry of retained) {
    const before = structuredClone(replay.working);
    let decision;
    if (entry.id === id && input !== null) decision = refine(replay.working, catalog, input);
    else if (entry.reverts) decision = revertRefinement(replay, replay.working, entry.reverts, entry.reason);
    else decision = refine(replay.working, catalog, {
      ...Object.fromEntries(fields.map((key) => [key, entry[key] ?? ""])),
      decks: entry.deck_ids ?? [],
      actions: entry.actions.map(({ deck_name, ...action }) => action),
    });
    const recorded = recordRefinement(replay, before, replay.working, decision);
    recorded.id = entry.id;
    recorded.created_at = entry.created_at;
  }
  const working = M.merge(previous, workspace.working, replay.working);
  return { working, refinements: replay.refinements ?? [], refinement_pass_id: workspace.refinement_pass_id, refinement_base: workspace.refinement_base, refinements_reviewed: 0 };
}

export function revertRefinement(workspace, state, id, reason) {
  const target = (workspace.refinements ?? []).find((entry) => entry.id === id);
  if (!target) throw Error("Unknown refinement in the active pass");
  if (revertedIds(workspace.refinements ?? []).has(id)) throw Error("Already reverted; make a new decision to revisit it");
  const inverse = [];
  for (const change of target.changes) {
    const row = state.tables[change.table].find((item) => item.id === change.id);
    const original = change.before;
    if (change.op === "PUT") {
      if (hash(row ?? null) !== hash({ id: change.id, ...change.data })) throw Error("Later edits overlap this refinement; use a new compensating refinement to preserve them");
      inverse.push({ table: change.table, id: change.id, op: "DELETE", before: row });
    } else if (change.op === "DELETE") {
      if (row) throw Error("Later edits overlap this refinement; use a new compensating refinement");
      inverse.push({ table: change.table, id: change.id, op: "PUT", data: original });
    } else {
      const fields = Object.keys(change.data).filter((key) => change.table !== "decks" || !["d_timestamp", "d_edit_date"].includes(key));
      if (!fields.length) continue;
      if (!row || fields.some((key) => hash(row[key] ?? null) !== hash(change.data[key] ?? null))) throw Error("Later edits overlap this refinement; use a new compensating refinement");
      inverse.push({ table: change.table, id: change.id, op: "PATCH", before: row, data: Object.fromEntries(fields.map((key) => [key, original[key]])) });
    }
  }
  const restored = M.applyOps(state, inverse);
  M.valid(restored);
  Object.assign(state, restored);
  return { finding: "Review reconsidered an earlier decision", decision: "Revert: " + target.decision, reason: reason ?? "", alternatives: "Retain the earlier decision", tradeoffs: "Restores the affected prior state", checks: "Verified no later edits to the affected fields would be overwritten; deck quality still needs review", actions: [], deck_ids: target.deck_ids ?? target.actions.map((action) => action.deck), reverts: id };
}

export function finishRefinementPass(workspace, report, receipt) {
  if (!report?.pass_id && !report?.refinements?.length) return;
  const history = workspace.refinement_history ?? [];
  const id = report.pass_id ?? hash(report.refinements);
  if (!history.some((pass) => pass.id === id)) history.push({
    id, published_at: new Date().toISOString(), receipt,
    deck_ids: [...new Set(report.refinements.flatMap((entry) => entry.deck_ids ?? entry.actions.map((action) => action.deck)))],
    ...report,
  });
  workspace.refinement_history = history;
}

export function signOffRefinements(workspace, reason) {
  if (typeof reason !== "string" || !reason.trim()) throw Error("Review reason must be nonempty text");
  workspace.refinement_signoff = {
    assessment: reason.trim(), reviewed_at: new Date().toISOString(),
    state_digest: digest(workspace.working), decisions_digest: hash(workspace.refinements ?? []),
  };
  workspace.refinements_reviewed = (workspace.refinements ?? []).length;
}

export function refinementReview(workspace) {
  const records = workspace.refinements ?? [];
  const warnings = records.flatMap((record) => record.warnings ?? []);
  let previous = digest(workspace.base);
  for (const record of records) {
    if (previous !== record.before) warnings.push("Changes outside recorded refinements or cloud merges need explanation; the decision trail is not complete.");
    previous = record.after;
  }
  if (previous !== digest(workspace.working)) warnings.push("Current changes are not fully covered by recorded refinements. Review direct edits/imports and cloud merges.");
  const signoff = workspace.refinement_signoff;
  const currentSignoff = !!signoff && signoff.state_digest === digest(workspace.working) && signoff.decisions_digest === hash(records);
  if (records.length && !currentSignoff) warnings.push(signoff ? "Whole-pass self-review is stale after changes; reconsider the combined result before finalizing." : "Whole-pass self-review is missing; briefly assess the combined result against vision, fun and preferences before finalizing.");
  const reverted = revertedIds(records);
  const uniqueWarnings = [...new Set(warnings)];
  const decisions = records.map((record, index) => `${index + 1}. ${record.decision || "Unexplained refinement"}${reverted.has(record.id) ? " [reverted during review]" : ""}\n` + fields.filter((key) => key !== "decision").map((key) => `${key}: ${record[key] || "Not recorded"}`).join("\n")).join("\n\n");
  return { pass_id: workspace.refinement_pass_id ?? null, refinements: records.map((record) => ({ ...record, disposition: reverted.has(record.id) ? "reverted" : "retained" })), warnings: uniqueWarnings, current_digest: digest(workspace.working),
    self_review: signoff ? { ...signoff, current: currentSignoff } : null,
    brief: [decisions, currentSignoff ? `Overall review: ${signoff.assessment}` : "", uniqueWarnings.length ? "Review gaps: " + uniqueWarnings.join(" ") : ""].filter(Boolean).join("\n\n") };
}
