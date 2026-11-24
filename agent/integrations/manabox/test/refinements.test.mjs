import { test } from "node:test";
import assert from "node:assert/strict";
import { columns } from "../lib/schema.mjs";
import * as M from "../lib/model.mjs";
import { refine, recordRefinement, refinementReview, revertRefinement, finishRefinementPass, reviseRefinement, signOffRefinements } from "../lib/refinements.mjs";

function fixture() {
  const state = { uid: "test", tables: Object.fromEntries(Object.keys(columns).map((table) => [table, []])), untyped_tables: {} };
  const deck = M.createDeck(state, "Draft", { folder: "Claw" });
  const card = M.addCard(state, deck, 1, 2, 0, 1);
  card.dc_proxy_qty = 1;
  const tag = M.createTag(state, "ramp");
  M.tagCard(state, card, tag.id);
  const catalog = {
    lookup: (id) => ({ cv_id: id, c_name: id === 1 ? "Existing" : "New", cv_non_foil: 1, cv_foil: 1 }),
    resolve: (name) => ({ cv_id: name === "Existing" ? 1 : 2, c_name: name, cv_non_foil: 1 }),
  };
  return { state, deck, catalog };
}
const reasoning = { finding: "Early development is unreliable", decision: "Favor independent development", reason: "Works without a board", alternatives: "Keep conditional engines", tradeoffs: "Less late scaling", checks: "Color access still untested" };

test("notes-only review survives plan JSON serialization without a refinement pass", () => {
  const { state } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  state.tables.decks[0].d_notes = "Updated pitch";
  const review = refinementReview(workspace);
  assert.deepEqual(JSON.parse(JSON.stringify(review)), review);
  assert.equal(review.pass_id, null);
});

test("one decision supports bulk additions and board moves while preserving metadata", () => {
  const { state, deck, catalog } = fixture();
  const before = structuredClone(state);
  const decision = refine(state, catalog, { ...reasoning, actions: [
    { action: "move", deck: deck.id, card: "Existing", to: "side" },
    { action: "add", deck: deck.id, card: "New", quantity: 20 },
  ] });
  const moved = state.tables.deck_cards.find((card) => card.dc_cv_id === 1);
  assert.equal(moved.dc_foil, 1);
  assert.equal(moved.dc_proxy_qty, 1);
  assert.equal(state.tables.deck_card_tags_rel[0].dctr_dc_board_category, M.board("side"));
  assert.equal(state.tables.deck_cards.find((card) => card.dc_cv_id === 2).dc_quantity, 20);
  const workspace = { base: before, working: state };
  recordRefinement(workspace, before, state, decision);
  signOffRefinements(workspace, "The package preserves identity; colored access remains to be tested.");
  assert.deepEqual(refinementReview(workspace).warnings, []);
  assert.match(refinementReview(workspace).brief, /Color access still untested/);
});

test("missing reasoning and repeated tiny refinements warn without preventing edits", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  for (let index = 0; index < 21; index++) {
    const before = structuredClone(state);
    const decision = refine(state, catalog, { actions: [
      { action: "add", deck: deck.id, card: "New" },
      { action: "remove", deck: deck.id, card: "New" },
    ] });
    recordRefinement(workspace, before, state, decision);
  }
  const report = refinementReview(workspace);
  assert.equal(report.refinements.length, 21);
  assert(report.warnings.some((warning) => warning.includes("Missing finding")));
  assert(report.warnings.some((warning) => warning.includes("Consecutive")));
  assert(report.warnings.some((warning) => warning.includes("More than 20")));
});

test("out-of-band edits and changed cloud bases are visible, not blocked", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const decision = refine(state, catalog, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New" }] });
  recordRefinement(workspace, before, state, decision);
  state.tables.decks[0].d_notes = "New pitch";
  assert(refinementReview(workspace).warnings.some((warning) => warning.includes("not fully covered")));
  workspace.base.tables.decks[0].d_notes = "Phone edit";
  assert(refinementReview(workspace).warnings.some((warning) => warning.includes("cloud merges")));
});

test("ambiguous printing and malformed operations fail rather than silently changing metadata", () => {
  const { state, deck, catalog } = fixture();
  M.addCard(state, deck, 1, 1, 0, 0);
  assert.throws(() => refine(state, catalog, { actions: [{ action: "remove", deck: deck.id, card: "Existing" }] }), /Ambiguous/);
  assert.throws(() => refine(state, catalog, { actions: [{ action: "move", deck: deck.id, card: "New" }] }), /requires to/);
  assert.throws(() => refine(state, catalog, { actions: [], findings: "Typo" }), /Unknown refinement field/);
});

