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
