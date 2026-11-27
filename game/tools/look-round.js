// Capture the same fixture moments on each revision. Output stays outside the source tree.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { audits } = require("./packet.js");

const GAME = path.resolve(__dirname, "..");
const TABLE = ["turn-4", "turn-9", "blocks-declared", "turn-15", "moment-swords", "spread-marath", "hand-focus"];
const CHROME = ["focus-opponent"];
const MOTION = ["creature", "combat"];

function run(file, args, env = process.env) {
  execFileSync(file, args, { cwd: GAME, env, stdio: "inherit" });
}

async function main() {
  const [round] = process.argv.slice(2);
  if (process.argv.length !== 3 || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(round ?? "")) {
    throw new Error("Usage: npm run look -- <round-name> (letters, digits, hyphens and underscores)");
  }
  const root = path.resolve(GAME, "../.deckmaster/look");
  const out = path.join(root, round), stillDir = path.join(out, "stills"), motionDir = path.join(out, "motion");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(out); // Preserve an existing round for comparison, even if it is incomplete.
  run("npm", ["run", "build"]);
  run(process.execPath, ["tools/combat-stills.js", stillDir, TABLE.join(","), "--audit"]);
  run(process.execPath, ["tools/chrome-stills.js", stillDir, CHROME.join(",")]);

  const measured = JSON.parse(fs.readFileSync(path.join(stillDir, "audit.json"), "utf8"));
  const [width, height] = measured.viewport;
  assert.deepEqual([width, height], [1210, 834]);
  const dpr = 2;
  const stills = [...TABLE, ...CHROME].map((name) => {
    const file = `stills/${name}.png`;
    const png = fs.readFileSync(path.join(out, file));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width * dpr, height * dpr], file);
    return file;
  });
  // Every still held to the limits must be measured; a missing row would otherwise drop out of the verdict.
  const gated = measured.audits.filter((a) => a.gate);
  for (const name of TABLE) assert.ok(measured.audits.some((a) => a.still === `${name}.png`), `${name}: no audit row`);
  assert.ok(gated.length > 0, "no still was held to the layout limits");
  const report = await audits(null, measured, stillDir, stillDir);
  assert.ok(!/NOT MEASURED|INCOMPLETE/.test(report.at(-1)), `layout: ${report.at(-1)}`);
  fs.writeFileSync(path.join(stillDir, "layout.md"), report.join("\n").trimStart() + "\n");

  // The recorder starts a local fixture server on an available port.
  const env = { ...process.env };
  delete env.BASE;
  run(process.execPath, ["tools/reel.js", motionDir, MOTION.join(","), "--motion-only", "--fps", "15", "--jobs", "1"], env);
  run(process.execPath, ["tools/packet.js", motionDir]);
  const clips = MOTION.map((name) => {
    const dir = path.join(motionDir, name);
    const track = JSON.parse(fs.readFileSync(path.join(dir, "track.json"), "utf8"));
    assert.equal(track.errors.length, 0, `${name}: ${track.errors.join(" | ")}`);
    const file = `motion/${name}/clip.mp4`;
    const video = fs.existsSync(path.join(out, file)) ? file : null;
    // The frames run to ~100 MB a round; the clip and its numbered sheets are the evidence.
    if (video) fs.rmSync(path.join(dir, "frames"), { recursive: true });
    return {
      name,
      about: track.about,
      fps: track.fps,
      viewport: track.viewport,
      review: `motion/${name}/review/packet.md`,
      ...(video ? { video } : { frames: `motion/${name}/frames` }),
    };
  });

  const manifest = { viewport: { width, height, dpr }, stills, layout: "stills/layout.md", measurements: "stills/audit.json", clips };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Packet: ${path.relative(path.dirname(GAME), out)} · ${report.at(-1).replaceAll("**", "")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
