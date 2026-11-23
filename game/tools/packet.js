// Turn a recorded clip into a review packet a model can actually see: per beat, a sheet of whole-screen frames, a
// zoomed sheet per mat that moves, a trails image (every mat's outline per frame on one picture) and plain-words
// telemetry flags. Images are sized to survive a vision model's downscaling (≤ 1560 px wide, 3×3 tiles).
//   node tools/packet.js <reeldir>            (every clip in it)  ·  node tools/packet.js <reeldir>/<clip>
const fs = require("fs"), path = require("path");
const pw = require(process.env.PW || "playwright");

const arg = process.argv[2] || "reels/latest";
const clipDirs = fs.existsSync(path.join(arg, "track.json")) ? [arg] : fs.readdirSync(arg).map(d => path.join(arg, d)).filter(d => fs.existsSync(path.join(d, "track.json")));

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angle = q => Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]) * 180 / Math.PI;
const bboxOf = q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))];
const median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const SEAT = { you: "my mat (bottom)", ana: "left player's mat", bo: "across player's mat", cy: "right player's mat" };
const matName = k => SEAT[k.replace(/^floor/, "")] || k;

// ---- Telemetry: what each mat did, frame by frame, and the moments worth a look ------------------------------------
function analyse(track) {
  const F = track.frames, mats = [...new Set(F.flatMap(f => Object.keys(f.objects).filter(k => f.objects[k].role === "floor")))];
  const per = {};
  for (const k of mats) {
    const rows = F.map(f => f.objects[k] || null), ev = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]; if (!a || !b) { if (!!a !== !!b) ev.push({ frame: i, kind: b ? "appears" : "disappears" }); continue; }
      const move = Math.max(...a.quad.map((p, j) => dist(p, b.quad[j]))), prev = i > 1 && rows[i - 2] ? Math.max(...rows[i - 2].quad.map((p, j) => dist(p, a.quad[j]))) : 0;
      const next = i + 1 < rows.length && rows[i + 1] ? Math.max(...b.quad.map((p, j) => dist(p, rows[i + 1].quad[j]))) : 0;
      const turn = Math.abs(((angle(b.quad) - angle(a.quad)) + 540) % 360 - 180);
      b._move = move;
      if (move > 12 && move > 2.5 * Math.max(prev, next, 1)) ev.push({ frame: i, kind: "jump", detail: `outline moves ${move.toFixed(0)} px in one frame (${prev.toFixed(0)} px the frame before, ${next.toFixed(0)} px after)` });
      if (turn > 2.5) ev.push({ frame: i, kind: "turn", detail: `outline rotates ${turn.toFixed(1)}° in one frame` });
      if (a.tex !== b.tex) ev.push({ frame: i, kind: "retexture", detail: `surface image replaced (${a.texSize ? a.texSize.join("×") : "?"} → ${b.texSize ? b.texSize.join("×") : "?"})` });
      if (Math.abs(a.opacity - b.opacity) > 0.25) ev.push({ frame: i, kind: "fade-jump", detail: `opacity ${a.opacity} → ${b.opacity} in one frame` });
      if (Math.abs(a.shade - b.shade) > 0.25) ev.push({ frame: i, kind: "shade-jump", detail: `brightness ${a.shade} → ${b.shade} in one frame` });
      if (a.order !== b.order) ev.push({ frame: i, kind: "reorder", detail: `draw order ${a.order} → ${b.order}` });
    }
    // Surface vs image proportions: a texture drawn for one shape and shown on another is stretched.
    const stretch = rows.map(r => r && r.texSize ? (r.size[0] / r.size[1]) / (r.texSize[0] / r.texSize[1]) : 1);
    const worst = stretch.reduce((m, s, i) => (Math.abs(Math.log(s)) > Math.abs(Math.log(m.s)) ? { s, i } : m), { s: 1, i: 0 });
    per[k] = { rows, ev, stretch, worst };
  }
  // Mats that overlap one another on screen (a coarse check on their bounding boxes, reported only when it changes).
  const overlaps = [];
  for (let i = 0; i < F.length; i++) for (let a = 0; a < mats.length; a++) for (let b = a + 1; b < mats.length; b++) {
    const A = F[i].objects[mats[a]], B = F[i].objects[mats[b]]; if (!A || !B) continue;
    const x = bboxOf(A.quad), y = bboxOf(B.quad), w = Math.min(x[2], y[2]) - Math.max(x[0], y[0]), h = Math.min(x[3], y[3]) - Math.max(x[1], y[1]);
    if (w > 20 && h > 20) overlaps.push({ frame: i, pair: [mats[a], mats[b]], px: Math.round(w * h) });
  }
  // Cards and other pieces: where each one pops in or out at full size, or jumps, frame to frame.
  const keys = [...new Set(F.flatMap(f => Object.keys(f.objects).filter(k => f.objects[k].box)))], cards = {};
  const ctr = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], wid = b => b[2] - b[0];
  for (const k of keys) {
    const rows = F.map(f => f.objects[k] || null), ev = [], name = (rows.find(Boolean) || {}).name || k;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      if (!a && b && wid(b.box) > 30 && (b.fade || 0) < 0.5) ev.push({ frame: i, kind: "pops in", detail: `${name} appears at ${wid(b.box).toFixed(0)} px wide` });
      if (a && !b && wid(a.box) > 30 && (a.fade || 0) < 0.5) ev.push({ frame: i, kind: "leaves", detail: `${name} leaves the tracked board at ${wid(a.box).toFixed(0)} px wide (a card leaving may still fly to its pile untracked: check the frames)` });
      if (!a || !b) continue;
      const d = dist(ctr(a.box), ctr(b.box)), pa = i > 1 && rows[i - 2] ? dist(ctr(rows[i - 2].box), ctr(a.box)) : 0, nb = i + 1 < rows.length && rows[i + 1] ? dist(ctr(b.box), ctr(rows[i + 1].box)) : 0;
      b._move = d;
      if (d > 25 && d > 3 * Math.max(pa, nb, 2)) ev.push({ frame: i, kind: "jump", detail: `${name} moves ${d.toFixed(0)} px in one frame (${pa.toFixed(0)} before, ${nb.toFixed(0)} after)` });
    }
    cards[k] = { rows, ev, name };
  }
  return { mats, per, overlaps, cards };
}

