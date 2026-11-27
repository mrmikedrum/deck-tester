// The packet's layout verdict (packet.js): a clip whose beats held to the limits had nothing measured is never a pass.
//   node --test "tools/*.test.js"
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path");
const { audits, verdict } = require("./packet.js");

/** The verdict line of a track's audits (no stills on disk: no images are composed, so no browser is needed). */
async function last(audits_) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packet-test-"));
  try {
    const md = await audits(null, { viewport: [1180, 820], audits: audits_, frames: [] }, dir, dir);
    return md[md.length - 1];
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const piece = (pid, more = {}) => ({ role: "creature", pid, n: 1, names: ["Meloku"], pick: "unit", tapPx: 4000, tapSquare: 60, hidden: false, cover: { face: 0, name: 0, foot: 0, by: [] }, ...more });
const objects = { a: { face: 90 }, b: { face: 90 } };

test("beats held to the limits with no piece measured are NOT MEASURED, not a pass", async () => {
  // What every new-entry still recorded before: held to nothing, nothing measured.
  assert.match(await last([{ frame: 9, label: "start", gate: false, objects: {}, pieces: {} }, { frame: 20, label: "turn 3", gate: false, objects: {}, pieces: {} }]), /LAYOUT: NOT MEASURED/);
  // Held to the limits, but nothing measured there.
  assert.match(await last([{ frame: 9, label: "start", gate: true, objects: {}, pieces: {} }]), /LAYOUT: NOT MEASURED/);
  // Pieces measured, but under no seat the packet knows: nothing in any row.
  assert.match(await last([{ frame: 9, label: "start", gate: true, objects, pieces: { a: piece("You") } }]), /LAYOUT: NOT MEASURED/);
});

test("some beats measured and some not is INCOMPLETE", async () => {
  const v = await last([{ frame: 9, label: "start", gate: true, objects, pieces: { a: piece("you") } }, { frame: 20, label: "turn 3", gate: true, objects: {}, pieces: {} }]);
  assert.match(v, /LAYOUT: INCOMPLETE/);
});

test("measured and within the limits is a PASS; a breach is a FAIL", async () => {
  assert.match(await last([{ frame: 9, label: "start", gate: true, objects, pieces: { a: piece("you"), b: piece("ana") } }]), /LAYOUT: PASS\*\* \(1 beat measured\)/);
  assert.match(await last([{ frame: 9, label: "start", gate: true, objects, pieces: { a: piece("you", { tapSquare: 20 }) } }]), /LAYOUT: FAIL\*\* \(1 breaches/);
  // The stack set aside has its own row, held to the same limits.
  assert.match(await last([{ frame: 9, label: "start", gate: true, objects, pieces: { a: piece("stack", { role: "stack", cover: { face: 50, name: 0, foot: 0, by: ["b"] } }) } }]), /LAYOUT: FAIL/);
});

test("the verdict names what it counted", () => {
  assert.equal(verdict({ gated: 0, measured: 0, fails: 0 }), "**LAYOUT: NOT MEASURED** (no beat was held to the limits: this is not a pass)");
  assert.equal(verdict({ gated: 3, measured: 3, fails: 0 }), "**LAYOUT: PASS** (3 beats measured)");
});

test("labels: a label meeting another, or another unit's name strip, by more than 2 px, or under 11 px, breaks the limits", () => {
  const { labelRows } = require("./packet.js");
  const pieces = { a: { names: ["Beast"] }, b: { names: ["Elemental"] } };
  const ok = { pieces, labels: [{ id: "a", box: [0, 0, 50, 20], px: 13, name: "Beast" }, { id: "b", box: [49, 0, 99, 20], px: 12, name: "Elemental" }], strips: [{ id: "b", part: "name", box: [52, 21, 99, 30] }] };
  assert.equal(labelRows(ok).fails, 0);
  assert.equal(labelRows({ ...ok, labels: [ok.labels[0], { ...ok.labels[1], box: [40, 0, 90, 20] }] }).fails, 1);
  assert.equal(labelRows({ ...ok, strips: [{ id: "b", part: "name", box: [30, 10, 99, 30] }] }).fails, 1);
  assert.equal(labelRows({ ...ok, labels: [ok.labels[0], { ...ok.labels[1], px: 9 }] }).fails, 1);
  assert.equal(labelRows({ pieces }).measured, false);
});

test("labels: a labelled board whose labels were not measured is INCOMPLETE, never a pass; text is held to 11 px unrounded", async () => {
  const { labelRows } = require("./packet.js");
  const beat = { frame: 9, label: "the stack up", gate: true, objects, pieces: { a: piece("you"), b: piece("ana") }, stackUp: true, strips: [] };
  // The pieces were measured, but the board's labels were not: not a pass.
  assert.match(await last([{ ...beat, labelled: true }]), /LAYOUT: INCOMPLETE\*\* \(labels measured on 0 of 1 labelled beats/);
  // Measured on that board, they count; a board with no labels asks for none.
  const label = { id: "a", box: [0, 0, 50, 20], px: 12, name: "Meloku" };
  assert.match(await last([{ ...beat, labelled: true, labels: [label] }]), /LAYOUT: PASS/);
  assert.match(await last([{ ...beat, labelled: false, labels: [] }]), /LAYOUT: PASS/);
  // 10.96 px is under the floor, though it rounds to 11.0.
  assert.equal(labelRows({ pieces: {}, labels: [{ ...label, px: 10.96 }], strips: [] }).fails, 1);
  assert.match(await last([{ ...beat, labelled: true, labels: [{ ...label, px: 10.96 }] }]), /LAYOUT: FAIL/);
});

test("the creature floor holds a creature on show; one lying (tapped, in a pile, in the back band) meets the any-card floor", async () => {
  const at = (face, stands, pid = "you") => last([{ frame: 9, label: "start", gate: true, objects: { a: { face, stands } }, pieces: { a: piece(pid) } }]);
  // My creature: 72 standing, 44 lying; an opponent's: 56 standing.
  assert.match(await at(71, true), /LAYOUT: FAIL/);
  assert.match(await at(72, true), /LAYOUT: PASS/);
  assert.match(await at(58, false), /LAYOUT: PASS/);
  assert.match(await at(43, false), /LAYOUT: FAIL/);
  assert.match(await at(55, true, "bo"), /LAYOUT: FAIL/);
  assert.match(await at(51, false, "bo"), /LAYOUT: PASS/);
});

test("floors are design px, scaled by the design unit at another viewport", () => {
  const { floorFor, designUnit } = require("./packet.js");
  assert.equal(designUnit([1180, 820]), 1);
  assert.ok(Math.abs(designUnit([1210, 834]) - 834 / 820) < 1e-12);
  assert.ok(Math.abs(floorFor({ role: "creature", mine: true, stands: true }, designUnit([1210, 834])) - 72 * 834 / 820) < 1e-9);
  assert.equal(floorFor({ role: "creature", mine: false, stands: false }), 44);
  assert.equal(floorFor({ role: "support", mine: true, stands: true }), 44);
});