test("review can revert an earlier decision while preserving independent later changes", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const decision = refine(state, catalog, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New", quantity: 20 }] });
  const first = recordRefinement(workspace, before, state, decision);
  const middle = structuredClone(state);
  const later = refine(state, catalog, { ...reasoning, actions: [{ action: "move", deck: deck.id, card: "Existing", to: "side" }] });
  recordRefinement(workspace, middle, state, later);
  const beforeRevert = structuredClone(state);
  const reversal = revertRefinement(workspace, state, first.id, "The package compromises the theme");
  recordRefinement(workspace, beforeRevert, state, reversal);
  assert.equal(state.tables.deck_cards.some((card) => card.dc_cv_id === 2), false);
  assert.equal(state.tables.deck_cards[0].dc_board_category, M.board("side"));
  const report = refinementReview(workspace);
  assert.equal(report.refinements[0].disposition, "reverted");
  assert.match(report.brief, /compromises the theme/);
  finishRefinementPass(workspace, report, "test-receipt");
  finishRefinementPass(workspace, report, "test-receipt");
  assert.equal(workspace.refinement_history.length, 1);
  assert.deepEqual(workspace.refinement_history[0].deck_ids, [deck.id]);
  assert.equal(workspace.refinement_history[0].refinements.length, 3);
});

test("reversal refuses to erase later changes to the same card", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const decision = refine(state, catalog, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New" }] });
  const entry = recordRefinement(workspace, before, state, decision);
  refine(state, catalog, { actions: [{ action: "add", deck: deck.id, card: "New" }] });
  assert.throws(() => revertRefinement(workspace, state, entry.id, "Reconsidered"), /overlap/);
  assert.equal(state.tables.deck_cards.find((card) => card.dc_cv_id === 2).dc_quantity, 2);
});

test("packages span three decks, can be updated/deleted without review, and stale self-review is advisory", () => {
  const { state, deck, catalog } = fixture();
  const second = M.createDeck(state, "Second", { folder: "Claw" });
  const third = M.createDeck(state, "Third", { folder: "Claw" });
  let workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const input = { ...reasoning, actions: [deck, second, third].map((target) => ({ action: "add", deck: target.id, card: "New", quantity: 20 })) };
  const first = recordRefinement(workspace, before, state, refine(state, catalog, input));
  workspace = { ...workspace, ...reviseRefinement(workspace, catalog, first.id, { ...input, decision: "Use ten instead", actions: input.actions.map((action) => ({ ...action, quantity: 10 })) }) };
  assert.equal(workspace.working.tables.deck_cards.filter((card) => card.dc_cv_id === 2).length, 3);
  assert(workspace.working.tables.deck_cards.filter((card) => card.dc_cv_id === 2).every((card) => card.dc_quantity === 10));
  assert.equal(workspace.refinements.length, 1);
  assert.equal(workspace.refinements[0].id, first.id);
  signOffRefinements(workspace, "All three branches keep their identity with shared infrastructure.");
  assert.equal(refinementReview(workspace).self_review.current, true);
  const current = structuredClone(workspace.working);
  recordRefinement(workspace, current, workspace.working, refine(workspace.working, catalog, { ...reasoning, decks: [deck.id], actions: [] }));
  assert.equal(refinementReview(workspace).self_review.current, false);
  assert(refinementReview(workspace).warnings.some((warning) => warning.includes("self-review is stale")));
  workspace = { ...workspace, ...reviseRefinement(workspace, catalog, first.id, null) };
  assert.equal(workspace.refinements.length, 1);
  assert.equal(workspace.working.tables.deck_cards.some((card) => card.dc_cv_id === 2), false);
});

test("package replay preserves independent out-of-band edits and refuses dependent invalid replay", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const first = recordRefinement(workspace, before, state, refine(state, catalog, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New" }] }));
  state.tables.decks[0].d_notes = "Independent phone pitch";
  const revised = reviseRefinement(workspace, catalog, first.id, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New", quantity: 3 }] });
  assert.equal(revised.working.tables.decks[0].d_notes, "Independent phone pitch");
  const next = structuredClone(state);
  recordRefinement(workspace, next, state, refine(state, catalog, { ...reasoning, actions: [{ action: "move", deck: deck.id, card: "New", to: "side" }] }));
  assert.throws(() => reviseRefinement(workspace, catalog, first.id, null), /not found/);
  assert.equal(state.tables.deck_cards.find((card) => card.dc_cv_id === 2).dc_board_category, M.board("side"));
});

test("reconsidering a reversal correctly restores the original decision's disposition", () => {
  const { state, deck, catalog } = fixture();
  const workspace = { base: structuredClone(state), working: state };
  const before = structuredClone(state);
  const original = recordRefinement(workspace, before, state, refine(state, catalog, { ...reasoning, actions: [{ action: "add", deck: deck.id, card: "New" }] }));
  const middle = structuredClone(state);
  const reversal = recordRefinement(workspace, middle, state, revertRefinement(workspace, state, original.id, "Try without it"));
  const last = structuredClone(state);
  recordRefinement(workspace, last, state, revertRefinement(workspace, state, reversal.id, "Review supports restoring it"));
  assert.equal(refinementReview(workspace).refinements[0].disposition, "retained");
  assert.equal(refinementReview(workspace).refinements[1].disposition, "reverted");
  assert.equal(state.tables.deck_cards.find((card) => card.dc_cv_id === 2).dc_quantity, 1);
});