// Frames to show for one beat: the motion window (from the beat until mats stop changing), nine samples across it,
// pulling in the frame before and the frame of every flagged event.
function windowFor(track, an, beat, nextBeat) {
  const last = Math.min(track.frames.length - 1, nextBeat - 1);
  let end = beat;
  for (const k of an.mats) an.per[k].rows.forEach((r, i) => { if (i > beat && i <= last && r && (r._move > 0.5 || an.per[k].ev.some(e => e.frame === i))) end = Math.max(end, i); });
  for (const k of Object.keys(an.cards)) an.cards[k].rows.forEach((r, i) => { if (i > beat && i <= last && (r ? r._move > 1.5 : an.cards[k].rows[i - 1])) end = Math.max(end, i); });
  end = Math.min(last, Math.max(end + 3, beat + 9));
  const start = Math.max(0, beat - 1), pick = new Set();
  for (let j = 0; j < 9; j++) pick.add(Math.round(start + (end - start) * j / 8));
  const flagged = [...an.mats.flatMap(k => an.per[k].ev), ...Object.values(an.cards).flatMap(c => c.ev)].filter(e => e.frame > start && e.frame <= end).map(e => e.frame).filter((f, i, a) => a.indexOf(f) === i).slice(0, 4);
  for (const f of flagged) {   // make sure the frames on each side of an event are both on the sheet
    for (const g of [f - 1, f]) if (!pick.has(g)) { const arr = [...pick].filter(x => !flagged.includes(x) && !flagged.includes(x + 1) && x !== start); const near = arr.sort((x, y) => Math.abs(x - g) - Math.abs(y - g))[0]; if (near != null) pick.delete(near); pick.add(g); }
  }
  return { start, end, frames: [...pick].sort((a, b) => a - b).slice(0, 9) };
}

async function compose(page, spec) {
  return page.evaluate(async spec => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const imgs = {}; for (const [k, v] of Object.entries(spec.images)) imgs[k] = await load(v);
    const cv = document.createElement("canvas"), x = cv.getContext("2d");
    const sc = Object.values(imgs)[0].naturalWidth / spec.vw;   // recordings may be at 2×; crops and outlines are in CSS px
    if (spec.kind === "crop") {
      const [cx, cy, cw, ch] = spec.crop.map(v => v * sc); cv.width = cw; cv.height = ch;
      x.drawImage(imgs.base, cx, cy, cw, ch, 0, 0, cw, ch);
      return cv.toDataURL("image/jpeg", 0.92);
    }
    if (spec.kind === "grid") {
      const [cx, cy, cw, ch] = spec.crop.map(v => v * sc), tw = 520, th = Math.round(tw * ch / cw), cols = 3, rows = Math.ceil(spec.frames.length / cols);
      cv.width = tw * cols + 8 * (cols - 1); cv.height = (th + 8) * rows; x.fillStyle = "#111"; x.fillRect(0, 0, cv.width, cv.height);
      spec.frames.forEach((f, i) => {
        const X = (i % cols) * (tw + 8), Y = Math.floor(i / cols) * (th + 8);
        x.drawImage(imgs[f.frame], cx, cy, cw, ch, X, Y, tw, th);
        x.fillStyle = "rgba(0,0,0,.75)"; x.fillRect(X, Y, 150, 24); x.fillStyle = "#fff"; x.font = "bold 15px monospace";
        x.fillText(`#${f.frame}  ${f.ms}ms${f.mark ? " " + f.mark : ""}`, X + 6, Y + 17);
      });
    } else {   // trails: the frame before the beat, dimmed, with every frame's mat outline over it, blue → red in time
      const base = imgs.base; cv.width = base.width / sc; cv.height = base.height / sc;
      x.drawImage(base, 0, 0, cv.width, cv.height); x.fillStyle = "rgba(0,0,0,.45)"; x.fillRect(0, 0, cv.width, cv.height);
      const n = spec.quads.length;
      spec.quads.forEach((fr, i) => {
        const hue = 220 - 220 * i / Math.max(1, n - 1);
        fr.forEach(q => { x.strokeStyle = `hsla(${hue},95%,60%,${i === 0 || i === n - 1 ? 1 : 0.55})`; x.lineWidth = i === 0 || i === n - 1 ? 3 : 1.2; x.beginPath(); q.forEach((p, j) => (j ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.stroke(); });
      });
      (spec.paths || []).forEach(pts => pts.forEach((p, i) => { const hue = 220 - 220 * i / Math.max(1, pts.length - 1); x.fillStyle = `hsl(${hue},95%,60%)`; x.beginPath(); x.arc(p[0], p[1], 3, 0, 7); x.fill(); if (i) { x.strokeStyle = `hsla(${hue},95%,60%,.6)`; x.lineWidth = 1.5; x.beginPath(); x.moveTo(pts[i - 1][0], pts[i - 1][1]); x.lineTo(p[0], p[1]); x.stroke(); } }));
      x.fillStyle = "rgba(0,0,0,.8)"; x.fillRect(0, cv.height - 30, 560, 30); x.fillStyle = "#fff"; x.font = "bold 15px monospace";
      x.fillText(`frames #${spec.from}–#${spec.to}: blue = first, red = last`, 8, cv.height - 10);
    }
    return cv.toDataURL("image/jpeg", 0.9);
  }, spec);
}

// ---- Layout audits: the hard limits in tools/look/intent.md, per stage and seat ------------------------------------
const FLOOR = { any: 44, oppCreature: 56, myCreature: 72, tap: 44, nameCover: 20, faceCover: 35 };   // cover: most % another piece or a panel may hide
const SEATNAME = { you: "Me", ana: "Marath (left)", bo: "Atraxa (across)", cy: "Dack (right)" };
async function audits(page, track, dir, out) {
  const [VW, VH] = track.viewport, md = ["", "## Layout audit (hard limits from tools/look/intent.md)", "",
    `Floors: any card or pile ${FLOOR.any} px wide, an opponent's creature ${FLOOR.oppCreature}, my creature ${FLOOR.myCreature}; every piece a ${FLOOR.tap}×${FLOOR.tap} pt patch the hit test gives it; nothing hidden; no card's name or stats strip more than ${FLOOR.nameCover}% or face more than ${FLOOR.faceCover}% covered by another piece or a panel.`, ""];
  let fails = 0;
  for (const a of track.audits) {
    const fr = a.objects ? { objects: a.objects } : track.frames[a.frame], tag = `stage-${String(a.frame).padStart(3, "0")}`;
    const still = path.join(dir, `still-${String(a.frame).padStart(3, "0")}.png`);
    md.push(`### #${a.frame}: ${a.label}`, "");
    if (fs.existsSync(still)) {
      const base = "data:image/png;base64," + fs.readFileSync(still).toString("base64");
      const whole = await compose(page, { kind: "crop", vw: VW, crop: [0, 0, VW, VH], images: { base } });
      fs.writeFileSync(path.join(out, tag + ".jpg"), Buffer.from(whole.split(",")[1], "base64")); md.push(`- **${tag}.jpg**: the whole table, full resolution`);
      for (const pid of ["you", "ana", "bo", "cy"]) {
        const fl = fr.objects["floor" + pid]; if (!fl) continue;
        const b = bboxOf(fl.quad), x0 = Math.max(0, b[0] - 20), y0 = Math.max(0, b[1] - 50), x1 = Math.min(VW, b[2] + 20), y1 = Math.min(VH, b[3] + 20);
        if (x1 - x0 < 60 || y1 - y0 < 60) continue;
        const url = await compose(page, { kind: "crop", vw: VW, crop: [x0, y0, x1 - x0, y1 - y0], images: { base } });
        fs.writeFileSync(path.join(out, `${tag}-${pid}.jpg`), Buffer.from(url.split(",")[1], "base64"));
        md.push(`- **${tag}-${pid}.jpg**: ${SEATNAME[pid]}'s page, full resolution`);
      }
    }
    if (!a.gate) { md.push("", "(a still only: not held to the limits)", ""); continue; }
    md.push("", "| seat | permanents | drawn alone | piles (cards) | hidden | smallest face px | too small | can't tap 44 pt | name or stats covered | face covered | creatures in mixed piles |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const pid of ["you", "ana", "bo", "cy"]) {
      const ps = Object.entries(a.pieces).filter(([, p]) => p.pid === pid && ["creature", "support", "mana", "commander"].includes(p.role) || (p.pid === pid && p.role === "card"));
      const all = Object.entries(a.pieces).filter(([, p]) => p.pid === pid && p.role !== "plate");
      const total = all.reduce((n, [, p]) => n + p.n, 0), alone = all.filter(([, p]) => p.n === 1 && !p.hidden).length;
      const piles = all.filter(([, p]) => p.n > 1 && !p.hidden), hidden = all.filter(([, p]) => p.hidden);
      const face = ([k]) => (fr.objects[k] || {}).face || 0;
      const floorOf = ([, p]) => p.role === "creature" ? (pid === "you" ? FLOOR.myCreature : FLOOR.oppCreature) : FLOOR.any;
      const small = all.filter(e => !e[1].hidden && face(e) && face(e) < floorOf(e));
      const untappable = all.filter(([, p]) => !p.hidden && p.tapSquare < FLOOR.tap);
      const who = w => (w.startsWith("panel:") ? "the " + w.slice(6) + " panel" : a.pieces[w] ? (a.pieces[w].names[0] || w) : w);
      const named = all.filter(([, p]) => p.cover && Math.max(p.cover.name, p.cover.foot || 0) > FLOOR.nameCover), faced = all.filter(([, p]) => p.cover && p.cover.face > FLOOR.faceCover);
      const coverList = (list, f) => (list.length ? "**" + list.length + "**: " + list.map(([k, p]) => `${(p.names[0] || "?")} ${f === "name" ? (p.cover.name >= (p.cover.foot || 0) ? "name " + p.cover.name : "stats " + p.cover.foot) : p.cover[f]}% by ${p.cover.by.map(who).join(", ")}`).join("; ") : 0);
      const faces = all.filter(e => !e[1].hidden && face(e)).map(face);
      const nm = ([, p]) => (p.names[0] || "?") + (p.n > 1 ? ` ×${p.n}` : "");
      // Mixed piles of creatures (unlike names), for the record: what folds first is judged by importance, not measured.
      const mixed = all.filter(([, p]) => p.role === "creature" && p.n > 1 && new Set(p.names).size > 1 && !p.hidden);
      const loneNon = all.filter(([, p]) => ["support", "mana"].includes(p.role) && p.n === 1 && !p.hidden);
      const early = mixed.length && loneNon.length ? mixed.length : 0;
      fails += hidden.reduce((n, [, p]) => n + p.n, 0) + small.length + untappable.length + named.length + faced.length;
      md.push(`| ${SEATNAME[pid]} | ${total} | ${alone} | ${piles.length} (${piles.reduce((n, [, p]) => n + p.n, 0)}) | ${hidden.length ? "**" + hidden.reduce((n, [, p]) => n + p.n, 0) + "**: " + hidden.map(nm).join(", ") : 0} | ${faces.length ? Math.round(Math.min(...faces)) : "-"} | ${small.length ? "**" + small.length + "**: " + small.map(e => nm(e) + " " + Math.round(face(e))).join(", ") : 0} | ${untappable.length ? "**" + untappable.length + "**: " + untappable.map(e => nm(e) + " " + e[1].tapSquare).join(", ") : 0} | ${coverList(named, "name")} | ${coverList(faced, "face")} | ${mixed.length ? mixed.reduce((n, [, p]) => n + p.n, 0) + " in " + mixed.length + (early ? " (" + loneNon.length + " lone noncreature" + (loneNon.length > 1 ? "s" : "") + " beside)" : "") : 0} |`);
    }
    md.push("");
  }
  md.push(fails ? `**LAYOUT: FAIL** (${fails} breaches of the hard limits)` : "**LAYOUT: PASS**");
  return md;
}

(async () => {
  const browser = await pw.chromium.launch(), page = await browser.newPage();
  for (const dir of clipDirs) {
    const track = JSON.parse(fs.readFileSync(path.join(dir, "track.json"))), an = analyse(track), out = path.join(dir, "review");
    fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
    const img = f => "data:image/jpeg;base64," + fs.readFileSync(path.join(dir, "frames", String(f).padStart(3, "0") + ".jpg")).toString("base64");
    const [VW, VH] = track.viewport, md = [`# ${track.clip}`, "", track.about, "", `${track.fps} fps, ${track.frames.length} frames. Images in this folder:`, ""];
    const beats = track.beats.length ? track.beats : [{ frame: 0, label: "start" }];
    for (let bi = 0; bi < beats.length; bi++) {
      const b = beats[bi], w = windowFor(track, an, b.frame, bi + 1 < beats.length ? beats[bi + 1].frame : track.frames.length), tag = `b${bi + 1}`;
      const marks = f => (f === b.frame ? "◆beat" : "");
      const frames = w.frames.map(f => ({ frame: f, ms: track.frames[f].ms, mark: marks(f) })), images = {}; w.frames.forEach(f => (images[f] = img(f)));
      const save = (name, url) => fs.writeFileSync(path.join(out, name), Buffer.from(url.split(",")[1], "base64"));
      save(`${tag}-screen.jpg`, await compose(page, { kind: "grid", vw: VW, crop: [0, 0, VW, VH], frames, images }));
      md.push(`- **${tag}-screen.jpg**: beat ${bi + 1} at #${b.frame} (${b.label}); whole screen, frames #${w.start}–#${w.end}`);
      const moving = an.mats.filter(k => an.per[k].rows.slice(w.start, w.end + 1).some((r, i, a) => r && (r._move > 0.5 || (i && a[i - 1] && (a[i - 1].tex !== r.tex || a[i - 1].shade !== r.shade || a[i - 1].opacity !== r.opacity)))));
      for (const k of moving) {
        const qs = an.per[k].rows.slice(w.start, w.end + 1).filter(Boolean).map(r => bboxOf(r.quad));
        let x0 = Math.max(0, Math.min(...qs.map(q => q[0])) - 30), y0 = Math.max(0, Math.min(...qs.map(q => q[1])) - 30), x1 = Math.min(VW, Math.max(...qs.map(q => q[2])) + 30), y1 = Math.min(VH, Math.max(...qs.map(q => q[3])) + 30);
        if (x1 - x0 < 200 || y1 - y0 < 140) continue;
        if (x1 - x0 > VW * 0.85 && y1 - y0 > VH * 0.85) continue;   // the whole screen already
        save(`${tag}-zoom-${k}.jpg`, await compose(page, { kind: "grid", vw: VW, crop: [x0, y0, x1 - x0, y1 - y0], frames, images }));
        md.push(`- **${tag}-zoom-${k}.jpg**: the same frames, zoomed on the ${matName(k)}`);
      }
      // The cards that moved, appeared or left in this window: one zoom over all of them, and their paths on the trails.
      const movers = Object.keys(an.cards).filter(k => { const r = an.cards[k].rows.slice(w.start, w.end + 1); return r.some(x => x && x._move > 1.5) || r.some(x => !x) && r.some(Boolean); });
      if (movers.length) {
        const bs = movers.flatMap(k => an.cards[k].rows.slice(w.start, w.end + 1).filter(Boolean).map(r => r.box));
        const x0 = Math.max(0, Math.min(...bs.map(b => b[0])) - 30), y0 = Math.max(0, Math.min(...bs.map(b => b[1])) - 30), x1 = Math.min(VW, Math.max(...bs.map(b => b[2])) + 30), y1 = Math.min(VH, Math.max(...bs.map(b => b[3])) + 30);
        if (x1 - x0 >= 160 && y1 - y0 >= 110 && !(x1 - x0 > VW * 0.85 && y1 - y0 > VH * 0.85)) {
          save(`${tag}-zoom-cards.jpg`, await compose(page, { kind: "grid", vw: VW, crop: [x0, y0, x1 - x0, y1 - y0], frames, images }));
          md.push(`- **${tag}-zoom-cards.jpg**: the same frames, zoomed on the cards that moved (${movers.slice(0, 8).map(k => an.cards[k].name).join(", ")}${movers.length > 8 ? ", …" : ""})`);
        }
      }
      const paths = movers.map(k => { const pts = []; for (let f = w.start; f <= w.end; f++) { const r = an.cards[k].rows[f]; if (r) pts.push([(r.box[0] + r.box[2]) / 2, (r.box[1] + r.box[3]) / 2]); } return pts; }).filter(p => p.length > 1);
      const quads = []; for (let f = w.start; f <= w.end; f++) quads.push(moving.map(k => track.frames[f].objects[k]).filter(Boolean).map(r => r.quad));
      if (moving.length || paths.length) { save(`${tag}-trails.jpg`, await compose(page, { kind: "trails", vw: VW, images: { base: img(w.start) }, quads, paths, from: w.start, to: w.end })); md.push(`- **${tag}-trails.jpg**: every frame #${w.start}–#${w.end} on one picture: outlines of mats that moved, and the path of each card that moved (dot per frame)`); }
    }
    md.push("", "## Telemetry (measured from the scene, per frame)", "");
    md.push("Beats: " + beats.map(b => `#${b.frame} ${b.label}`).join(" · "), "");
    for (const k of an.mats) {
      const p = an.per[k], s = p.worst;
      md.push(`**${matName(k)}** (\`${k}\`)`);
      if (Math.abs(Math.log(s.s)) > 0.03) md.push(`- surface vs its image's proportions: up to ${((s.s - 1) * 100).toFixed(0)}% off at #${s.i} (the image is drawn for one shape and shown on another)`);
      p.ev.forEach(e => md.push(`- #${e.frame} ${e.kind}${e.detail ? ": " + e.detail : ""}`));
      if (!p.ev.length && Math.abs(Math.log(s.s)) <= 0.03) md.push("- nothing flagged");
    }
    const cev = Object.values(an.cards).flatMap(c => c.ev).sort((a, b) => a.frame - b.frame);
    md.push("", "**Cards and pieces**");
    if (!cev.length) md.push("- nothing flagged");
    cev.slice(0, 40).forEach(e => md.push(`- #${e.frame} ${e.kind}: ${e.detail}`));
    if (cev.length > 40) md.push(`- … and ${cev.length - 40} more`);
    const ov = {}; an.overlaps.forEach(o => { const k = o.pair.join("+"); (ov[k] = ov[k] || []).push(o.frame); });
    Object.entries(ov).forEach(([k, fr]) => md.push(`- overlap on screen: ${k.split("+").map(matName).join(" and ")} at #${fr[0]}–#${fr[fr.length - 1]} (${fr.length} frames)`));
    if ((track.audits || []).length) md.push(...await audits(page, track, dir, out));
    if (track.errors.length) md.push("", "Page errors: " + track.errors.join(" | "));
    fs.writeFileSync(path.join(out, "packet.md"), md.join("\n") + "\n");
    console.log(dir + ": " + fs.readdirSync(out).length + " files");
  }
  await browser.close();
})();
