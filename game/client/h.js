// Seat: the board from my chair. Three.js, a fixed camera, and a table that never turns.
//   I sit at the bottom; the three opponents are always in the same places: left, across and right.
//   Everything faces me. On each opponent's side their creatures stand at the front, nearest me; artifacts,
//   enchantments and planeswalkers sit behind; their lands are one pile. Cards size to how many there are.
//   Tap an opponent's side to lean in on it (still from my chair). In combat, fighters step into the middle.
(function () {
  const P = window.Proto, K = window.Kit, G = P.G, DB = window.CARDS;
  // A live game (live.js) fills these: it routes taps and drags to the decision at hand, marks options, runs the status.
  const H = window.SeatHooks = window.SeatHooks || {};
  const LIVE = !!window.SeatLive;
  let T = null, PP = null;                      // three.js and its postprocessing, once loaded
  let composer = null, bloom = null;

  // ---- Geometry (units: a card is 1 tall) ----------------------------------------------------------------
  const CW = 0.716, CH = 1, TH = 0.014;         // card width, height, thickness
  const SEATS = G.players.slice().sort((a, b) => a.seat - b.seat);
  // ---- Theme: the Grimoire ---------------------------------------------------------------------------------------
  // Seat colours say whose things are whose; the three signal colours say what you can do, and nothing else on the
  // table uses them (common.css mirrors these).
  // The Grimoire: the table is the open pages of a tome, each seat an illuminated page bound in oxidised bronze.
  // Signals are fire, gilt and blood: ember for what you can act on, gold leaf for what you chose, oxblood for danger.
  const THEME = {
    bg: 0x1a110a,
    wood: { base: "#2b1d12", light: "#3b2717", dark: "#130c07" },
    page: { base: "#cdbb92", mine: "#d8c7a0", lit: "#e4d4ae", theirs: "#c2af86", shade: "#8a7554", gutter: "#1a110a" },
    ink: "#1a120a", bone: "#e9d9b4", boneDim: "#b9a884",
    signal: { option: "#ff8a2a", selected: "#f1c86a", danger: "#ff3a3a" },
    dangerRim: "#c81e1e",                           // on a card's edge, danger is deep blood laid on, never a light: it must not bloom
    giltRim: "#e0a62c",                             // and chosen is gold leaf, deeper than the pale gilt of the halos, so it stands off a card's cream name strip
    seat: { you: "#4d7a6a", ana: "#6b2a3a", bo: "#2f4a7a", cy: "#8a6a3a" },
    // The same seats at full strength, for the pages' rules and the lanes. Marath is wine, never the scarlet of danger; mine
    // is deep teal, which holds on the tan page where a pale mint washes out.
    seatInk: { you: "#1f8a7a", ana: "#6b2a3a", bo: "#1f50b8", cy: "#a8921a" },
    bronze: "#8a6a3a", commander: "#f1c86a",
    standee: 0x3a2a18, cardEdge: 0x2a1f14, tokenEdge: 0x2a1f14,
  };
  const COLORS = THEME.seat;
  let actionable = new Set(G.actionable || []);

  // ---- Small helpers ------------------------------------------------------------------------------------------
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const lerp = (a, b, k) => a + (b - a) * k;
  const angLerp = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const whose = pid => (pid === P.ME ? "Your" : P.player(pid).name + "'s");
  // A name short enough to read across the table: no leading "The"; a long one loses its epithet ("Otawara, Soaring City",
  // "Meloku the Clouded Mirror", "Jace of the Ages" keep their first word).
  const shortName = c => {
    let n = P.name(c).replace(/^The /, "");
    if (n.length > 12) { n = n.split(", ")[0]; const m = n.match(/^(\S{3,}) (?:of )?the /); if (m) n = m[1]; }
    return n;
  };
  // A card's mana colours: from Scryfall when we have them, else read off its cost.
  function colorsOf(c) {
    if (!c) return [];
    const f = P.face(c) || {}, e = DB[c.card];
    const cols = (e && e.faces[0].colors) || f.colors;
    if (cols && cols.length) return cols;
    const m = ((f.cost || "") + (c._cost || "")).match(/[WUBRG]/g);
    return m ? [...new Set(m)] : [];
  }
  // The mana a source makes: Scryfall's `produces`, else its mana ability ({T}: Add {W}), else its basic land type.
  const BASIC = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G", Wastes: "C" };
  function manaOf(c) {
    const e = DB[c.card], f = P.face(c) || {};
    if (e && e.produces && e.produces.length) return e.produces;
    const add = ((f.text || "").match(/Add ([^.\n]*)/g) || []).join(" "), m = add.match(/\{([WUBRGC])\}/g);
    if (m) return [...new Set(m.map(t => t[1]))];
    if (/any colou?r/.test(add)) return ["W", "U", "B", "R", "G"];
    const b = Object.keys(BASIC).filter(k => new RegExp("\\b" + k + "\\b").test((c.card || "") + " " + P.typeLine(c)));
    return b.length ? b.map(k => BASIC[k]) : [];
  }
  // A well's colours: what its sources make, weighted, so a basin of Plains is white even beside a Treasure that could
  // be anything. A source of any colour shows its own colour (a Signet's silver, a Drum's), never a spray of all five; only a
  // land that truly makes two or three colours mixes them. The one or two strongest colours win.
  function wellColors(ids) {
    const w = {};
    ids.forEach(id => {
      const c = P.card(id); let ms = manaOf(c);
      if (ms.length >= 5) { const own = colorsOf(c); ms = own.length && own.length < 5 ? own : ["C"]; }
      ms.forEach(k => (w[k] = (w[k] || 0) + 1 / ms.length));
    });
    const ks = Object.keys(w).sort((a, b) => w[b] - w[a]);
    return ks.length ? ks.filter(k => w[k] >= w[ks[0]] * 0.5).slice(0, 2) : ["C"];
  }
  function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }

  // ---- Images and fonts ---------------------------------------------------------------------------------------
  // The world's textures, baked by tools/bake.js from world.js.
  const TEXS = { vellum: "img/tex/vellum.jpg", vellumN: "img/tex/vellum-n.png", tome: "img/tex/tome.jpg", tomeN: "img/tex/tome-n.png", bronze: "img/tex/bronze.jpg", bronzeN: "img/tex/bronze-n.png", bronzeR: "img/tex/bronze-r.png", bronzeClean: "img/tex/bronze-clean.jpg" };
  "WUBRGCMLT".split("").forEach(k => (TEXS["frame" + k] = "img/tex/frame-" + k + ".jpg"));
  function imgTex(key, repeat) { const t = new T.Texture(IMG[TEXS[key]]); t.colorSpace = key.endsWith("N") || key.endsWith("R") ? T.NoColorSpace : T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; if (repeat) t.repeat.set(repeat[0], repeat[1]); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.needsUpdate = true; return t; }
  const IMG = {};
  function loadImage(src) {
    if (!src || IMG[src]) return Promise.resolve();
    return new Promise(res => { const i = new Image(); i.onload = () => { IMG[src] = i; res(); }; i.onerror = () => res(); i.src = src; });
  }
  function preload() {
    const srcs = new Set(Object.values(G.cards).map(c => P.art(c)).filter(Boolean));
    Object.values(TEXS).forEach(t => srcs.add(t));
    const fonts = document.fonts ? Promise.all(['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '600 30px "Barlow"', '400 40px "IM Fell English"'].map(f => document.fonts.load(f))) : Promise.resolve();
    const timeout = new Promise(r => setTimeout(r, 3000));
    return Promise.all([Promise.race([fonts, timeout]), ...[...srcs].map(loadImage)]);
  }

  // ---- Card faces, drawn once per distinct look ---------------------------------------------------------------
  const FW = 336, FH = 468;
  const NUM = '"Barlow Condensed", "Arial Narrow", sans-serif';
  // A name is never smaller than `min` px on the face (52; 64 on the far pages, where a card is small on screen): one
  // line if it fits, else two; a word too long even then is drawn narrower (fillText's maxWidth), never smaller.
  function nameLines(x, text, maxW, min = 52) {
    for (let s = min + 10; s >= min; s -= 2) { x.font = `700 ${s}px ${NUM}`; if (x.measureText(text).width <= maxW) return { s, lines: [text] }; }
    const words = text.split(" ");
    const wrap = () => { const lines = []; let cur = ""; for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } } lines.push(cur); return lines; };
    for (let s = min + 4; s >= min; s -= 2) { x.font = `700 ${s}px ${NUM}`; const lines = wrap(); if (lines.length <= 2 && lines.every(l => x.measureText(l).width <= maxW)) return { s, lines }; }
    x.font = `700 ${min}px ${NUM}`; const lines = wrap();
    return { s: min, lines: lines.length <= 2 ? lines : [lines[0], lines.slice(1).join(" ")] };
  }
  function drawCover(x, img, X, Y, W, H) {
    const r = Math.max(W / img.width, H / img.height), w = img.width * r, h = img.height * r;
    x.drawImage(img, X + (W - w) / 2, Y + (H - h) / 2.6, w, h);
  }
  function pill(x, text, X, Y, bg, fg) {
    x.font = `700 26px ${NUM}`;
    const w = x.measureText(text).width + 22;
    rr(x, X, Y, w, 36, 6); x.fillStyle = bg; x.fill(); x.lineWidth = 2; x.strokeStyle = "rgba(20,10,0,.7)"; x.stroke();
    x.fillStyle = fg; x.textBaseline = "middle"; x.fillText(text, X + 11, Y + 19);
    return w;
  }
  function kwIcon(x, k, cx, cy, r) {
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = IMG[TEXS.bronzeClean] ? x.createPattern(IMG[TEXS.bronzeClean], "repeat") : THEME.bronze; x.fill();
    x.lineWidth = 2.5; x.strokeStyle = "rgba(20,10,0,.8)"; x.stroke();
    x.beginPath(); x.arc(cx, cy, r - 4, 0, Math.PI * 2); x.fillStyle = "#2a1f14"; x.fill();
    x.save(); x.translate(cx - r * 0.62, cy - r * 0.62); x.scale(r * 1.24 / 24, r * 1.24 / 24);
    x.fillStyle = "#fff"; x.fill(new Path2D(K.KW[k])); x.restore();
  }
  function gem(x, cx, cy, on) {
    x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4);
    if (on) { x.shadowColor = THEME.signal.option; x.shadowBlur = 18; }
    rr(x, -15, -15, 30, 30, 5); x.fillStyle = on ? THEME.signal.option : "#5c5850"; x.fill();
    x.lineWidth = 3; x.strokeStyle = on ? "#eafcff" : "#a39a8a"; x.stroke(); x.restore();
  }
  const PIP = { W: ["#f3edd2", "#3b3420"], U: ["#5fa4e8", "#0b1a2a"], B: ["#7b6c88", "#120c16"], R: ["#e2694f", "#2a0d06"], G: ["#4fae63", "#062010"], C: ["#c2c8d0", "#1a1d22"] };
  // Mana as its symbols, not letters: a sun, a drop, a skull, a flame, a tree, a diamond. SVG paths on a 24 box (live.css
  // draws the same ones for the HTML); the skull's eyes are holes (even-odd).
  const GLYPH = {
    W: "M12 2.6l1.5 4 3.8-1.9-1.9 3.8 4 1.5-4 1.5 1.9 3.8-3.8-1.9-1.5 4-1.5-4-3.8 1.9 1.9-3.8-4-1.5 4-1.5-1.9-3.8 3.8 1.9z",
    U: "M12 3C12 3 6.4 10.4 6.4 14.6a5.6 5.6 0 0 0 11.2 0C17.6 10.4 12 3 12 3z",
    B: "M12 3.4a7.2 7.2 0 0 0-7.2 7.2c0 2.6 1.3 4.3 2.9 5.3V19.6h8.6v-3.7c1.6-1 2.9-2.7 2.9-5.3A7.2 7.2 0 0 0 12 3.4zM7.4 11.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM12.8 11.2a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0zM12 13.4l-1.1 2.2h2.2z",
    R: "M12 2.4c.9 3.4 5.2 5.6 5.2 10.6a5.2 5.2 0 0 1-10.4 0c0-2.6 1.3-3.9 2.4-5.2.2 1.7 1 2.6 1.8 3C10.6 8 11.2 5 12 2.4z",
    G: "M12 2.8a4.1 4.1 0 0 0-4 3.3A3.7 3.7 0 0 0 5.8 12.8a3.7 3.7 0 0 0 4.3 3H11V21.2h2V15.8h.9a3.7 3.7 0 0 0 4.3-3 3.7 3.7 0 0 0-2.2-6.7A4.1 4.1 0 0 0 12 2.8z",
    C: "M12 3.6l6.2 8.4-6.2 8.4-6.2-8.4z",
  };
  function pip(x, m, cx, cy, r) {
    const [bg, fg] = PIP[m] || PIP.C;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = bg; x.fill(); x.lineWidth = 3; x.strokeStyle = "rgba(20,10,0,.7)"; x.stroke();
    x.save(); x.translate(cx - r * 0.78, cy - r * 0.78); x.scale(r * 1.56 / 24, r * 1.56 / 24); x.fillStyle = fg; x.fill(new Path2D(GLYPH[m] || GLYPH.C), "evenodd"); x.restore();
  }
  function shortType(c) {
    const t = P.typeLine(c), sub = (t.split("—")[1] || "").trim();
    if (/Aura|Equipment|Saga|Class|Vehicle/.test(sub)) return sub.split(" ")[0];
    return t.split("—")[0].replace("Legendary ", "").replace("Snow ", "").trim();
  }
  // A card's back: the tome's own leather, blind-tooled with a double rule, and a bronze rosette riveted at its heart.
  function drawBack(x) {
    const lea = IMG[TEXS.tome], brc = IMG[TEXS.bronzeClean];
    x.clearRect(0, 0, FW, FH);
    rr(x, 4, 4, FW - 8, FH - 8, 16); x.fillStyle = "#2a170c"; x.fill();
    x.save(); rr(x, 4, 4, FW - 8, FH - 8, 16); x.clip();
    if (lea) { x.globalAlpha = 0.55; x.drawImage(lea, 0, 0, FW * 1.6, FH * 1.6); x.globalAlpha = 1; }
    const sh = x.createRadialGradient(FW / 2, FH * 0.45, 30, FW / 2, FH / 2, FH * 0.62); sh.addColorStop(0, "rgba(120,70,30,.18)"); sh.addColorStop(1, "rgba(0,0,0,.55)");
    x.fillStyle = sh; x.fillRect(0, 0, FW, FH);
    x.restore();
    rr(x, 4, 4, FW - 8, FH - 8, 16); x.lineWidth = 3; x.strokeStyle = "rgba(10,5,2,.9)"; x.stroke();
    // Blind tooling: a pressed rule (dark) with its lit lip, twice.
    [[24, 10], [36, 7]].forEach(([o, r]) => {
      rr(x, o, o + 1.5, FW - 2 * o, FH - 2 * o, r); x.lineWidth = 2; x.strokeStyle = "rgba(255,210,150,.16)"; x.stroke();
      rr(x, o, o, FW - 2 * o, FH - 2 * o, r); x.lineWidth = 2.5; x.strokeStyle = "rgba(8,4,1,.7)"; x.stroke();
    });
    // The rosette: eight bronze petals round a domed boss.
    const cx = FW / 2, cy = FH / 2, metal = brc ? x.createPattern(brc, "repeat") : THEME.bronze;
    x.save(); x.translate(cx, cy);
    x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = 10; x.shadowOffsetY = 4;
    x.beginPath(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; x.moveTo(0, 0); x.ellipse(Math.cos(a) * 46, Math.sin(a) * 46, 40, 17, a, 0, Math.PI * 2); } x.fillStyle = metal; x.fill();
    x.shadowColor = "transparent";
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; x.beginPath(); x.ellipse(Math.cos(a) * 46, Math.sin(a) * 46, 40, 17, a, 0, Math.PI * 2); x.lineWidth = 2; x.strokeStyle = "rgba(30,16,4,.85)"; x.stroke(); x.beginPath(); x.moveTo(Math.cos(a) * 16, Math.sin(a) * 16); x.lineTo(Math.cos(a) * 76, Math.sin(a) * 76); x.lineWidth = 1.5; x.strokeStyle = "rgba(30,16,4,.5)"; x.stroke(); }
    const dome = x.createRadialGradient(-8, -9, 2, 0, 0, 26); dome.addColorStop(0, "#f6dca0"); dome.addColorStop(0.45, "#a8803e"); dome.addColorStop(1, "#3e2a10");
    x.beginPath(); x.arc(0, 0, 24, 0, Math.PI * 2); x.fillStyle = dome; x.fill(); x.lineWidth = 2.5; x.strokeStyle = "#1e1206"; x.stroke();
    const gl = x.createLinearGradient(0, -24, 0, 24); gl.addColorStop(0, "rgba(255,240,200,.35)"); gl.addColorStop(1, "rgba(0,0,0,.25)");
    x.beginPath(); x.arc(0, 0, 32, 0, Math.PI * 2); x.lineWidth = 3; x.strokeStyle = gl; x.stroke();
    x.restore();
    // Corner rivets.
    [[30, 30], [FW - 30, 30], [30, FH - 30], [FW - 30, FH - 30]].forEach(([rx, ry]) => { x.beginPath(); x.arc(rx, ry, 6, 0, Math.PI * 2); x.fillStyle = metal; x.fill(); x.lineWidth = 1.5; x.strokeStyle = "#1e1206"; x.stroke(); });
  }
  function drawFace(c, { tip } = {}) {
    const cv = document.createElement("canvas"); cv.width = FW; cv.height = FH;
    const x = cv.getContext("2d");
    if (c.faceDown) { drawBack(x); if (c.tapped) tapBadge(x, FW - 62, 70); return cv; }
    const f = P.face(c);
    const pat = key => (IMG[TEXS[key]] ? x.createPattern(IMG[TEXS[key]], "repeat") : K.frame(c));
    const cols = colorsOf(c), fk = c.token ? "T" : P.isLand(c) ? "L" : cols.length > 1 ? "M" : cols.length ? cols[0] : "C";
    const vellum = pat("vellum"), bronze = pat("bronzeClean");
    x.clearRect(0, 0, FW, FH);
    // One frame: matte card stock in the card's colour, a single dark edge, a soft shade toward the corners.
    rr(x, 4, 4, FW - 8, FH - 8, 16); x.fillStyle = pat("frame" + fk); x.fill();
    x.save(); rr(x, 4, 4, FW - 8, FH - 8, 16); x.clip();
    const vig = x.createRadialGradient(FW / 2, FH / 2, FW * 0.3, FW / 2, FH / 2, FH * 0.75); vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.28)");
    x.fillStyle = vig; x.fillRect(0, 0, FW, FH);
    if (c.token) { x.setLineDash([8, 6]); rr(x, 14, 14, FW - 28, FH - 28, 10); x.lineWidth = 2; x.strokeStyle = "rgba(60,40,15,.5)"; x.stroke(); x.setLineDash([]); }
    x.restore();
    rr(x, 4, 4, FW - 8, FH - 8, 16); x.lineWidth = 3; x.strokeStyle = fk === "B" ? "rgba(0,0,0,.9)" : "rgba(26,16,6,.85)"; x.stroke();
    if (c.commander) { rr(x, 10, 10, FW - 20, FH - 20, 12); x.lineWidth = 3; x.strokeStyle = THEME.commander; x.stroke(); }
    // Name: the card's identity, as large as the card allows. A card across the table (not mine) is small on screen, so its
    // name is larger still (72 px at the least) and its strip wider and taller, up to a third of the card, at the art's expense.
    const far = c.controller !== P.ME, nx = far ? 26 : 32, nW = FW - 2 * nx + 4;
    const nl = nameLines(x, shortName(c), nW, far ? 72 : 52);
    const barH = Math.min(far ? Math.round(FH / 3) : FH, nl.lines.length > 1 ? Math.round(nl.s * 1.94 + (far ? 14 : 10)) : Math.round(nl.s * 1.18 + (far ? 14 : 8)));
    // The name strip: parchment, ink. Legible first.
    rr(x, 22, 22, FW - 44, barH, 6); x.fillStyle = vellum; x.fill(); x.lineWidth = 2; x.strokeStyle = "rgba(26,16,6,.8)"; x.stroke();
    x.textBaseline = "middle"; x.font = `700 ${nl.s}px ${NUM}`; x.fillStyle = THEME.ink;
    nl.lines.forEach((l, i) => x.fillText(l, nx, 22 + barH / 2 + (i - (nl.lines.length - 1) / 2) * nl.s * 0.94 + 2, nW));
    // Art, with an ink line around it.
    const footH = 104, artY = 22 + barH + 6, artH = FH - 22 - footH - 6 - artY;
    rr(x, 22, artY, FW - 44, artH, 6); x.lineWidth = 2; x.strokeStyle = "rgba(26,16,6,.8)"; x.stroke();
    x.save(); rr(x, 23, artY + 1, FW - 46, artH - 2, 5); x.clip();
    const img = IMG[P.art(c)];
    if (img) drawCover(x, img, 20, artY, FW - 40, artH);
    else {                                           // no art (a card Scryfall lacks): its text instead
      x.fillStyle = "#2a2018"; x.fillRect(20, artY, FW - 40, artH);
      const words = ((f && f.text) || "").replace(/\([^)]*\)/g, "").split(/\s+/).filter(Boolean);
      x.font = `500 22px ${NUM}`; x.fillStyle = "#d9dee6"; x.textBaseline = "top";
      let line = "", y = artY + 12;
      for (const w of words) {
        const t = line ? line + " " + w : w;
        if (x.measureText(t).width > FW - 64 && line) { x.fillText(line, 32, y); y += 25; line = w; if (y > artY + artH - 30) { line += " …"; break; } }
        else line = t;
      }
      if (line && y <= artY + artH - 26) x.fillText(line, 32, y);
    }
    x.restore();
    let px = 28;
    const tags = [];
    if (c.copyOf) tags.push("Copy");
    if (c.transformed) tags.push("Transformed");
    if (c.goaded) tags.push("Goaded");
    if (c.becameLand) tags.push("Land now");
    tags.forEach(t => (px += pill(x, t, px, artY + 8, vellum, THEME.ink) + 6));
    if (c.owner !== c.controller) pill(x, whose(c.owner), 36, artY + artH - 44, COLORS[c.owner], "#f3e6c4");
    // Foot: what matters at a glance, on parchment.
    const fy = FH - 22 - footH, mid = fy + footH / 2;
    rr(x, 22, fy, FW - 44, footH, 6); x.fillStyle = vellum; x.fill(); x.lineWidth = 2; x.strokeStyle = "rgba(26,16,6,.8)"; x.stroke();
    // The foot is shared: numbers on the right, as wide as their text needs; keyword coins and the ability gem take only
    // what is left, at most two coins and then "+n", so nothing ever runs into the numbers.
    const right = FW - 30, isC = P.isCreature(c);
    let pt = null, ptW = 0;
    if (isC) {
      const b = P.basePT(c), pw = c.power != null ? c.power : b.power, tg = c.toughness != null ? c.toughness : b.toughness;
      x.font = `700 62px ${NUM}`;
      pt = { b, pw, tg, txt: `${pw}/${tg}` }; ptW = Math.max(110, x.measureText(pt.txt).width + 30);
    } else if (P.isPW(c)) ptW = 100;
    else if (P.isLand(c)) ptW = Math.min(5, manaOf(c).length) * 50;
    else { x.font = `600 36px ${NUM}`; ptW = x.measureText(shortType(c)).width; }
    const gemOn = f.abilities && !f.manaAbility && !c.becameLand, room = right - ptW - 14 - 30 - (gemOn ? 46 : 0);
    const kws = K.keywords(c), more = n => (kws.length > n ? 34 : 0);
    let nCoin = Math.min(2, kws.length);
    while (nCoin > 0 && nCoin * 52 + more(nCoin) > room) nCoin--;
    let lx = 54;
    kws.slice(0, nCoin).forEach(k => { kwIcon(x, k, lx, mid, 23); lx += 52; });
    if (kws.length > nCoin && room >= 34) { x.font = `700 30px ${NUM}`; x.fillStyle = THEME.ink; x.fillText("+" + (kws.length - nCoin), lx - 22, mid + 2); lx += 36; }
    if (gemOn) { gem(x, lx, mid, actionable.has(c.id)); lx += 46; }
    if (isC) {
      const { b, pw, tg, txt } = pt, w = ptW;
      x.font = `700 62px ${NUM}`;
      rr(x, right - w, fy + 12, w, footH - 24, 6); x.fillStyle = "rgba(26,16,6,.1)"; x.fill(); x.lineWidth = 2; x.strokeStyle = "rgba(26,16,6,.7)"; x.stroke();
      x.fillStyle = pw > b.power || tg > b.toughness ? "#1a6a30" : pw < b.power || tg < b.toughness ? "#9c1f24" : THEME.ink;
      x.textAlign = "center"; x.fillText(txt, right - w / 2, mid + 3); x.textAlign = "left";
    } else if (P.isPW(c)) {
      const loy = (c.counters && c.counters.LOYALTY) || f.loyalty;
      x.beginPath(); x.moveTo(right - 100, fy + 14); x.lineTo(right, fy + 14); x.lineTo(right, mid + 10); x.quadraticCurveTo(right - 50, fy + footH - 4, right - 100, mid + 10); x.closePath();
      x.fillStyle = "rgba(26,16,6,.1)"; x.fill(); x.lineWidth = 2; x.strokeStyle = "rgba(26,16,6,.7)"; x.stroke();
      x.font = `700 54px ${NUM}`; x.fillStyle = THEME.ink; x.textAlign = "center"; x.fillText(loy, right - 50, mid + 1); x.textAlign = "left";
    } else if (P.isLand(c)) {
      const pips = c.becameLand ? ["G"] : manaOf(c).slice(0, 5);
      let pxx = right - 22;
      pips.slice().reverse().forEach(m => { pip(x, m, pxx, mid, 22); pxx -= 50; });
    } else {
      x.font = `600 36px ${NUM}`; x.fillStyle = "#4a3a24"; x.textAlign = "right"; x.fillText(shortType(c), right, mid + 2); x.textAlign = "left";
    }
    if (tip) { x.font = `700 28px ${NUM}`; pill(x, tip, 36, fy - 46, COLORS[c.controller], "#f3e6c4"); }
    if (c.tapped) tapBadge(x, FW - 62, artY + 42);
    return cv;
  }
  // Tapped: the tap symbol on the art, so a tapped card reads as tapped even lying flat in a pile.
  function tapBadge(x, cx, cy) {
    x.save(); x.beginPath(); x.arc(cx, cy, 32, 0, Math.PI * 2); x.fillStyle = THEME.bone; x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 8; x.fill();
    x.shadowBlur = 0; x.lineWidth = 4; x.strokeStyle = THEME.ink; x.stroke();
    x.beginPath(); x.arc(cx, cy, 17, -Math.PI * 0.95, Math.PI * 0.35); x.lineWidth = 7; x.stroke();
    const ex = cx + 17 * Math.cos(Math.PI * 0.35), ey = cy + 17 * Math.sin(Math.PI * 0.35);
    x.beginPath(); x.moveTo(ex + 11, ey - 3); x.lineTo(ex - 2, ey + 11); x.lineTo(ex - 6, ey - 8); x.closePath(); x.fillStyle = THEME.ink; x.fill();
    x.restore();
  }

  // ---- three.js scene ---------------------------------------------------------------------------------------
  let renderer, scene, cam, raycaster, root = null, stageEl, overlay, running = false;
  const GEO = {}, MAT = {}, TEX = {};
  const picks = [];                               // meshes that answer taps
  const halos = [];

  function texFrom(canvas) {
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function faceKey(c) { return [c.card, !!IMG[P.art(c)], c.faceDown, c.token, c.power, c.toughness, (c.keywords || []).join(), c.copyOf, c.transformed, c.goaded, c.becameLand, c.landName, c.commander, c.tapped, c.controller !== P.ME, actionable.has(c.id), c.owner !== c.controller && c.owner, JSON.stringify(c.counters || {})].join("|"); }
  function faceTex(c) { const k = faceKey(c); return TEX[k] || (TEX[k] = texFrom(drawFace(c))); }

  // A material for card faces: unlit so every seat reads the same. Two looks: "tap" shades a tapped card but keeps
  // its colour; "dim" greys out what's in the background (out of focus, leaving the table).
  function faceMat(tex, dim) {
    const m = new T.MeshBasicMaterial({ map: tex });
    m.userData.dim = { value: dim ? 1 : 0 };
    m.userData.tap = { value: 0 };
    m.userData.rim = { value: new T.Color(0, 0, 0) };           // a signal: the frame's edge burns in this colour
    m.userData.rimW = { value: 0.028 };                           // and this wide: chosen is a broad gilt border (0.072, three embers) inked round its outside, danger a narrower band of blood (0.04)
    m.toneMapped = false;
    m.onBeforeCompile = sh => {
      sh.uniforms.dim = m.userData.dim; sh.uniforms.tap = m.userData.tap; sh.uniforms.rim = m.userData.rim; sh.uniforms.rimW = m.userData.rimW; sh.uniforms.uTime = RIM.time;
      sh.fragmentShader = "uniform float dim;\nuniform float tap;\nuniform vec3 rim;\nuniform float rimW;\nuniform float uTime;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\nfloat g_ = dot(diffuseColor.rgb, vec3(.299,.587,.114));\n" +
        "diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(g_), diffuseColor.rgb, .5) * vec3(.5,.5,.56), tap);\n" +
        "diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g_) * .42, dim * .88);\n" +
        "float e_ = min(min(vMapUv.x, 1.0 - vMapUv.x) * 1.4, min(vMapUv.y, 1.0 - vMapUv.y));\n" +
        "float flick_ = 0.85 + 0.15 * sin(uTime * 7.0 + vMapUv.y * 20.0) * sin(uTime * 3.1 + vMapUv.x * 17.0);\n" +
        "float sel_ = step(0.039, rimW);\n" +
        "float band_ = smoothstep(rimW, rimW - 0.005, e_);\n" +
        "diffuseColor.rgb = mix(diffuseColor.rgb, rim, band_ * sel_);\n" +
        "diffuseColor.rgb *= 1.0 - 0.7 * sel_ * smoothstep(rimW + 0.009, rimW + 0.004, e_) * smoothstep(rimW - 0.003, rimW + 0.002, e_);\n" +
        "diffuseColor.rgb += rim * smoothstep(mix(rimW, 0.03, sel_), 0.0, e_) * flick_ * mix(2.2, 0.3, sel_);\n" +
        "diffuseColor.rgb *= 1.0 - 0.85 * step(0.06, rimW) * smoothstep(0.012, 0.008, e_);");
    };
    return m;
  }

  // Rims: what the signals do to a card's edge. Shared uniforms, so every lit card breathes together.
  const RIM = { time: { value: 0 } };
  function buildGeometry() {
    ["option", "selected", "danger"].forEach(k => (RIM[k] = new T.Color(k === "danger" ? THEME.dangerRim : k === "selected" ? THEME.giltRim : THEME.signal[k])));
    const r = 0.045, w = CW, h = CH, sh = new T.Shape();
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2);
    sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const face = new T.ShapeGeometry(sh, 4);
    const uv = face.attributes.uv, pos = face.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
    GEO.face = face;
    GEO.edge = new T.ExtrudeGeometry(sh, { depth: TH, bevelEnabled: false, curveSegments: 4 });
    GEO.edge.translate(0, 0, -TH / 2);
    GEO.base = new T.BoxGeometry(CW * 0.5, 0.05, 0.2);
    GEO.stripe = new T.BoxGeometry(0.001, 0.001, 0.001);
    GEO.chip = new T.CylinderGeometry(0.16, 0.16, 0.06, 28);
    GEO.chipTop = new T.CircleGeometry(0.16, 28);
    GEO.halo = new T.PlaneGeometry(CW * 1.62, CH * 1.46);
    MAT.hidden = new T.MeshBasicMaterial({ visible: false });
    MAT.edge = new T.MeshStandardMaterial({ color: THEME.cardEdge, roughness: 0.8 });
    MAT.bronze = new T.MeshStandardMaterial({ map: imgTex("bronze", [1, 1]), normalMap: imgTex("bronzeN", [1, 1]), roughnessMap: imgTex("bronzeR", [1, 1]), metalness: 0.75, roughness: 0.6 });
    MAT.edgeDark = new T.MeshStandardMaterial({ color: THEME.tokenEdge, roughness: 0.7 });
    const back = document.createElement("canvas"); back.width = FW; back.height = FH; drawBack(back.getContext("2d"));
    MAT.back = new T.MeshBasicMaterial({ map: texFrom(back) });
    MAT.base = MAT.bronze;
    MAT.chip = new T.MeshStandardMaterial({ color: THEME.bronze, metalness: 0.6, roughness: 0.5 });
    // Halos: each state has its own shape as well as its colour, so it reads without colour too.
    const halo = (kind, col) => new T.MeshBasicMaterial({ map: texFrom(haloCanvas(kind)), color: new T.Color(col), transparent: true, blending: T.AdditiveBlending, depthWrite: false });
    MAT.halo = halo("option", THEME.signal.option);
    MAT.haloSel = halo("selected", THEME.signal.selected);
    MAT.haloRed = halo("danger", THEME.signal.danger);
    const dc = document.createElement("canvas"); dc.width = 160; dc.height = 200;
    const dx = dc.getContext("2d"); dx.shadowColor = "rgba(0,0,0,1)"; dx.shadowBlur = 24; dx.fillStyle = "#000"; rr(dx, 30, 30, 100, 140, 10); dx.fill();
    MAT.drop = new T.MeshBasicMaterial({ map: texFrom(dc), transparent: true, opacity: 0.75, depthWrite: false });
    // A standee's shadow: a soft card-shaped shade, darkest along the foot where the card meets the page, fading toward
    // where its top hangs over. The card covers its middle, so the shade is full right out to the card's outline (24..104,
    // 24..168 here) and softens only beyond it: what shows past the card is its darkest edge, never a hard one.
    const sc = document.createElement("canvas"); sc.width = 128; sc.height = 192;
    const sx = sc.getContext("2d"); sx.shadowColor = "#000"; sx.shadowBlur = 12; sx.fillStyle = "#000";
    rr(sx, 20, 20, 88, 152, 12); sx.fill();
    const fall = sx.createLinearGradient(0, 192, 0, 0); fall.addColorStop(0, "rgba(0,0,0,1)"); fall.addColorStop(0.3, "rgba(0,0,0,.85)"); fall.addColorStop(1, "rgba(0,0,0,.45)");
    sx.shadowColor = "transparent"; sx.globalCompositeOperation = "destination-in"; sx.fillStyle = fall; sx.fillRect(0, 0, 128, 192);
    TEX.shade = texFrom(sc);
    // A page's shadow on the table while it is held up: its shape, soft all round.
    const pg = document.createElement("canvas"); pg.width = pg.height = 256;
    const px = pg.getContext("2d"); px.shadowColor = "#000"; px.shadowBlur = 28; px.fillStyle = "#000"; px.fillRect(40, 40, 176, 176);
    TEX.pageShade = texFrom(pg);
  }
  // Where the table's light comes from (buildScene's sun): a shadow falls away from it, by this much per unit of height.
  const SUN = { x: -4, y: 20, z: 12 }, SHEAR = { x: -SUN.x / SUN.y, z: -SUN.z / SUN.y };
  // The shadow of a standing card leaning back by `lean`: the card cast onto the page by the sun, so it runs back and to the
  // right of the foot, a sheared card shape. The card faces me and hides most of it; what shows is its edge.
  function standeeShadow(tapped, lean) {
    const w = tapped ? CH : CW, y0 = tapped ? CH / 2 - CW / 2 : 0, y1 = tapped ? CH / 2 + CW / 2 : CH;
    const cast = y => ({ x: y * Math.cos(lean) * SHEAR.x, z: -y * Math.sin(lean) + y * Math.cos(lean) * SHEAR.z });
    const near = cast(y0), far = cast(y1), len = near.z - far.z, geo = new T.PlaneGeometry(w * 128 / 80, len * 192 / 144);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) + pos.getY(i) / len * (far.x - near.x));
    const m = new T.Mesh(geo, new T.MeshBasicMaterial({ map: TEX.shade, color: 0x2a1806, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 0; m.userData.noPick = true;
    m.position.set((near.x + far.x) / 2, 0.006, (near.z + far.z) / 2);
    return m;
  }
  // A halo, drawn white and tinted by its material, on a canvas laid out like GEO.halo around a card.
  //   option: a soft ring that breathes. selected: a thick, steady band. danger: a ring inside target brackets.
  function haloCanvas(kind) {
    const cv = document.createElement("canvas"); cv.width = 240; cv.height = 300;
    const g = cv.getContext("2d"), X = 39, Y = 39, W = 162, Hh = 222;
    g.strokeStyle = g.shadowColor = g.fillStyle = "#fff";
    if (kind === "selected") {
      g.shadowBlur = 26; g.lineWidth = 24; rr(g, X - 2, Y - 2, W + 4, Hh + 4, 20); g.stroke(); g.stroke();
    } else if (kind === "danger") {
      g.shadowBlur = 22; g.lineWidth = 15; rr(g, X, Y, W, Hh, 16); g.stroke(); g.stroke();
      g.shadowBlur = 10; g.lineWidth = 12; g.lineCap = "round";
      const o = 22, L = 40;
      [[X - o, Y - o, 1, 1], [X + W + o, Y - o, -1, 1], [X - o, Y + Hh + o, 1, -1], [X + W + o, Y + Hh + o, -1, -1]].forEach(([x, y, dx, dy]) => {
        g.beginPath(); g.moveTo(x, y + dy * L); g.lineTo(x, y); g.lineTo(x + dx * L, y); g.stroke();
      });
    } else {
      g.shadowBlur = 28; g.lineWidth = 16; rr(g, X, Y, W, Hh, 18); g.stroke(); g.stroke();
    }
    return cv;
  }

  // One card: a thin box with its face on +Z, centred on the origin, 1 tall.
  function cardMesh(c, { dim = false, back = false } = {}) {
    const grp = new T.Group();
    const edge = new T.Mesh(GEO.edge, [MAT.hidden, c && c.token ? MAT.edgeDark : MAT.edge]);
    edge.castShadow = true;
    const front = new T.Mesh(GEO.face, back || !c ? MAT.back : faceMat(faceTex(c), dim));
    if (c && !back) front.material.userData.tapped = !!c.tapped;
    front.position.z = TH / 2 + 0.0008;
    const rear = new T.Mesh(GEO.face, MAT.back);
    rear.position.z = -TH / 2 - 0.0008; rear.rotation.y = Math.PI;
    // Keep tap orientation inside the pose group: layout/flight/sift can face the card
    // toward the camera without undoing its full clockwise quarter-turn.
    const body = new T.Group();
    body.rotation.z = c && c.tapped ? -Math.PI / 2 : 0;
    body.add(edge, front, rear);
    grp.add(body);
    grp.userData.cardBody = body;
    grp.userData.front = front;
    return grp;
  }
  function pickable(obj, pick) { obj.userData.pick = pick; obj.traverse(o => { if (o.isMesh) picks.push(o); }); return obj; }
  function haloFor(parent, flat, kind = "option") {
    const col = RIM[kind] || RIM.option;
    const w = kind === "selected" ? 0.072 : kind === "danger" ? 0.04 : 0.024;   // chosen: a gilt band three embers wide, crisp and unlit, a line of ink round it; danger: a narrower band of blood, darkening and deepening with a heartbeat but never lit
    facesOf(parent).forEach(m => { m.userData.rim.value.copy(col); m.userData.rimKind = kind; m.userData.rimW.value = w; });
  }
  // Every chip is the same token: a bronze rim round a vellum face, the number in ink. Only the ink changes: green for
  // +1/+1, the counter's kind written under its number.
  function chipTex(text, fg, sub) {
    const k = "chip|" + text + fg + sub;
    if (TEX[k]) return TEX[k];
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fillStyle = IMG[TEXS.bronzeClean] ? x.createPattern(IMG[TEXS.bronzeClean], "repeat") : THEME.bronze; x.fill();
    x.lineWidth = 3; x.strokeStyle = "rgba(20,10,0,.9)"; x.stroke();
    x.beginPath(); x.arc(64, 64, 50, 0, Math.PI * 2); x.fillStyle = IMG[TEXS.vellum] ? x.createPattern(IMG[TEXS.vellum], "repeat") : THEME.bone; x.fill(); x.lineWidth = 2.5; x.strokeStyle = "rgba(20,10,0,.75)"; x.stroke();
    const sh = x.createRadialGradient(50, 46, 4, 64, 64, 54); sh.addColorStop(0, "rgba(255,250,230,.25)"); sh.addColorStop(1, "rgba(60,35,10,.25)"); x.fillStyle = sh; x.fill();
    x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `700 ${sub ? 54 : 62}px ${NUM}`; x.fillText(text, 64, sub ? 54 : 68);
    if (sub) { x.font = `700 24px ${NUM}`; x.fillText(sub, 64, 96); }
    return (TEX[k] = texFrom(cv));
  }
  // A chip: counters and pile counts. It sits on the card's face, at the foot corner above its numbers, so it is always
  // the card's own and never out on the page.
  function chip(text, fg = THEME.ink, sub) {
    const g = new T.Group();
    const body = new T.Mesh(GEO.chip, MAT.chip);
    const top = new T.Mesh(GEO.chipTop, new T.MeshBasicMaterial({ map: chipTex(text, fg, sub) }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.031;
    g.add(body, top); g.userData.noPick = true;
    return g;
  }
  const CTR = { P1P1: ["#14602c"], CHARGE: [THEME.ink, "charge"], LORE: [THEME.ink, "lore"], STORY: [THEME.ink, "story"], LUCK: [THEME.ink, "luck"], INDESTRUCTIBLE: [THEME.ink, "indestr."] };
  function counterChips(c) {
    return Object.entries(c.counters || {}).filter(([k]) => k !== "LOYALTY").map(([k, v]) => {
      const [fg, sub] = CTR[k] || [THEME.ink, k.toLowerCase()];
      return chip(k === "P1P1" ? "+" + v : String(v), fg, sub);
    });
  }
  // Lay a card's chips on its face: from the right, just above the foot, stepping left. `extra` adds a count chip.
  function chipsOn(card, c, extra) {
    const all = counterChips(c); if (extra) all.push(chip(extra));
    all.forEach((ch, i) => { ch.rotation.x = Math.PI / 2; ch.scale.setScalar(0.8); ch.position.set(CW / 2 - 0.12 - i * 0.27, -CH / 2 + 0.34, TH / 2 + 0.03); (card.userData.cardBody || card).add(ch); });
  }


  // A zone pile: the graveyard or exile, face up, as tall as it is deep.
  // A pile lying on its page. Far off, a card lying flat is a sliver: an opponent's pile is propped up toward me from its
  // near edge (`lean`, PILE_LEAN), like their other noncreatures, so its top card and count read across the table.
  const PILE_LEAN = 0.8;
  // Its sign above it, "Graveyard 8". It shows only the cards that have landed on it (`arrive`): one still on its way
  // isn't on top, or counted, or in its sift, until it gets there (`landed`).
  function zonePile(pid, zone, ids, due = new Set()) {
    const grp = pickable(new T.Group(), { type: "zone", pid, zone }), word = zone === "graveyard" ? "Graveyard" : "Exile";
    let built = false;                              // the first showing is registered by the board build; every later one here
    const show = () => {
      const now = ids.filter(id => !due.has(id)), old = grp.children[0];
      if (old) { grp.remove(old); old.traverse(o => { const i = picks.indexOf(o); if (i >= 0) picks.splice(i, 1); }); dispose(old); }
      if (now.length) {
        const lean = zoneLean(pid, zone, now), g = tagSign(`${word} ${now.length}`, COLORS[pid]);
        // Above the pile, however tall, on its lower half (theirs propped up: over its art), so the top card's name reads
        // above it; narrow enough that the two signs side by side never meet. Both signs take the size the longer word fits
        // at (a two-digit "Graveyard"), so their counts read alike.
        const w = Math.max(signTex("Graveyard 00", COLORS[pid]).image.width * SIGN_U, g.userData.w);
        g.rotation.x = -Math.PI / 2 + 0.5; g.scale.setScalar(Math.min(1, (CW + 0.3) / w)); g.position.set(0, now.length * 0.0075 + 0.06, pid === P.ME ? 0.3 : 0.12); lean.userData.body.add(g);
        grp.add(lean);
        if (built) lean.traverse(o => o.isMesh && !o.userData.noPick && picks.push(o));
      }
      if (built) { grp.userData.faces = facesOf(grp); grp.userData.faces.forEach(m => (m.userData.dim.value = grp.userData.fade || 0)); }
    };
    show(); built = true;
    grp.userData.arrive = id => { if (due.delete(id)) show(); };
    grp.userData.landed = () => ids.filter(id => !due.has(id));
    return grp;
  }
  function zoneLean(pid, zone, ids) {
    const n = ids.length, lean = new T.Group(), body = new T.Group();
    lean.position.z = CH / 2; lean.rotation.x = pid === P.ME ? 0 : PILE_LEAN; body.position.z = -CH / 2;
    lean.add(body); lean.userData.body = body;
    const h = Math.max(0.004, n * 0.0075);
    const box = new T.Mesh(new T.BoxGeometry(CW, h, CH), [MAT.edge, MAT.edge, MAT.hidden, MAT.edge, MAT.edge, MAT.edge]);
    box.position.y = h / 2; box.castShadow = true; box.receiveShadow = true;
    body.add(box);
    if (n) {
      const topCard = cardMesh(P.card(ids[ids.length - 1]));
      topCard.rotation.x = -Math.PI / 2; topCard.position.y = h + TH / 2;
      if (zone === "exile") topCard.rotation.z = 0.12;
      body.add(topCard);
    }
    return lean;
  }


  // ---- Pieces --------------------------------------------------------------------------------------------------------
  // Every piece is a group whose pose (position, turn toward the camera, scale, dimness) the layout sets. Standees keep
  // a pivot that leans them back to face the camera; flat cards keep a tilt node that props them up a little.
  function facesOf(obj) { const out = []; obj.traverse(o => o.isMesh && o.material && o.material.userData && o.material.userData.dim && out.push(o.material)); return out; }
  // A pile of different cards (folded, `title` "Beast 9", "Tokens 12", "Creatures 31") is the first of them standing with
  // the rest behind it, its title on a tag over the name strip; a pile of copies too ("Beast 2"). Behind a
  // pile of unlike cards stand others of its kinds, fanned out a little to the side, so it reads as mixed at a glance.
  // One card of each name among `ids`, the most numerous first (ties in the order they came), each lying as most of the
  // pile does: a pile mostly ready never shows a tapped card in front (the front is the most numerous kind that has one
  // lying that way).
  function kindsOf(ids) {
    const cs = ids.map(id => P.card(id)).filter(Boolean), tapped = cs.filter(x => x.tapped).length * 2 > cs.length, by = new Map();
    cs.forEach(x => by.set(x.card, (by.get(x.card) || []).concat([x])));
    const gs = [...by.values()].sort((a, b) => b.length - a.length), lies = g => g.find(x => !!x.tapped === tapped), f = gs.findIndex(lies);
    if (f > 0) gs.unshift(gs.splice(f, 1)[0]);
    return gs.map(g => lies(g) || g[0]);
  }
  function standee(c, ids, title) {
    const grp = new T.Group(), copies = ids.length;
    const kinds = title ? kindsOf(ids).filter(x => x.card !== c.card) : [];
    grp.userData.pivots = [];
    for (let i = Math.min(copies, 3) - 1; i >= 0; i--) {
      const fan = i && kinds[i - 1];
      const cardOf = fan ? { ...fan, tapped: c.tapped } : c;   // turned as the top card lies
      const one = new T.Group();
      const base = new T.Group();                                   // no foot: the card stands in the ash it made, on its shadow
      if (i === 0) { SeatFX.ash(one, { r: CW * 1.7, seed: c.id }); one.add(standeeShadow(!!c.tapped, PITCH + (c.tapped ? TAP_LEAN : 0))); }
      const stripe = new T.Mesh(GEO.stripe, MAT["seat_" + c.controller]); stripe.position.set(0, 0.06, 0.171);
      const pivot = new T.Group(); pivot.position.y = 0.02; grp.userData.pivots.push(pivot);
      // (Under a folded pile's top, edges squared to it, however the cards under it lie: each is in the sift as it is.)
      const card = cardMesh(cardOf); card.position.y = CH / 2;
      pivot.add(card);
      if (!i) P.attachments(c.id).forEach((a, k) => {   // auras and equipment peek out from behind
        const am = cardMesh(a); am.scale.setScalar(0.8);
        am.position.set(0.16 + k * 0.1, CH / 2 + 0.34 + k * 0.2, -0.03 - k * 0.02); am.rotation.z = -0.08;
        pickable(am, { type: "card", id: a.id }); pivot.add(am);
      });
      if (i === 0) {
        grp.userData.haloParent = card; chipsOn(card, c);
        // A pile is one card, its title on a tab above it: a folded pile's, or a pile of copies' name and count ("Beast 2"),
        // so a count of bodies never looks like a counter's round chip on one of them. The copies behind it show only as a
        // sliver of edge, never as fragments of their own faces.
        // Where some of its cards are tapped and some not, the tab says how many are tapped, whichever lies on top.
        const some = tabSub(ids, title);
        if (title || copies > 1) card.add(titleTab(title || `${shortName(c)} ${copies}`, !!c.tapped, some));
      }
      one.add(base, stripe, pivot);
      one.position.set(i * (fan ? 0.09 : 0.04), 0, -i * 0.04);
      grp.add(one);
    }
    grp.userData.kind = "standee"; grp.userData.top = c.id;
    return pickable(grp, copies > 1 ? { type: "pile", ids, title: title || shortName(c) } : { type: "card", id: c.id });
  }
  function flatPiece(build, pick) {
    const grp = new T.Group(), tilt = new T.Group();
    grp.add(tilt); build(tilt);
    grp.userData.tilt = tilt; grp.userData.kind = "flat";
    return pickable(grp, pick);
  }
  function flat(c) {
    return flatPiece(t => {
      const card = cardMesh(c); card.position.set(0, CH / 2, TH); t.add(card);
      t.userData.haloParent = card;
      P.attachments(c.id).forEach((a, k) => { const am = cardMesh(a); am.scale.setScalar(0.8); am.position.set(0.14 + k * 0.08, CH / 2 + 0.3 + k * 0.18, -0.01 - k * 0.01); pickable(am, { type: "card", id: a.id }); t.add(am); });
      chipsOn(card, c);
    }, { type: "card", id: c.id });
  }
  // A land is a well: the card lies on the page and its mana breathes up through it. Lands of one name share a well with
  // a count, the tapped ones under the untapped; when they are all tapped the well goes dark. Theirs is one well with its
  // sign propped up over its card (`onCard`), read across the table; fitSeat sizes it so the card lying flat meets the floor.
  function well(ids, rep, { sign = null, sub = null, col = null, signAt = 0.5, title = null, onCard = false } = {}) {
    const piece = flatPiece(t => {
      // On top an untapped one; on theirs, signed "Lands", a land first (whether it is spent shows in the well's light).
      const up = id => (P.card(id).tapped ? 0 : 1) + (onCard && P.isLand(P.card(id)) ? 2 : 0);
      const n = ids.length, show = Math.min(n, 4), order = ids.slice().sort((a, b) => up(a) - up(b));
      // The well lies a little proud of the page, so its pool, which reaches past the card toward me, stays above the table
      // where the card's frame tips it down.
      const shown = order.slice(n - show);
      shown.slice().reverse().forEach((id, j) => { const m = cardMesh(P.card(id)); m.position.set(0, CH / 2, 0.03 + (TH + 0.002) * (show - j - 0.5)); t.add(m); });   // the top card first
      t.userData.haloParent = t.children[0];
    }, { type: "pile", ids, title: title || shortName(rep) });
    const allTapped = ids.every(id => P.card(id).tapped), w = SeatFX.well(piece.userData.tilt, wellColors(ids), { w: CW, h: CH, tapped: allTapped, seed: ids[0] });
    w.position.set(0, CH / 2, 0.028);
    if (sign) {   // just in front of the well, inside the page, propped up to be read (theirs: across the card's art, about as wide, its name clear above)
      const g = tagSign(sign, col, sub); g.rotation.x = -Math.PI / 2 + 0.95; g.position.set(0, 0.12, onCard ? -CH * 0.32 : signAt);   // (theirs: over the art, under the name's second line)
      if (onCard) g.userData.fit = Math.min(1, CW * 1.15 / g.userData.w);
      // (A second line hangs below: the top edge stays where a one-line sign's is, clear of the card's name, and the sign
      // stands that much further out from the card, so the line it adds isn't sunk in it.)
      if (onCard && sub) { const dh = (signTex(sign, col, sub).image.height - signTex(sign, col).image.height) * SIGN_U; g.geometry.translate(0, -dh / 2, dh * 1.5); }
      piece.add(g); piece.userData.sign = g;
    }
    piece.userData.well = true;
    return piece;
  }
  // A name tag for a pile or a well, so they tell themselves apart: "Lands 7", "Otawara", "Island ×6" over "3 tapped". As
  // wide as its words, a slip of vellum edged in ink, with the seat's seal when it speaks for a seat.
  const SIGN_U = 0.00375;                           // world units per canvas pixel
  function tagSign(text, col, sub) {
    const im = signTex(text, col, sub).image, m = new T.Mesh(new T.PlaneGeometry(im.width * SIGN_U, im.height * SIGN_U), new T.MeshBasicMaterial({ map: signTex(text, col, sub), transparent: true, depthWrite: false }));
    m.renderOrder = 5; m.userData.w = im.width * SIGN_U; m.userData.noPick = true;
    return m;
  }
  function signTex(text, col, sub) {
    const k = "sign|" + text + col + sub;
    if (!TEX[k]) {
      const cv = document.createElement("canvas"), x = cv.getContext("2d");
      x.font = `700 60px ${NUM}`; let tw = x.measureText(text).width;
      if (sub) { x.font = `600 46px ${NUM}`; tw = Math.max(tw, x.measureText(sub).width); }
      const notch = col ? 34 : 0, w = Math.min(sub ? 900 : 560, tw + 36 + notch), h = sub ? 130 : 80;
      cv.width = Math.ceil(w + 16); cv.height = h + 16;
      x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 8; x.shadowOffsetY = 3;
      rr(x, 8, 6, w, h, 6); x.fillStyle = IMG[TEXS.vellum] ? x.createPattern(IMG[TEXS.vellum], "repeat") : THEME.bone; x.fill();
      x.shadowColor = "transparent";
      x.lineWidth = 2.5; x.strokeStyle = "rgba(40,22,5,.85)"; rr(x, 8, 6, w, h, 6); x.stroke();
      if (col) { x.beginPath(); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r2 = 15 + (i % 2 ? 2 : -1); x.lineTo(8 + 24 + Math.cos(a) * r2, 46 + Math.sin(a) * r2); } x.closePath(); x.fillStyle = col; x.fill(); x.lineWidth = 1.5; x.strokeStyle = "rgba(0,0,0,.4)"; x.stroke(); }
      x.fillStyle = THEME.ink; x.textAlign = "center"; x.textBaseline = "middle";
      x.font = `700 60px ${NUM}`; x.fillText(text, 8 + (w + notch) / 2, 49, w - 28 - notch);
      if (sub) { x.font = `600 46px ${NUM}`; x.fillStyle = "#3a2c1a"; x.fillText(sub, 8 + (w + notch) / 2, 102, w - 28 - notch); }
      TEX[k] = texFrom(cv);
    }
    return TEX[k];
  }
  // A folded pile's title ("Tokens 23", "+4") on a tab standing up from its top card's top edge, so the top card's own
  // name still shows under it.
  const TAB_H = 0.24;                               // a title tab's greatest height above its card
  // (On a card lying turned, tapped, the tab stands on its long edge, now its top. `sub`: a second line, "7 tapped".)
  function titleTab(title, turned = false, sub) {
    const top = turned ? CW / 2 : CH / 2, wide = turned ? CH : CW;
    const fit = (t, sb) => { const im = signTex(t, undefined, sb).image; return Math.min(1.1, wide * 1.04 / (im.width * SIGN_U), TAB_H / (im.height * SIGN_U)); };
    const one = sub && fit(`${title} · ${sub}`) > fit(title, sub);   // on one line where that reads larger
    const g = one ? tagSign(`${title} · ${sub}`) : tagSign(title, undefined, sub), h = g.geometry.parameters.height, s = one ? fit(`${title} · ${sub}`) : fit(title, sub);
    g.scale.setScalar(s); g.position.set(0, top + h * s / 2 - 0.035, TH / 2 + 0.03); g.userData.title = title; g.userData.turned = turned; g.userData.sub = sub;
    return g;
  }
  // A pile's second line: how many kinds a pile of unlike cards holds ("8 kinds"), so it reads as more than its front, and
  // where some of its cards are tapped and some not, how many are tapped.
  function tabSub(ids, title) {
    const cs = ids.map(id => P.card(id) || {}), tapped = cs.filter(c => c.tapped).length, kinds = title ? new Set(cs.map(c => c.card)).size : 1;
    return [kinds > 1 && `${kinds} kinds`, tapped && tapped < ids.length && `${tapped} tapped`].filter(Boolean).join(" · ") || undefined;
  }
  // A folded pile's count as cards arrive at it: its tab counts the cards that have landed (`ids`), and how many of them
  // are tapped, until the next one lands.
  function retitle(obj, ids) {
    let tab = null; obj.traverse(o => { if (o.userData.title) tab = o; });
    if (!tab || !tab.parent) return;
    const sub = tabSub(ids, tab.userData.title);
    const title = tab.userData.title.replace(/\d+$/, ids.length);
    if (title === tab.userData.title && sub === tab.userData.sub) return;
    const g = titleTab(title, tab.userData.turned, sub), host = tab.parent; host.remove(tab); dispose(tab); host.add(g);
    g.renderOrder = tab.renderOrder; obj.userData.faces = facesOf(obj);
  }
  // Identical cards in a neat pile, or different ones fanned so each name shows; a count chip on piles. Theirs, standing far
  // off, carry a pile's title on a tab above the top card instead (`tag`), like a folded pile of creatures.
  function pileOf(ids, title, { fan = false, count = true, sign = null, col = null, tag = null } = {}) {
    // A fan reaches back no further than two cards' does (my support row's depth, clear of the creatures' feet): a third
    // card brings the top one forward instead.
    const n = ids.length, show = ids.slice(0, Math.min(n, fan ? 3 : 8)), f = show.length, drop = fan ? Math.max(0, f - 2) * 0.16 : 0;
    const piece = flatPiece(t => {
      show.forEach((id, i) => {
        const m = cardMesh(P.card(id));
        m.position.set(0, CH / 2 + (fan ? (f - 1 - i) * 0.16 - drop : 0), (TH + 0.002) * (i + 0.5));
        t.add(m);
      });
      const top = t.userData.haloParent = t.children[t.children.length - 1];
      if (tag) top.add(titleTab(tag));
      else if (count && n > 1 && !sign) chipsOn(top, {}, "×" + n);
    }, { type: "pile", ids, title });
    piece.userData.top = show[f - 1];
    // Its sign lies on its top card's foot, as a well's does, never out over the row in front.
    if (sign) { const g = tagSign(sign, col); g.rotation.x = -Math.PI / 2 + 0.5; g.position.set(0, 0.1, -CH * 0.12 + drop); g.scale.setScalar(Math.min(1, CW * 1.1 / g.userData.w)); g.renderOrder = 6; piece.add(g); }
    return piece;
  }

  // ---- The table: my seat near, the three opponents always in the same places --------------------------------------
  const CAM = { pos: { x: 0, y: 18, z: 14 }, at: { x: 0, y: 0, z: -1.6 }, fov: 38 };
  const PITCH = Math.atan2(CAM.pos.y - CAM.at.y, CAM.pos.z - CAM.at.z);   // how steeply the camera looks down
  // Slots on the table: centre, width, depth and a turn toward my seat. Rows run across the width; "front" is the edge
  // nearest the table's centre for opponents and the far edge for me, so creatures face each other.
  const BASE = {
    // A page's fixed edge is its back for me (by my hand) and its front for the others, at v = d/2; it grows from there to
    // fit its rows (fitSeat) up to the slot's w × d, and slots never overlap one another on screen, even grown 1.1× on
    // their turn. Together they fill the open book: across high in the middle, the sides beside it, mine below.
    you: { x: 0, z: 2.7, w: 22, d: 7.6, yaw: 0 },     // its back edge inside the screen's foot (about 803u), its border showing between hand and prompt
    ana: { x: -8.68, z: -7.42, w: 7.8, d: 11.4, yaw: 0.16 },
    bo: { x: 0, z: -10.5, w: 8.4, d: 12.2, yaw: 0 },  // its back edge, at its deepest, just inside the top of the screen
    cy: { x: 8.68, z: -7.42, w: 7.8, d: 11.4, yaw: -0.16 },
  };
  // The camera never moves. On another player's turn their page comes forward a little in place, 1.1× from its fixed edge,
  // and lights (H.soft); when I lean in on a side (focus), that page lifts off the table and comes over the middle, still
  // facing me, while the rest recede (lean). The stack is a layer of its own (H.stackLayer): it dims the table and moves
  // nothing.
  let focus = null;
  // The turn player's side stays forward while the stack is up: a spell coming and going must not change the fields.
  const soft = () => { if (focus) return {}; const sf = H.soft || {}; return sf.stack && !sf.seat && G.active !== P.ME ? Object.assign({ seat: G.active }, sf) : sf; };
  const layer = () => !focus && !!H.stackLayer && G.stack.length > 0;
  function regions() {
    const R = JSON.parse(JSON.stringify(BASE)), sf = soft();
    if (focus) R[focus].focused = true;
    else if (sf.seat && sf.seat !== P.ME) R[sf.seat].soft = true;
    return R;
  }
  // A page that moves carries everything on it: the page, its cards, its plaque and piles, as one leaf. `carry` takes the
  // poses a seat has lying in its place and gives them as that leaf turned square to me (yaw 0), scaled by `S` about the
  // point `from` and set down with that point at `to`, turned to `toYaw`. Scaling the whole leaf, never re-laying it, keeps
  // its border, grain and rows exactly as they were.
  function carry(out, pid, from, yaw, to, S, toYaw = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), c1 = Math.cos(toYaw), s1 = Math.sin(toYaw);
    Object.keys(out).forEach(k => {
      const pc = pieces[k], t = out[k];
      if (!pc || pc.pid !== pid || t.fight) return;
      const dx = t.pos.x - from.x, dz = t.pos.z - from.z, u = (dx * c - dz * s) * S, v = (dx * s + dz * c) * S;
      t.pos = new T.Vector3(to.x + u * c1 + v * s1, to.y + t.pos.y * S, to.z - u * s1 + v * c1);
      t.s = (t.s || 1) * S;
      if (t.floor) t.floor.yaw = toYaw;
    });
  }
  // Leaning in: the camera never moves. The page comes off the table toward me, held over the middle and squared to me,
  // high enough (LIFT) to be above everything standing on the table, so it covers what lies under it rather than sliding
  // among it, and casts its shadow there (floorShade). It grows as large as fits between the screen's bar and the tops of
  // my own standing row (and the signs over them), so my creatures and hand stay in view, and stays as near its own seat
  // as that allows. A side page keeps beside the page across, never over it, so every other seat stays whole.
  const LIFT = 3.2, LEAN_BOX = { l: 20, r: 1160, t: 66, b: 690 };   // under the top bar and its notes, to the screen's gutters
  // A piece's box on screen (1180×820 units) at its pose `t`: its card faces and signs (not the shadow and ash it casts).
  function extentOf(pc, t) {
    const inv = new T.Matrix4(), at = new T.Matrix4(), M = new T.Matrix4(), v = new T.Vector3(), u = uPx(), e = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    pc.obj.updateWorldMatrix(true, true); inv.copy(pc.obj.matrixWorld).invert();
    at.compose(t.pos, pc.obj.quaternion, new T.Vector3().setScalar(t.s || 1));
    pc.obj.traverse(m => {
      if (!m.isMesh || !m.visible || !m.geometry || !((m.material && m.material.userData && m.material.userData.dim) || m.userData.w != null)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox; M.multiplyMatrices(at, inv).multiply(m.matrixWorld);   // its own corners, where they will be
      [b.min.x, b.max.x].forEach(x => [b.min.y, b.max.y].forEach(y => [b.min.z, b.max.z].forEach(z => {
        const p = project(v.set(x, y, z).applyMatrix4(M));
        e.l = Math.min(e.l, p.x / u); e.r = Math.max(e.r, p.x / u); e.t = Math.min(e.t, p.y / u); e.b = Math.max(e.b, p.y / u);
      })));
    });
    return e;
  }
  // A page's lying box on screen, in units.
  function pageBox(out, pid) {
    const t = out["floor" + pid], u = uPx(); if (!t) return null;
    const ps = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project(toWorld({ x: t.pos.x, z: t.pos.z, yaw: t.floor.yaw }, a * t.floor.w / 2 * t.s, b * t.floor.d / 2 * t.s)));
    return { l: Math.min(...ps.map(p => p.x)) / u, r: Math.max(...ps.map(p => p.x)) / u };
  }
  function lean(out, R) {
    const fl = out["floor" + focus]; if (!fl) return;
    const r = R[focus], w = fl.floor.w, d = fl.floor.d, mid = new T.Vector3(fl.pos.x, 0, fl.pos.z);
    const corners = (to, S) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project(new T.Vector3(to.x + a * w / 2 * S, LIFT, to.z + b * d / 2 * S)));
    const u = Math.min(innerWidth / 1180, innerHeight / 820), mine = out["floor" + P.ME];
    let bot = mine ? Math.min(LEAN_BOX.b, project(mine.pos.clone().setZ(mine.pos.z - mine.floor.d / 2 * (mine.s || 1))).y / u - 10) : LEAN_BOX.b;
    Object.entries(pieces).forEach(([k, pc]) => { if (pc.pid === P.ME && pc.role === "creature" && out[k]) bot = Math.min(bot, extentOf(pc, out[k]).t - 10); });
    const cy = (LEAN_BOX.t + bot) / 2, home = project(mid).x / u;
    // A side seat keeps beside the page across and never over its cards. That page makes room: it slides, whole and
    // unscaled, into the open table toward the far side, and the leaned page may then cover only its bare vellum.
    let L = LEAN_BOX.l, Rt = LEAN_BOX.r;
    const across = r.x !== 0 && SEATS.find(p => p.id !== P.ME && BASE[p.id].x === 0), af = across && out["floor" + across.id];
    if (af) {
      const far = SEATS.find(p => p.id !== P.ME && Math.sign(BASE[p.id].x) === -Math.sign(r.x)), ab = pageBox(out, across.id), fb = far && pageBox(out, far.id);
      const room = fb ? Math.max(0, r.x > 0 ? ab.l - fb.r - 10 : fb.l - ab.r - 10) : 0, shift = r.x > 0 ? -room : room;
      const per = (project(af.pos.clone().add(new T.Vector3(1, 0, 0))).x - project(af.pos).x) / u, dx = shift / per;
      const keys = Object.keys(out).filter(k => pieces[k] && pieces[k].pid === across.id && !out[k].fight);
      const cards = keys.filter(k => pieces[k].role !== "floor").map(k => extentOf(pieces[k], out[k]));
      keys.forEach(k => (out[k].pos = out[k].pos.clone().add(new T.Vector3(dx, 0, 0))));
      if (r.x > 0) L = Math.max(ab.l + shift, ...cards.map(e => e.r + shift)) + 8;
      else Rt = Math.min(ab.r + shift, ...cards.map(e => e.l + shift)) - 8;
    } else if (r.x !== 0) { const m = (LEAN_BOX.l + LEAN_BOX.r) / 2; if (r.x > 0) L = m + 10; else Rt = m - 10; }
    // Centred in that box as it looks (its near edge looks larger than its far one), across from its own seat, shifted in
    // only as far as it must be to fit.
    const place = S => {
      let to = tableAt(home, cy, LIFT), q;
      for (let it = 0; it < 3; it++) {
        q = corners(to, S).map(p => ({ x: p.x / u, y: p.y / u }));
        const xs = q.map(p => p.x), ys = q.map(p => p.y), off = cy - (Math.min(...ys) + Math.max(...ys)) / 2;
        const dx = Math.max(0, L - Math.min(...xs)) - Math.max(0, Math.max(...xs) - Rt);
        const at = project(to);
        to = tableAt(at.x / u + dx, at.y / u + off, LIFT);
      }
      q = corners(to, S).map(p => ({ x: p.x / u, y: p.y / u }));
      const fits = q.every(p => p.x >= L - 1 && p.x <= Rt + 1 && p.y >= LEAN_BOX.t - 1 && p.y <= bot + 1);
      return { to, fits };
    };
    let lo = 0.75, hi = 2.6, best = place(lo);
    for (let it = 0; it < 14; it++) { const S = (lo + hi) / 2, p = place(S); if (p.fits) { lo = S; best = p; } else hi = S; }
    carry(out, focus, mid, r.yaw, new T.Vector3(best.to.x, LIFT, best.to.z), lo);
    fl.floor.lift = LIFT;
    // Its cards then grow where they stand, as far as the room between them allows (up to LEAN_GROW), so leaning in brings
    // them closer even where the page itself can't grow: none moves, none comes nearer than LEAN_GAP to another or to the plaque
    // and zones (which keep their size), and none passes the page's far edge or the box (the page across, my row, the gutters).
    const q = corners(best.to, lo).map(p => ({ x: p.x / u, y: p.y / u }));
    const room = { l: L, r: Rt, t: Math.max(LEAN_BOX.t, q[0].y), b: bot };
    const all = Object.keys(out).filter(k => pieces[k] && pieces[k].pid === focus && !out[k].fight && pieces[k].role !== "floor")
      .map(k => ({ k, e: extentOf(pieces[k], out[k]), a: (p => ({ x: p.x / u, y: p.y / u }))(project(out[k].pos)), fixed: pieces[k].role === "plate" || pieces[k].role === "zone" }))
      .filter(x => isFinite(x.e.l));
    const at = (x, g) => x.fixed ? x.e : { l: x.a.x + (x.e.l - x.a.x) * g, r: x.a.x + (x.e.r - x.a.x) * g, t: x.a.y + (x.e.t - x.a.y) * g, b: x.a.y + (x.e.b - x.a.y) * g };
    const gap = (a, b) => Math.max(b.l - a.r, a.l - b.r, b.t - a.b, a.t - b.b);
    const pairs = [];   // what is clear of each other now stays clear, by LEAN_GAP or by what it has now if that is less
    all.forEach((a, i) => all.slice(i + 1).forEach(b => { const d = gap(a.e, b.e); if (d >= 0) pairs.push([a, b, Math.min(LEAN_GAP, d)]); }));
    const inside = (x, e) => e.l >= Math.min(room.l, x.e.l) && e.r <= Math.max(room.r, x.e.r) && e.t >= Math.min(room.t, x.e.t) && e.b <= Math.max(room.b, x.e.b);
    const ok = g => all.every(x => x.fixed || inside(x, at(x, g))) && pairs.every(([a, b, m]) => gap(at(a, g), at(b, g)) >= m);
    let g0 = 1, g1 = LEAN_GROW;
    for (let it = 0; it < 10; it++) { const g = (g0 + g1) / 2; if (ok(g)) g0 = g; else g1 = g; }
    all.forEach(x => { if (!x.fixed) out[x.k].s = (out[x.k].s || 1) * g0; });
  }
  const LEAN_GROW = 1.35, LEAN_GAP = 6;
  const GROW = 1.1;
  // The hand holds the bottom-left corner (about x 34–470u, from 605u down) and is up all the time, and the prompt the
  // bottom-right (from 838u across, 630u down: 680u, and the one line of what I lost on top of it): nothing of mine goes
  // behind either. Where a point on screen meets the table (or, given a height, the level held that high over the table).
  const HAND = { right: 470, top: 605 }, PROMPT = { left: 838, top: 630 };
  function tableAt(ux, uy, y = 0) {
    const u = Math.min(innerWidth / 1180, innerHeight / 820), hit = new T.Vector3();
    cam.updateMatrixWorld();                        // the first layout runs before the first frame has placed the camera
    raycaster.setFromCamera(new T.Vector2(ux * u / innerWidth * 2 - 1, -(uy * u / innerHeight) * 2 + 1), cam);
    return raycaster.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), hit) || new T.Vector3(-4, y, 6);
  }
  const toWorld = (R, u, v) => new T.Vector3(R.x + u * Math.cos(R.yaw) + v * Math.sin(R.yaw), 0, R.z - u * Math.sin(R.yaw) + v * Math.cos(R.yaw));

  // Standees in rows step back further than cards lying (STEP, in scale units), so a rear row's name clears the row in front.
  const STEP = 1.2;
  // How much further back than upright a tapped standee leans, so tapped reads at a glance.
  const TAP_LEAN = 0.3;

  // ---- Fitting a page: floor sizes, rows, and what folds -------------------------------------------------------------
  // The hard floors (tools/look/intent.md), in 1180×820 screen units: a card is never drawn narrower on screen than this.
  // Cards never shrink to fit: a page grows from its fixed edge up to its slot (BASE), and past that its rows fold.
  const FLOOR = { mine: 72, theirs: 56, any: 44 };
  const uPx = () => Math.min(innerWidth / 1180, innerHeight / 820);
  // The scale a card needs at `pos` to be `px` wide on screen, measured across its face's middle (standing) or the card
  // lying there (flat); lying, it must also be 44 tall to be tapped, and a card lying far off is foreshortened.
  function floorScale(pos, px, flat, s = 1.5) {
    // A standing card's face leans back square to me: its middle stands half its height up and back from its foot. A card
    // lying flat reaches away from its near edge (its foot).
    const mid = pos.clone().add(flat ? new T.Vector3(0, 0, -0.5 * CH * s) : new T.Vector3(0, 0.5 * CH * s * Math.cos(PITCH), -0.5 * CH * s * Math.sin(PITCH)));
    const at = y => project(new T.Vector3(pos.x, y, pos.z)), a = project(mid.clone().setX(mid.x - 0.5)), b = project(mid.clone().setX(mid.x + 0.5));
    const k = (b.x - a.x) / uPx();
    let w = px * 1.09;
    // (Tapped, it lies turned: then its narrow side runs away from me, foreshortened, and that must be 44 too.)
    if (flat) { const tall = (at(0).y - project(new T.Vector3(pos.x, 0, pos.z - 0.5)).y) * 2 / uPx(); w = Math.max(w, FLOOR.any * 1.12 * k / tall * CW / CH, px * 1.09 * k / tall); }
    return w / (CW * k);
  }
  // How deep into seat `r`'s page (from its fixed edge) the table first shows above the top of a card of scale `s` standing
  // at depth `foot`, as I see it. Far off I look across the table more than down on it, so a standee there hides more of
  // the page behind it than near me: a row or band behind starts here, or the card in front covers its foot.
  function clearBehind(r, foot, s, tall = CH * 1.04) {
    const U = new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
    const top = project(toWorld(r, 0, r.d / 2 - foot).addScaledVector(U, tall * s)).y / uPx() - 2;
    let lo = foot, hi = r.d + 4;
    for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (project(toWorld(r, 0, r.d / 2 - m)).y / uPx() > top) lo = m; else hi = m; }
    return hi;
  }
  // Each band: its preferred scale (few cards never render small), its floor, how deep its first row and each row behind it
  // run (in scale units: a standing card covers CH / sin(PITCH) of page behind its foot from my chair), its spacing, and
  // how many rows it may take. Bands keep their order from the page's fixed edge (theirs: creatures, support, then the
  // plaque; mine: plaque, wells, support, creatures, so my creatures face theirs).
  const BAND = {
    // Each creature's place is as wide as a tapped card turned in it, so tapping never slides a card under its neighbour.
    C: me => ({ pref: me ? 1.45 : 1.3, px: me ? FLOOR.mine : FLOOR.theirs, lead: me ? CH / Math.sin(PITCH) : 0.2, first: me ? CH / Math.sin(PITCH) + 0.15 : 0.2 + CH / Math.sin(PITCH), step: STEP, per: CH + 0.06, rows: 2 }),
    // Theirs stand nearly upright, their feet just behind the creatures' tops; mine lie propped up, far edge clear of my
    // creatures' feet and foot clear of the wells' names.
    S: me => ({ pref: me ? 1.2 : 1.1, px: FLOOR.any, lead: me ? 0.7 : 0.1, first: me ? 1.3 : 1.1, step: 1.0, per: 0.82, rows: 2 }),
    L: me => ({ pref: me ? 1.05 : 1.1, px: FLOOR.any, flat: true, lead: me ? 0.5 : 0.05, first: me ? 1.05 : 1.15, step: 1.0, per: 0.9, rows: me ? 2 : 1 }),   // theirs: one well lying at the outer end of their support row
  };
  // Between bands; the margin at the page's open edge; the plaque's band; inside the border at the sides; how far a row is
  // set off from the one in front, so its cards show between theirs.
  const GAP = 0.25, EDGE = 0.35, BACK = { me: 1.2, them: 2.0 }, SIDE = 0.6, STAGGER = 0.2;
  // Places in a row, centre out: place 0 in the middle, then right, left, right…. In place widths from the row's centre (a
  // row of an even number of places is centred when full).
  const rowPlace = (j, per) => (j % 2 ? (j + 1) / 2 : -j / 2) - (per % 2 ? 0 : 0.5);
  // Where place i of a band stands across (region u): rows centred on the band's span, odd rows staggered.
  const rowCentre = (B, row) => B.span.uc + (B.rows > 1 ? (row % 2 ? 0.5 : -0.5) * STAGGER * B.s : 0);
  const rowU = (B, i) => rowCentre(B, Math.floor(i / B.perRow)) + rowPlace(i % B.perRow, B.perRow) * B.s * B.per;
  // Seat a band's units in its places (`at`). A unit keeps the place it had (`had`, from the last fit, its row and its
  // place from the middle out while the rows hold as many places): one that goes leaves a gap rather than its neighbours
  // sliding in after the exchange is over. A newcomer takes the first free place, centre out, so a row fills its gaps,
  // then grows at its ends. Without `had`, places go by arrival.
  function seatPlaces(units, per, cap, had) {
    const fresh = [], taken = new Set();
    units.forEach(u => { const i = had && had.get(u.key); if (i == null || i >= cap || taken.has(i)) fresh.push(u); else { u.at = i; taken.add(i); } });
    let i = 0;
    fresh.forEach(u => { while (taken.has(i)) i++; u.at = i; taken.add(i); });
    // A newcomer with a copy of itself on the row stands beside it, in the nearest free place or one another newcomer
    // takes (they trade): so when the row grows past its places and the copies pile, one steps over, never the length of
    // the row (centre out, places in a row alternate sides).
    const gap = (a, b) => Math.abs(Math.floor(a / per) - Math.floor(b / per)) * per + Math.abs(rowPlace(a % per, per) - rowPlace(b % per, per));
    const name = u => P.name(u.rep);
    fresh.forEach(u => {
      const like = units.find(v => v !== u && name(v) === name(u) && (!fresh.includes(v) || fresh.indexOf(v) < fresh.indexOf(u)));
      if (!like || gap(u.at, like.at) <= 1) return;
      let best = null, d = gap(u.at, like.at);
      for (let j = 0; j < cap; j++) {
        const w = units.find(v => v.at === j);
        if (w && (!fresh.includes(w) || units.some(v => v !== w && name(v) === name(w)))) continue;
        if (gap(j, like.at) < d) { d = gap(j, like.at); best = j; }
      }
      if (best == null) return;
      const w = units.find(v => v.at === best);
      if (w) w.at = u.at;
      u.at = best;
    });
    return units;
  }
  // A card arriving on a page that holds its shape while others leave it (buildBoard) stands in the first free place,
  // centre out, of its own band, or else of another band the leavers emptied, until the page re-fits. False if none is free.
  function seatGuest(plan, u, me) {
    const own = { creature: "C", walker: "C", support: "S", mana: "L" }[u.role];
    for (const k of [own, "C", "S"].concat(me ? ["L"] : [])) {
      const B = plan[k]; if (!B || !B.cap || !B.units || (k === "L" && !me)) continue;
      const taken = new Set(B.units.map(x => x.at));
      for (let i = 0; i < B.cap; i++) if (!taken.has(i)) { B.units.push({ ...u, at: i }); plan.fed++; return true; }
    }
    return false;
  }
  // Their plaque (and the commander beside it): its scale, and how far in from the page's back edge it stands, for its top,
  // leaning back, to stay inside the border.
  const PLATE_S = 1.0, PLATE_IN = 1.75;
  // Where a band at depth `a` from the page's fixed edge lies across: the whole slot, or for mine, clear of the hand (bottom
  // left) and the prompt (bottom right) where its nearest row comes down beside them. Region units, centred on `uc`.
  function bandSpan(r, me, aNear) {
    let lo = -r.w / 2 + SIDE, hi = r.w / 2 - SIDE;
    if (me) {
      const y = project(toWorld(r, 0, r.d / 2 - aNear)).y / uPx();
      if (y > HAND.top - 8) lo = Math.max(lo, tableAt(HAND.right + 10, y).x - r.x);
      if (y > PROMPT.top - 8) hi = Math.min(hi, tableAt(PROMPT.left - 10, y).x - r.x);
    }
    return { lo, hi, w: Math.max(0, hi - lo), uc: (lo + hi) / 2 };
  }
  // How far from my page's fixed edge a row's foot must stand to be above the hand's top on screen.
  function clearOfHand(r) {
    let lo = 0, hi = r.d;
    for (let it = 0; it < 16; it++) { const a = (lo + hi) / 2; if (project(toWorld(r, 0, r.d / 2 - a)).y / uPx() > HAND.top - 12) lo = a; else hi = a; }
    return hi;
  }
  // A seat's fit: for each band its scale, places per row and rows, and its units folded to fit; and the page's size.
  // Rows and scales come first, from the floors at the rows' places on screen; then each band folds into what it holds.
  function fitSeat(pid, { C, S, L, rock, nz, cmd, settling }, hold = true) {
    // A pile of like cards stays one while its page holds: opened as soon as a place comes free, it would send an idle
    // copy the length of its row. (Only like cards: a mixed pile opens as soon as it can.)
    if (hold && plans[pid]) [C, S] = [C, S].map((us0, i) => (plans[pid][i ? "S" : "C"].units || []).filter(p => p.title && !p.mixed).reduce((us, p) => {
      const mine = us.filter(u => !u.fight && u.ids.every(id => p.ids.includes(id)));
      if (mine.length < 2) return us;
      // (It shows the face it showed while that card is still in it, else the one a fresh fold would; first in its ids, so
      // a tap on it acts on the card it shows.)
      const all = mine.flatMap(u => u.ids), rest = us.filter(u => !mine.includes(u));
      const rep = all.includes(p.rep.id) ? P.card(p.rep.id) : kindsOf(all)[0] || mine[0].rep, ids = i ? all : [rep.id, ...all.filter(id => id !== rep.id)];
      rest.splice(us.indexOf(mine[0]), 0, { key: mine[0].key, ids, rep, role: mine[0].role, title: p.title.replace(/\d+$/, ids.length) });
      return rest;
    }, us0));
    // Their lands are one well lying flat at the outer end of their first support row (away from the plaque's piles). There
    // it is near enough to meet the floors lying down, and on screen it stays within the support row's height, so it costs
    // the page width, not depth.
    const r = BASE[pid], me = pid === P.ME, order = me ? ["L", "S", "C"] : ["C", "S"], n = { C: C.length, S: S.length, L: L.length };
    const back = me ? BACK.me : BACK.them, b = {};
    // Cards leaving never move the cards that stay: each band holds the rows it had (even emptied by a wipe), and the page
    // its size (`hold`). A fit without holds starts afresh, keeping only each unit's place. Whether the holds cost room
    // (`over`: deeper than the page was; or more folding than a fresh fit) is buildBoard's to weigh.
    const prev = plans[pid], held = {};
    order.forEach(k => (held[k] = hold && prev && prev[k] ? prev[k].rows : 0));
    // Their creatures that outgrow the creature band stand in the support row (`host`) before any of them share a pile:
    // there its places are as wide as a creature's, and its cards as large as a creature's floor asks. (Mine can't: a
    // second row of my creatures at their floor is deeper than my page can be.) While cards are still leaving (`settling`)
    // that holds, so a page losing its creatures doesn't shrink its support row and move the piles they fly to; once
    // they have landed the row is the support's again, its places as wide as theirs, so what survives can lie on its own.
    let host = !!(hold && settling && prev && prev.host);
    const band = k => (host && k === "S" ? { ...BAND.S(me), px: FLOOR.theirs, per: BAND.C(me).per } : BAND[k](me));
    const lay = rows => {                               // depths from the fixed edge, with rows per band
      let a = me ? back + GAP : EDGE;
      if (!me) b.L = { n: 0, rows: 0, perRow: 0, cap: 0, s: 1 };
      order.forEach(k => {
        const B = band(k), cnt = n[k], lands = !me && k === "S" && n.L;
        if (!cnt && !lands && !held[k]) { b[k] = { ...B, k, s: B.pref, n: 0, rows: 0, perRow: 0, a0: a, a1: a, cap: 0 }; return; }
        if (me && k === "C") a = Math.max(a, clearOfHand(r));   // my creatures stand above the hand, across the whole page
        let s = B.pref;
        for (let it = 0; it < 3; it++) {                  // the floor where its farthest row stands (mine: the front row)
          const foot = me ? a + s * (B.first + (rows[k] - 1) * B.step - B.lead) : a + s * (B.lead + (rows[k] - 1) * B.step);
          // (A creature tapped turns and leans further back, TAP_LEAN: then its narrow side runs up the screen, foreshortened.)
          s = Math.max(B.pref, floorScale(toWorld(r, 0, r.d / 2 - foot), k === "C" || (host && k === "S") ? B.px / Math.cos(TAP_LEAN) : B.px, B.flat, s));
        }
        let step = B.step, d = s * (B.first + (rows[k] - 1) * B.step);
        if (!me) {                                        // theirs stand: each row, and the band behind, where it shows whole
          const tall = CH + TAB_H;                        // above a folded pile, its title tab
          for (let i = 0; i < rows[k] - 1; i++) { const f = a + s * (B.lead + i * step); step = Math.max(step, (clearBehind(r, f, s, tall) - f) / s); }
          d = Math.max(s * (B.lead + (rows[k] - 1) * step), clearBehind(r, a + s * (B.lead + (rows[k] - 1) * step), s, tall) - a);
        }
        let span = bandSpan(r, me, me ? a : a + d);
        if (lands) {                                      // their well: lying flat, sized to the floors where it lies
          const L0 = BAND.L(false), foot = a + s * B.lead, zs = zoneSide(pid);
          let sL = L0.pref;
          for (let it = 0; it < 3; it++) sL = Math.max(L0.pref, floorScale(toWorld(r, 0, r.d / 2 - foot), L0.px, true, sL));
          const lw = sL * CW + 0.35, lo = zs > 0 ? span.lo + lw : span.lo, hi = zs > 0 ? span.hi : span.hi - lw;
          b.L = { ...L0, k: "L", s: sL, n: n.L, rows: 1, perRow: 1, cap: 1, a0: foot - sL * L0.lead, a1: foot + sL * CH, w: lw, u: zs > 0 ? span.lo + sL * CW / 2 : span.hi - sL * CW / 2 };
          span = { lo, hi, w: Math.max(0, hi - lo), uc: (lo + hi) / 2 };
        }
        const perRow = Math.max(1, Math.floor((span.w - (rows[k] > 1 ? STAGGER * s : 0)) / (s * B.per)));
        b[k] = { ...B, k, s, step, n: cnt, rows: rows[k], perRow, a0: a, a1: a + d, cap: perRow * rows[k], span };
        a += d + GAP;
      });
      if (me) return a - GAP + EDGE;
      // Their plaque draws over everything, so it stands where it is clear, on screen, of the tops of the row in front of it
      // (their support stands nearly upright: its top reaches well back from its foot as I see it), and the page reaches
      // far enough behind it for the plaque's top to stay inside the border.
      b.plateA = a - GAP + back - PLATE_IN;
      const B = b.S.n ? b.S : b.C.n ? b.C : null;
      if (B) b.plateA = Math.max(b.plateA, clearBehind(r, B.a0 + B.s * (B.lead + (B.rows - 1) * B.step), B.s));
      if (b.L.n) b.plateA = Math.max(b.plateA, b.L.a1 + 0.2);   // and behind the far end of their well
      // The graveyard and exile in the plaque's row are propped from their near edge, half a card in front of it: where a
      // pile in front wears a title tab (a pile of copies, a fold), they stand back far enough that the tab never covers
      // their foot (`zoneBack`).
      const tabbed = B && ([...C, ...S].some(u => u.ids.length > 1) || B.n > B.cap);
      b.zoneBack = tabbed ? Math.max(0, clearBehind(r, B.a0 + B.s * (B.lead + (B.rows - 1) * B.step), B.s, CH + TAB_H) + 0.45 - b.plateA) : 0;
      // The page reaches far enough behind the plaque that its top, leaning back, stays inside the fine rule as I see it.
      const pf = toWorld(r, 0, r.d / 2 - b.plateA), ty = project(pf.clone().add(new T.Vector3(0, 0.84 * Math.cos(PITCH), -0.84 * Math.sin(PITCH)).multiplyScalar(PLATE_S))).y / uPx();
      let lo = b.plateA, hi = r.d + 6;
      for (let it = 0; it < 18; it++) { const m = (lo + hi) / 2; if (project(toWorld(r, 0, r.d / 2 - m)).y / uPx() > ty) lo = m; else hi = m; }
      return Math.max(b.plateA + PLATE_IN, hi + 0.7, b.plateA + b.zoneBack + CH * 0.6);
    };
    // As many rows as each band needs, then give rows back while the page is deeper than its slot: support first, then
    // my wells, then creatures.
    const rows = {};
    let D;
    const fresh = !prev || !hold;
    const fitRows = () => {
      order.forEach(k => (rows[k] = Math.max(1, held[k])));
      D = lay(rows);
      order.forEach(k => { rows[k] = Math.max(held[k], Math.min(BAND[k](me).rows, Math.max(1, Math.ceil(n[k] / Math.max(1, b[k].perRow))))); });
      D = lay(rows);
      for (const k of ["S", "L", "C"]) while (D > r.d && rows[k] > Math.max(1, held[k])) { rows[k]--; D = lay(rows); }
    };
    fitRows();
    // Fold each band into what it holds: like cards first; unlike ones share a pile (`mixed`) only as the last resort.
    const keep = u => u.lands || u.rep.commander || /Legendary/.test(P.typeLine(u.rep));
    // (A pile of unlike cards is fronted by what it holds most of: standee fans the next kinds behind it.)
    // (A standing pile's front card leads its ids, so a tap on the pile acts on the card it shows.)
    const named = (u, k) => {
      const all = u.flatMap(x => x.ids), rep = kindsOf(all)[0] || u[0].rep, stands = u[0].role === "creature" || u[0].role === "walker";
      const ids = rep && stands ? [rep.id, ...all.filter(id => id !== rep.id)] : all;
      return { key: u[0].key, ids, rep, role: u[0].role, title: k };
    };
    // (Unlike tokens share "Tokens" only where that alone makes the row fit: where a mixed pile comes anyway, the tokens
    // keep their kinds, "Beast 9" and "Elemental 8", and the mixed pile takes what is fewest.)
    const likeC = [u => P.name(u.rep), Object.assign(u => (u.rep.token ? "Tokens" : null), { whole: true })];
    const likeS = [u => P.name(u.rep), u => (u.rep.token ? "Tokens" : null), u => P.typeLine(u.rep).split("—")[0].replace(/Legendary|Snow|Basic|Token/g, "").trim().split(" ").pop() + "s"];
    // Their creatures would share a pile while their support row has room to give: the noncreatures fold first and the
    // creatures take the places that frees, if the page still fits its slot that way.
    // (The noncreatures fold as far as the creatures need, into one pile at most.)
    const hosted = () => {
      const all = b.C.cap + b.S.cap, s = fold(S, Math.min(b.S.cap, Math.max(1, all - C.length)), likeS, keep, named, "Others");
      return { s, c: fold(C, all - s.length, likeC, keep, named, "Creatures") };
    };
    let split = null;
    const alone = fold(C, b.C.cap, likeC, keep, named, "Creatures");
    if (!me && S.length && b.C.cap && alone.some(u => u.mixed)) {
      const rows0 = { ...rows };
      host = true; fitRows();
      split = D <= r.d + 1e-6 && hosted();
      if (!split || split.c.length <= alone.length) { host = false; split = null; Object.assign(rows, rows0); D = lay(rows); }
    }
    const likeL = [u => (rock(u.rep) ? "Rocks" : null), u => (P.isLand(u.rep) && !/Basic/.test(P.typeLine(u.rep)) ? "Lands" : null), () => "Mana"];
    const over = D > Math.max(r.d, prev ? prev.deep + 1e-6 : 0) && order.some(k => held[k]);
    const needD = D;                                    // how deep it asks to be, past its slot when crowded
    // Their back band across: the plaque and, toward the table's middle, the commander (while it is in the command zone) and
    // then the piles. The plaque sits off centre so the band is balanced on the page. A pile is as large as the floors ask
    // where it lies (`zS`), so what went to it stays readable. The band keeps room for a commander or pile that has gone,
    // so the plaque doesn't slide when one comes or goes.
    const zS = me ? 0 : Math.max(0.8, floorScale(toWorld(r, 0, r.d / 2 - Math.min(b.plateA, r.d - PLATE_IN)), FLOOR.any, false, 0.8));   // propped up (PILE_LEAN): measured across, like a card standing
    const holdBack = !fresh && prev && prev.back0;
    const back0 = { nz: Math.max(nz, holdBack ? prev.back0.nz : 0), cmd: cmd || !!(holdBack && prev.back0.cmd), zS: Math.max(zS, holdBack ? prev.back0.zS : 0) };
    const backBand = () => {
      const half = 1.6 * PLATE_S, cmdOut = (2.2 + 0.32) * PLATE_S, zs = zoneSide(pid), gap = Math.max(1.15, back0.zS * CW + 0.4);
      const z0 = back0.cmd ? cmdOut + 0.25 + gap / 2 : half + 0.2 + gap / 2, zones = [...Array(back0.nz).keys()].map(i => z0 + i * gap);
      const eZ = Math.max(half, back0.cmd ? cmdOut + 0.05 : 0, back0.nz ? zones[back0.nz - 1] + gap / 2 : 0), c = -zs * (eZ - half) / 2;
      return { place: { plate: c, zones: zones.map(u => c + zs * u), zS: back0.zS }, w: eZ + half + 2 * SIDE };
    };
    if (split) {
      // The first creatures to arrive keep the creature band; the rest stand in the support row after the noncreatures.
      const { s, c } = split;
      b.C.units = c.slice(0, b.C.cap); b.S.units = s.concat(c.slice(b.C.cap));
    } else {
      // (Where creatures share a pile anyway, like noncreatures still fan into their named piles first: folding order.)
      b.C.units = alone;
      b.S.units = fold(S, b.S.cap, likeS, keep, named, "Others");
      if (alone.some(u => u.mixed)) b.S.units = fold(b.S.units, 1, likeS.slice(1), keep, named, null);
    }
    b.L.units = fold(L, b.L.cap, likeL, keep, named, "Mana");
    // Creatures sharing a pile is the last resort: by then no noncreature lies alone on the page, legendary or not. Lone
    // ones fold into their likes ("Lands" takes a legendary land), and only then into one mixed pile.
    if (b.C.units.some(u => u.mixed)) {
      const cmdr = u => u.lands || u.rep.commander, lone = us => us.some(u => u.ids.length === 1 && !cmdr(u));
      const tighten = (us, likes, mixed) => {
        while (us.length > 1 && lone(us)) { const n = us.length; us = fold(us, n - 1, likes, cmdr, named, mixed); if (us.length === n) break; }
        return us;
      };
      const non = b.S.units.filter(u => u.role === "support");
      b.S.units = tighten(non, likeS.slice(1), "Others").concat(b.S.units.filter(u => u.role !== "support"));
      b.L.units = tighten(b.L.units, likeL, "Mana");
    }
    // In combat, what doesn't fight stays as it was: each pile keeps its key, its place and the rest of its cards while
    // its fighters step out to the middle (targets), and the page folds afresh only when something arrives or the fight
    // is over.
    const fighters = C.filter(u => u.fight);
    if (fighters.length && !fresh && prev.C.units) {
      const bands = ["C", "S", "L"], was = new Set(bands.flatMap(k => (prev[k].units || []).flatMap(u => u.ids))), now = new Set([C, S, L].flat().flatMap(u => u.ids));
      const out = new Set(fighters.flatMap(u => u.ids));
      if ([...now].every(id => was.has(id))) {
        if (prev.host && !host) { host = true; fitRows(); }   // (its support row still holds creatures, at their size)
        bands.forEach(k => {
          b[k].units = (prev[k].units || []).map(u => {
            const ids = u.ids.filter(id => now.has(id) && !out.has(id));
            if (ids.length === u.ids.length || !ids.length) return ids.length && { ...u };   // (a copy: seating it mustn't move the last fit's)
            return holding(u, ids);
          }).filter(u => u && !u.fight);
        });
        // A fighter that keyed the pile it left (its first card) steps out under its own key: the pile keeps its own.
        const kept = new Set(bands.flatMap(k => b[k].units.map(u => u.key)));
        b.C.units.push(...fighters.map(u => (kept.has(u.key) ? { ...u, key: "f" + u.ids[0] } : u)));
      }
    }
    // Each in its place: where it was at the last fit. Places count from the row's middle out, alternating sides, so the
    // same row and the same place in it keep a card's side and order even when the rows hold more or fewer places.
    order.forEach(k => {
      const B = b[k], B0 = prev && prev[k], had = B0 && B0.units && B0.perRow ? new Map() : null;
      if (had) B0.units.forEach(u => { const j = u.at % B0.perRow; if (j < B.perRow) had.set(u.key, Math.floor(u.at / B0.perRow) * B.perRow + j); });
      // A pile that opens leaves the card that showed on top in its place, and the others come out from under it: never
      // another face swapped onto the same spot.
      if (had) B0.units.forEach(u => {
        // (A fighter stepping out of it isn't the pile opening: it fights in the middle, and the pile keeps its place.)
        const top = u.ids.length > 1 && had.has(u.key) && B.units.find(v => v.ids.includes(u.top != null ? u.top : u.rep.id));
        if (!top || top.key === u.key || top.fight) return;
        const i = had.get(u.key); had.delete(u.key); had.set(top.key, i);
      });
      seatPlaces(B.units, B.perRow, B.cap, had);
    });
    D = Math.max(me ? 6 : 5.6, D);
    const { place = null, w: backW = 0 } = me ? {} : backBand();
    // How far a band's units reach toward `side` (±1) from the page's centre line, to the outside of their places.
    const reach = (B, side, row = null) => Math.max(0, ...B.units.filter(u => row == null || Math.floor(u.at / B.perRow) === row).map(u => side * rowU(B, u.at) + B.s * B.per / 2));
    // Their well lies just past the outer end of their first support row (in its middle while they have none).
    if (b.L.n && !me) {
      const B = b.S, zs = zoneSide(pid), row0 = B.units.some(u => u.at < B.perRow);
      b.L.u = row0 ? -zs * (reach(B, -zs, 0) + 0.3 + b.L.s * CW / 2) : 0;   // clear of its sign, a little wider than the card
      if (!fresh && row0 && prev.L.n && prev.L.u * b.L.u > 0) b.L.u = zs * Math.min(zs * b.L.u, zs * prev.L.u);   // and never draws in when one goes
    }
    // The page: as wide as its rows, its well and its back band reach from its centre, as deep as its bands, never past
    // its slot (and, while it holds its rows, never narrower than it was).
    const need = Math.max(...order.map(k => b[k].n ? 2 * (Math.max(reach(b[k], 1), reach(b[k], -1)) + SIDE) : 0), !me && b.L.n ? 2 * (Math.abs(b.L.u) + b.L.s * CW / 2 + SIDE) : 0, me ? 12 : backW, fresh ? 0 : prev.W);
    return { ...b, host, W: Math.min(r.w, need), D: Math.min(r.d, D), deep: needD, over, fed: C.length + S.length + L.length, back, back0, place, plateA: me ? 0 : Math.min(b.plateA, D - PLATE_IN, r.d - PLATE_IN) };
  }
  // A unit of the last fit holding only `ids` now, its top card kept while it is still there, and its title said again
  // from what it holds: the one name they share, "Tokens", the one kind ("Planeswalkers 2"), or else its own word.
  function holding(u, ids) {
    const cs = ids.map(id => P.card(id)), rep = ids.includes(u.rep.id) ? u.rep : cs[0];
    u = { ...u, top: ids.includes(u.top) ? u.top : undefined };
    if (!u.title || ids.length < 2) return { ...u, ids, rep, title: undefined, mixed: false };
    const kind = c => P.typeLine(c).split("—")[0].replace(/Legendary|Snow|Basic|Token/g, "").trim().split(" ").pop() + "s";
    const one = f => (new Set(cs.map(f)).size === 1 ? f(cs[0]) : null), name = one(c => P.name(c));
    const word = name || (cs.every(c => c.token) && "Tokens") || one(kind) || u.title.replace(/\s*\d+$/, "");
    return { ...u, ids, rep, title: `${word} ${ids.length}`, mixed: !name };
  }
  // The last fit held while cards leave its page: each unit keeps its key and place, holding only its cards still on the
  // board (`now`). A card new to the board joins the unit a copy of it stands in, or else stands in a free place
  // (seatGuest). Null unless every card on the page (`cur`) is held exactly once and each fighter stands on its own.
  function holdFit(prev, plan, cur, now, me) {
    // (Its back band is the new fit's, which a new pile may widen: the page widens with it, so the pile lies on it.)
    const kept = { ...prev, place: plan.place, back0: plan.back0, W: Math.max(prev.W, plan.W), held: true }, at = new Map();
    ["C", "S", "L"].forEach(k => (kept[k] = { ...prev[k], units: (prev[k].units || []).map(u => {
      const ids = u.ids.filter(id => now.has(id));
      const v = !ids.length ? null : ids.length === u.ids.length ? { ...u, rep: P.card(u.rep.id) } : holding(u, ids);
      if (v) ids.forEach(id => at.set(id, v));
      return v;
    }).filter(Boolean) }));
    for (const u of cur) {
      const out = u.ids.filter(id => !at.has(id)), host = u.ids.map(id => at.get(id)).find(Boolean);
      if (!out.length) continue;
      if (host) { Object.assign(host, holding(host, host.ids.concat(out))); out.forEach(id => at.set(id, host)); }
      else if (seatGuest(kept, { ...u, ids: out }, me)) out.forEach(id => at.set(id, u));
      else return null;
    }
    const all = ["C", "S", "L"].flatMap(k => kept[k].units.flatMap(u => u.ids));
    if (all.length !== new Set(all).size || all.length !== now.size) return null;
    if (cur.some(u => u.fight && !kept.C.units.some(v => v.ids.length === u.ids.length && u.ids.every(id => v.ids.includes(id))))) return null;
    const count = q => ["C", "S", "L"].reduce((t, k) => t + (q[k].units || []).length, 0);
    kept.fed = prev.fed - count(prev) + count(kept);   // (what was folded away stays folded)
    return kept;
  }
  // Which side of the plaque a seat's piles and commander go: toward the table's middle for the side seats, so they never
  // leave the screen; the left for across; the right for me.
  const zoneSide = pid => (pid === P.ME ? 1 : BASE[pid].x > 0 ? -1 : BASE[pid].x < 0 ? 1 : -1);
  // Fold units into `cap` places, in intent's order: like cards fan into a named pile, the narrowest likeness first (the
  // same name, then the same kind), the largest group first and only as many groups as needed; then the row ends in a
  // mixed pile titled for what it holds ("Creatures 31"), never one card's name. Legendary and commander cards stay out of
  // piles as long as anything else can fold. A pile keeps the place of the first of its cards to arrive.
  // A creature in combat (`fight`) is never folded: it fights in the open middle (targets), and the rest fold into the
  // places left, its own place kept empty for it to come back to.
  function fold(units, cap, likes, keep, named, mixed) {
    const fight = units.filter(u => u.fight);
    if (fight.length) {
      const others = units.filter(u => !u.fight), rest = fold(others, Math.max(1, cap - fight.length), likes, keep, named, mixed);
      return rest.length === others.length ? units : rest.concat(fight);
    }
    units = units.slice();
    for (const like of likes) {
      if (like.whole && units.length > cap && mixed) {   // (all or nothing: see likeC)
        const all = fold(units, cap, [like], keep, named, null);
        if (all.length <= cap) units = all;
        continue;
      }
      while (units.length > cap) {
        const by = new Map();
        units.forEach(u => { const k = !keep(u) && like(u); if (k) by.set(k, (by.get(k) || []).concat([u])); });
        const best = [...by.entries()].filter(([, us]) => us.length > 1).sort((x, y) => y[1].length - x[1].length)[0];
        if (!best) break;
        const [k, us] = best, at = units.indexOf(us[0]), ids = us.flatMap(u => u.ids);
        const pile = named(us, `${k} ${ids.length}`);
        if (new Set(ids.map(id => (P.card(id) || {}).card)).size > 1) pile.mixed = true;   // ("Tokens 9": unlike cards all the same)
        units = units.filter(u => !us.includes(u)); units.splice(at, 0, pile);
      }
    }
    if (units.length > cap && mixed) {                // (none: like cards only)
      // What stays out of it says the most: the kept cards, then the largest piles of like creatures ("Beast 9" names nine),
      // then the rest in the order they came. The mixed pile takes what is left, so it hides as few creatures as it can.
      const weight = u => (u.role === "creature" ? u.ids.length : 1);
      const room = Math.max(0, cap - 1), rank = units.filter(keep).concat(units.filter(u => !keep(u)).sort((x, y) => weight(y) - weight(x)));
      const chosen = new Set(rank.slice(0, room)), shown = units.filter(u => chosen.has(u));
      const rest = units.filter(u => !shown.includes(u));
      units = shown.concat([{ ...named(rest, `${mixed} ${rest.reduce((t, u) => t + u.ids.length, 0)}`), mixed: true }]);
    }
    return units;
  }

  // ---- Build and lay out the board ----------------------------------------------------------------------------------
  let pieces = {}, plans = {};                      // key → { obj, pid, role, ids }; seat → its fit (fitSeat)
  let settleAt = 0, refitT = 0;                     // until when cards are still leaving; the re-fit waiting for them
  let cardsWas = {};                                // the cards as the last view had them: a token that ceases to exist is no longer in the view
  const flying = new Set();                         // cards on their way to a graveyard or exile, across rebuilds, until they land (a cut lands them all)
  const lifeWas = {};                               // each player's life at the last build
  // A piece's signature: everything about its look. A rebuild keeps a piece whose signature hasn't changed, so its
  // effects keep running and nothing restarts; only what changed is built again.
  function pieceSig(role, ids) {
    const marks = H.marks || {};
    return [role, ids.join(","), ids.map(id => { const c = P.card(id); return c ? faceKey(c) + "|" + ((marks.cards && marks.cards[id]) || "") + "|" + c.controller + "|" + P.attachments(id).map(a => faceKey(a)).join() : ""; }).join(";")].join("#");
  }
  function plateSig(p) {
    const marks = H.marks || {}, cmd = P.card(p.commander[0]);
    return ["plate", p.name, p.life, p.monarch, G.active === p.id, G.priority === p.id, (marks.players && marks.players[p.id]) || "", cmd ? faceKey(cmd) + cmd.zone + ((marks.cards && marks.cards[cmd.id]) || "") : ""].join("|");
  }
  const STATS = { builds: 0, built: 0, reused: 0 };
  function buildBoard(ms = 0) {
    STATS.builds++; const built0 = STATS.built;
    const gone = cardsWas, cardOf = id => P.card(id) || gone[id]; cardsWas = { ...G.cards };
    const oldPieces = pieces, oldStack = stackG ? stackG.children.filter(m => m.userData.pick).map(m => ({ m, id: m.userData.pick.id, key: m.userData.stackKey })) : [];
    const was = {};                                 // card id → the pose its piece had, so a rebuild animates
    Object.values(pieces).forEach(pc => pc.ids.forEach(id => (was[id] = { pos: pc.obj.position.clone(), s: pc.obj.scale.x, fade: pc.obj.userData.fade || 0, role: pc.role, n: pc.ids.length, under: pc.ids.length > 1 && pc.obj.userData.top != null && pc.obj.userData.top !== id })));
    Object.entries(pieces).forEach(([k, pc]) => { if (pc.role === "plate" || pc.role === "floor" || pc.role === "zone") was[k] = { pos: pc.obj.position.clone(), s: pc.obj.scale.x }; });
    // A spell that resolves onto the table is the same card coming down: its permanent starts as large as it stood on the
    // stack, its face where the stack card's face was (a standee's face rises from its foot).
    oldStack.forEach(o => { if (!was[o.id]) was[o.id] = { pos: o.m.position.clone().add(new T.Vector3(0, -Math.cos(PITCH), Math.sin(PITCH)).multiplyScalar(CH * o.m.scale.x / 2)), s: o.m.scale.x, fade: 0, fromStack: true }; });
    // What leaves the battlefield or the stack (dies, is exiled, bounced, resolves into a graveyard) flies to where it now rests.
    const onBoard = id => G.cards[id] && G.cards[id].zone === "battlefield", onStack = id => G.stack.some(st => st.card === id), stays = o => G.stack.some(st => stackKey(st) === o.key);
    const leaving = [], remnants = new Map();      // remnants: a whole pile leaving, kept in place while its cards wait their turn
    if (!ms) flying.clear();
    if (ms) {
      Object.values(oldPieces).forEach(pc => { if (pc.role !== "zone" && pc.ids.length === 1 && !onBoard(pc.ids[0]) && !onStack(pc.ids[0])) leaving.push({ obj: pc.obj, id: pc.ids[0], pid: pc.pid }); });   // zone piles hold cards that are never on the board
      // (An ability's card is its source, still on the table: the ability itself resolves where it stands.)
      oldStack.forEach(o => { if (!stays(o) && (!onBoard(o.id) || o.m.userData.ability)) leaving.push({ obj: o.m, id: o.id, pid: o.m.userData.owner, ability: o.m.userData.ability }); });
      leaving.forEach(l => { l.obj.parent.remove(l.obj); scene.add(l.obj); });
      // A pile that only loses some of its cards stays; each card it lost leaves it as itself, from the pile, as it lay, and
      // is seen only from its own turn to go. A pile that goes whole stays where it was, counting the cards still waiting
      // (a remnant), and gives up one card at a time until the last takes its place, so it never travels as a block and
      // each can be counted. (Every card that leaves goes, whether or not the new view still shows it.)
      Object.values(oldPieces).forEach(pc => {
        if (pc.role === "zone" || pc.ids.length < 2) return;
        const off = pc.ids.filter(id => !onBoard(id) && !onStack(id) && cardOf(id));
        if (!off.length) return;
        const rem = off.length === pc.ids.length ? { obj: pc.obj, waiting: new Set(off) } : null;
        if (rem) remnants.set(pc.obj, rem);
        off.forEach(id => {
          const c = cardOf(id), stand = pc.obj.userData.kind === "standee", o = stand ? standee(c, [id]) : flat(c);
          o.position.copy(pc.obj.position); o.scale.copy(pc.obj.scale); o.visible = false;
          if (stand) o.userData.pivots.forEach(pv => (pv.rotation.x = pc.obj.userData.pivots[0].rotation.x));
          else if (pc.obj.userData.tilt) o.userData.tilt.rotation.x = pc.obj.userData.tilt.rotation.x;
          scene.add(o); leaving.push({ obj: o, id, pid: pc.pid, pile: rem || true });
        });
      });
    }
    const leavingObjs = new Set(leaving.map(l => l.obj));
    // Permanents bound for the same pile set off one after another, so each can be followed into it (a wipe is many trips,
    // not one clump); each clears its page at once and waits just above it for its turn.
    const trips = {};
    leaving.forEach(l => { if (!l.ability && !oldStack.some(x => x.m === l.obj)) { const c = P.card(l.id), k = c ? c.owner + c.zone : l.pid; (trips[k] = trips[k] || []).push(l); } });
    Object.values(trips).forEach(ls => ls.forEach((l, n) => (l.wait = n * Math.min(140, 700 / ls.length))));
    const lastOff = Math.max(0, ...leaving.map(l => l.wait || 0));
    if (leaving.length) settleAt = performance.now() + 80 + lastOff + Math.max(450, ms);   // when the last of them lands (below)
    // A spell resolved: the hand waits for it to land (syncOverlay), as long as its flight takes and no longer; a cut waits for nothing.
    handAt = !ms ? 0 : oldStack.some(o => !stays(o)) ? performance.now() + Math.max(450, ms) : handAt;
    const settling = performance.now() < settleAt;
    let refit = false;
    clearTimeout(refitT);
    if (!root) { root = new T.Group(); scene.add(root); }
    pieces = {}; halos.length = 0;
    const reused = {};
    actionable = new Set(G.actionable || []);
    SEATS.forEach(p => {
      const bf = P.battlefield(p.id).filter(c => !c.attachedTo);
      const isCreature = c => P.isCreature(c);
      // Lands that do more than make mana (a Moon keeping a creature's abilities) stand with the other permanents; a land
      // whose only clause is about how it enters (Mystic Sanctuary) is still a land.
      const special = c => P.isLand(c) && (!!c.copyOf || /\b(Whenever|At the beginning)\b/.test((P.face(c) || {}).text || ""));
      // A rock taps for mana itself, whatever word heads the ability (Mox Opal's "Metalcraft —"); an Equipment that grants
      // mana (Paradise Mantle) is a permanent like any other.
      const rock = c => P.isMana(c) && /(^|\n|— )\{T\}[^:\n]*: Add/.test((P.face(c) || {}).text || "");
      const isMana = c => !special(c) && (P.isLand(c) || rock(c) || (c.token && /Treasure/.test(c.card)));
      // Keep the old piece when nothing about it changed; build it otherwise.
      const add = (key, build, role, ids, sig = pieceSig(role, ids)) => {
        const old = oldPieces[key];
        let obj;
        if (old && old.sig === sig && !leavingObjs.has(old.obj)) { obj = old.obj; reused[key] = true; STATS.reused++; }
        else { obj = build(); root.add(obj); STATS.built++; }
        pieces[key] = { obj, pid: p.id, role, ids, sig }; obj.userData.faces = facesOf(obj);
      };
      // A seat's units, in the order they came to the table (the commander first), so a card that stays keeps its place
      // and a new one joins at the end of its row: creatures and planeswalkers (C), other permanents (S), my wells (L).
      const arrived = (a, b) => (b.commander - a.commander) || (a.id - b.id);
      const unit = (prefix, g, role) => ({ key: prefix + g.ids[0], ids: g.ids, rep: g.rep, role });
      // A creature in combat leaves its pile while it fights (and stays out of any fold), so a pile never attacks, blocks or
      // dies as a whole; the rest of the pile keeps its place.
      const fighting = new Set(G.combat ? G.combat.attackers.map(a => a.id).concat(G.combat.blockers.map(b => b.id)) : []);
      const C = [...P.groups(bf.filter(isCreature).sort(arrived)).flatMap(g => {
        const f = g.ids.filter(id => fighting.has(id)), rest = g.ids.filter(id => !fighting.has(id));
        if (!f.length || g.ids.length === 1) return [{ ...unit("c", g, "creature"), fight: !!f.length }];
        return [...(rest.length ? [{ ...unit("c", { ids: rest, rep: P.card(rest[0]) }, "creature"), key: "c" + g.ids[0] }] : []), ...f.map(id => ({ ...unit("f", { ids: [id], rep: P.card(id) }, "creature"), fight: true }))];
      }),
        ...bf.filter(c => P.isPW(c)).sort(arrived).map(c => unit("w", { ids: [c.id], rep: c }, "walker"))];
      const S = P.groups(bf.filter(c => !isCreature(c) && !P.isPW(c) && !isMana(c)).sort(arrived)).map(g => unit("s", g, "support"));
      const mana = bf.filter(isMana).sort(arrived), L = [];
      if (p.id === P.ME) {                          // mine: a well per kind of land
        const byName = new Map();
        mana.slice().sort((a, b) => P.isLand(b) - P.isLand(a)).forEach(c => byName.set(c.card, (byName.get(c.card) || []).concat([c])));
        byName.forEach(cs => { cs.sort((a, b) => !!a.tapped - !!b.tapped); L.push(unit("m", { ids: cs.map(c => c.id), rep: cs[0] }, "mana")); });   // untapped first: a tap reaches one that can act
      } else if (mana.length) L.push({ key: "m" + p.id, ids: mana.map(c => c.id), rep: mana.find(P.isLand) || mana[0], role: "mana", lands: true });   // theirs: one well, at the end of their support row
      // A pile whose first card has gone is still the same pile: it keeps the key it had (a unit's key is its first card's),
      // so it keeps its place and its piece, and its other cards never turn up as a new pile beside the old one.
      if (plans[p.id]) {
        const old = new Map(), used = new Set([C, S, L].flat().map(u => u.key));
        ["C", "S", "L"].forEach(k => (plans[p.id][k].units || []).forEach(u => u.ids.forEach(id => old.set(id, u.key))));
        [C, S, L].flat().forEach(u => {
          if (u.fight || old.get(u.ids[0]) === u.key) return;
          const was = u.ids.map(id => old.get(id)).find(k => k && k[0] === u.key[0] && !used.has(k) && !bf.some(c => c.id === +k.slice(1)));
          if (was) { used.add(was); u.key = was; }
        });
      }
      // What doesn't fit its page at the floor sizes folds (fitSeat, fold); then each unit is built.
      // A page holds its shape while cards leave it (fitSeat). Where holding would cost room (a deeper page, or folding more
      // than it did when a fresh fit wouldn't) it fits afresh, but never while cards are still leaving: then the page holds,
      // what arrives meanwhile stands in a place the leavers left free (seatGuest), and the page re-fits once they have
      // landed (refit), so nothing that stayed moves with the cards going and nothing that came is out of sight.
      const args = { C, S, L, rock, nz: ["graveyard", "exile"].filter(z => (p[z] || []).length).length, cmd: (P.card(p.commander[0]) || {}).zone === "command", settling };
      const units = q => q.C.units.length + q.S.units.length + q.L.units.length, folded = q => q.fed - units(q), prev = plans[p.id];
      let plan = fitSeat(p.id, args);
      // While cards of this page are leaving it, everything that stays keeps its place and its pile, as it was (a pile
      // only loses the cards that went); a newcomer stands in a free place meanwhile, and the page re-fits once they
      // have landed. Its back band makes room for a new pile at once, so what leaves flies to where it will lie.
      const now = new Set([...C, ...S, ...L].flatMap(u => u.ids));
      // (A rebuild while they are still on their way, held already, holds on.)
      const lost = settling && prev && (prev.held || ["C", "S", "L"].some(k => (prev[k].units || []).some(u => u.ids.some(id => !now.has(id)))));
      const kept = lost && holdFit(prev, plan, [...C, ...S, ...L], now, p.id === P.ME);
      if (kept) { plan = kept; refit = true; }
      if (plan !== kept && prev && (plan.over || folded(plan) > folded(prev))) {
        const loose = fitSeat(p.id, args, false);
        if (plan.over || units(loose) > units(plan)) {
          const had = new Set(["C", "S", "L"].flatMap(k => (prev[k].units || []).flatMap(u => u.ids))), stayed = u => u.ids.some(id => had.has(id));
          const held = settling && fitSeat(p.id, { ...args, C: C.filter(stayed), S: S.filter(stayed), L: L.filter(stayed) });
          // (A newcomer with no free place anywhere doesn't wait out of sight: then the page fits afresh at once.)
          if (held && [...C, ...S, ...L].filter(u => !stayed(u)).every(u => seatGuest(held, u, p.id === P.ME))) { plan = held; refit = true; }
          else plan = loose;
        }
      }
      plans[p.id] = plan;
      // Each unit is built as what it is, whichever band holds it.
      [...plan.C.units, ...plan.S.units, ...plan.L.units].forEach(u => {
        const mine = p.id === P.ME, sig = pieceSig(u.role, u.ids) + "|" + (u.title || "");
        if (u.role === "creature" || u.role === "walker") return add(u.key, () => standee(u.rep, u.ids, u.title), u.role, u.ids, sig);
        if (u.role === "support") return add(u.key, () => (u.title ? pileOf(u.ids, u.title, mine ? { fan: true, sign: u.title } : { tag: u.title })
          : u.ids.length > 1 ? pileOf(u.ids, shortName(u.rep), mine ? { sign: `${shortName(u.rep)} ×${u.ids.length}` } : {}) : flat(u.rep)), u.role, u.ids, sig);
        // Every well says what it is; a pile says how many, and how many of them are tapped under the name.
        if (u.lands) {                              // theirs: its count on it, large enough to read across the table; which sources they are is a tap away
          // (What else makes their mana, by what it is: rocks, and Treasures, which are spent once.)
          const lands = u.ids.filter(id => P.isLand(P.card(id))).length, tr = u.ids.filter(id => /Treasure/.test(P.card(id).card)).length, rocks = u.ids.length - lands - tr;
          const more = [rocks && `${rocks}${tr ? "" : " mana"} rock${rocks > 1 ? "s" : ""}`, tr && `${tr} Treasure${tr > 1 ? "s" : ""}`].filter(Boolean);
          return add(u.key, () => well(u.ids, u.rep, { sign: `Lands ${lands}`, sub: more.length ? `+ ${more.join(" · ")}` : null, col: COLORS[p.id], title: "Lands", onCard: true }), "mana", u.ids);
        }
        const tapped = u.ids.filter(id => P.card(id).tapped).length, n = u.ids.length;
        const sign = u.title || shortName(u.rep) + (n > 1 ? ` ×${n}` : ""), sub = tapped ? (n > 1 ? `${tapped} tapped` : "tapped") : null;
        add(u.key, () => well(u.ids, u.rep, { sign, sub, signAt: 0.4, title: u.title }), "mana", u.ids, sig);
      });
      // (Which card shows on top of each, so a pile that opens can leave that one in its place: fitSeat.)
      [...plan.C.units, ...plan.S.units, ...plan.L.units].forEach(u => { if (pieces[u.key]) u.top = pieces[u.key].obj.userData.top; });
      add("plate" + p.id, () => banner(p), "plate", [], plateSig(p));
      // Graveyard and exile lie beside the plate, so what can be cast or activated from them is a tap away.
      ["graveyard", "exile"].forEach(z => {
        const ids = p[z] || [];
        if (!ids.length) return;
        add("z" + z + p.id, () => zonePile(p.id, z, ids, new Set(ids.filter(id => flying.has(id) || leaving.some(l => l.id === id)))), "zone", ids.slice(), "zone|" + z + "|" + ids.join(",") + "|" + (p[z] || []).map(id => { const c = P.card(id); return c ? faceKey(c) : ""; }).slice(-1));
      });
      add("floor" + p.id, () => {
        // The page in three layers on one sliced plane (slicePage): the vellum, cut to the page's ragged edge; its ruled
        // border and mounts; and the turn's edge, its own layer so it fades rather than being drawn in.
        const r = BASE[p.id], vel = vellumTex(p.id === P.ME), geo = new T.PlaneGeometry(1, 1, 3, 3);
        geo.setAttribute("uv1", geo.attributes.uv.clone());
        const floor = new T.Mesh(geo, new T.MeshStandardMaterial({ map: vel.map, normalMap: vel.normal, normalScale: new T.Vector2(0.5, 0.5), alphaMap: pageTex(p.id, "mask", r.w, r.d), roughness: 0.95, transparent: true, depthWrite: false }));
        floor.receiveShadow = true; floor.renderOrder = -1;
        floor.rotation.x = -Math.PI / 2; floor.position.y = 0.003;
        const layer = (kind, order, z) => { const m = new T.Mesh(geo, new T.MeshStandardMaterial({ map: pageTex(p.id, kind, r.w, r.d), roughness: 0.95, transparent: true, depthWrite: false })); m.receiveShadow = true; m.renderOrder = order; m.position.z = z; floor.add(m); return m; };
        floor.userData.ink = layer("ink", -0.7, 0.0005);
        const glow = floor.userData.glow = layer("glow", -0.5, 0.001); glow.material.opacity = G.active === p.id ? 1 : 0;
        floor.userData.tw = r.w; floor.userData.td = r.d;
        const fl = new T.Group(); fl.add(floor); fl.userData.floor = floor;
        return pickable(fl, { type: "seat", pid: p.id });
      }, "floor", [], "floor");
    });
    // What no new piece took over goes; one whose cards all went into another piece (a pile they fold into, a pile a
    // fighter rejoins) first flies into it (below), so a fold is seen.
    const into = [];
    Object.entries(oldPieces).forEach(([k, pc]) => {
      if (reused[k] || leavingObjs.has(pc.obj)) return;
      if (remnants.has(pc.obj)) { root.remove(pc.obj); scene.add(pc.obj); return; }
      const nk = ms && pc.role !== "zone" && pc.ids.length ? Object.keys(pieces).find(kk => kk !== k && pieces[kk].role !== "zone" && pieces[kk].ids.includes(pc.ids[0])) : null;
      root.remove(pc.obj);
      if (nk && pc.ids.every(id => pieces[nk].ids.includes(id))) { scene.add(pc.obj); into.push([pc.obj, nk, pc.ids]); } else dispose(pc.obj);
    });
    // Taps: every mesh of a pickable piece but what lies over things or round them (signs, chips, shadows, ash, a well's
    // light, embers): those never take a tap from the card or pile under them.
    picks.length = 0;
    Object.values(pieces).forEach(pc => pc.obj.traverse(o => {
      if (!o.isMesh || o.userData.noPick) return;
      for (let q = o; q && q !== root; q = q.parent) { if (q.userData.fxRoot || q.userData.noPick) return; if (q.userData.pick) { picks.push(o); return; } }
    }));
    const plateAt = pid => (was["plate" + pid] ? was["plate" + pid].pos.clone().add(new T.Vector3(0, 0.6, 0)) : new T.Vector3(0, 1, -6));
    // A card put on the stack comes from my hand (lifting out of its own slot, still drawn there until the hand is next
    // drawn), from where it stood, or from its caster's plate.
    const handSlot = id => {
      const h = handBox && (handBox.querySelector(`.hcard[data-id="${id}"]`) || handBox), b = h && h.getBoundingClientRect(), u = uPx();   // or, already drawn out of it, from the hand
      return b && b.width ? tableAt((b.left + b.right) / 2 / u, (b.top + b.bottom) / 2 / u, 2) : null;
    };
    buildStack(G.stack.length, s => (oldStack.some(o => o.key === stackKey(s)) ? null
      : was[s.card] && !was[s.card].fromStack ? was[s.card].pos.clone().add(new T.Vector3(0, 0.8, 0))
      : s.controller === P.ME ? handSlot(s.card) || new T.Vector3(0, 2, 8.5) : plateAt(s.controller)), ms);
    // Where a card that left comes to rest: lying on top of its pile (graveyard or exile, as the view now says) at the
    // pile's own size; into my hand; to a library, an opponent's hand or the command zone, at its owner's plate. Where the
    // view doesn't say (the card is in no zone it shows), to its owner's graveyard, where most things go: on the pile, or
    // where the pile will lie, beside their plaque on its piles' side, at a pile's size.
    const laid = leaving.length ? targets() : null, poses = laid ? laid.out : {};
    // On top of a pile (an opponent's is propped up from its near edge by `lean`): where its top card's middle and its near
    // edge (`foot`) are.
    const onPile = (t, n, lean = 0) => {
      const h = t.s * (n * 0.0075 + TH), half = t.s * CH / 2, c = Math.cos(lean), s = Math.sin(lean);
      return { pos: t.pos.clone().add(new T.Vector3(0, h * c + half * s, half * (1 - c) + h * s)), foot: t.pos.clone().add(new T.Vector3(0, h * c, half + h * s)), s: t.s, flat: true, lean };
    };
    const restOf = (c, pid) => {
      const owner = c ? c.owner : pid || P.ME, z = c && c.zone, t = (z === "graveyard" || z === "exile") && poses["z" + z + owner];
      if (t) return onPile(t, ((P.player(owner) || {})[z] || []).length, owner === P.ME ? 0 : PILE_LEAN);
      if (z === "hand" && owner === P.ME) return { pos: new T.Vector3(0, 0.5, 9), s: 0.5 };
      if (c && z !== "stack") return { pos: plateAt(owner), s: 0.3 };
      const g = poses["zgraveyard" + owner], pl = poses["plate" + owner], r = laid && laid.R[owner];
      if (g) return onPile(g, ((P.player(owner) || {}).graveyard || []).length, owner === P.ME ? 0 : PILE_LEAN);
      if (pl && r) {
        const side = owner === P.ME ? 1 : r.x > 0 ? -1 : r.x < 0 ? 1 : -1;
        return onPile({ pos: pl.pos.clone().add(new T.Vector3(Math.cos(r.yaw), 0, -Math.sin(r.yaw)).multiplyScalar(side * 3.4 * pl.s)), s: pl.s * 0.7 }, 0);
      }
      return { pos: plateAt(owner), s: 0.3 };
    };
    // Within a trip the one nearest where they go sets off first, so none passes over another still waiting its turn.
    Object.values(trips).forEach(ls => {
      const d = l => l.obj.position.distanceTo(restOf(P.card(l.id), l.pid).pos), ws = ls.map(l => l.wait).sort((a, b) => a - b);
      ls.map(l => [l, d(l)]).sort((a, b) => a[1] - b[1]).forEach(([l], n) => (l.wait = ws[n]));
    });
    // A card leaving a pile shows from its turn to go: then the remnant it leaves counts one fewer, and is gone with the last.
    const depart = l => {
      l.obj.visible = true;
      const r = l.pile; if (!r || r === true || !r.waiting.delete(l.id)) return;
      if (r.waiting.size) retitle(r.obj, [...r.waiting]); else { scene.remove(r.obj); dispose(r.obj); }
    };
    leaving.forEach(l => {
      const c = P.card(l.id), o = l.obj, from = o.position.clone(), s0 = o.scale.x, spell = oldStack.some(x => x.m === o);
      if (!c && !spell && (gone[l.id] || {}).token) {
        // A token that leaves ceases to exist: it has no pile to be reviewed in, so it burns out in its turn among the others
        // leaving, rising clear of where it stood (and of any pile it left) as it goes, rather than flying to a pile it never reaches.
        const wait = (l.wait || 0) + 80, total = wait + 450, rise = l.pile ? CH * s0 * 0.5 : 0.25; let lit = false;
        return tween(total, (e, k) => {
          const t = k * total; if (t < wait) return;
          if (!lit) { lit = true; depart(l); SeatFX.burst(o, colorsOf(gone[l.id]), { ms: 450, n: 120, spread: 1.0 }); }
          const q = (t - wait) / (total - wait); o.scale.setScalar(s0 * (1 - q * q)); o.position.y = from.y + Math.sqrt(q) * rise;
        }).then(() => { scene.remove(o); dispose(o); });
      }
      if (l.ability) {
        // An ability goes nowhere: it flares and draws in where it stood, its crackle going out, so its end is seen.
        SeatFX.burst(o, colorsOf(c), { ms: 400, n: 120, spread: 1.2 });
        // (Most of the way gone by the time what it made sets off from where it stood: joins, below.)
        return tween(Math.max(450, ms), (e, k) => { o.scale.setScalar(s0 * Math.pow(1 - k, 2)); }).then(() => { scene.remove(o); dispose(o); });
      }
      // It flies to where it rests and lands there flat, turning as it goes, its fire going out as it starts. A spell sheds
      // its crackle; a permanent its ash and embers. Its card face stays, so you can follow it.
      // (One the view no longer shows, a card gone to a hidden hand or library, goes to its owner's plate, as those do: never
      // to a graveyard it isn't in. One leaving a pile rises clear of it first.)
      const lost = !c && !spell && gone[l.id], rest = lost ? { pos: plateAt(lost.owner), s: 0.3 } : restOf(c, l.pid);
      const up = from.clone().add(new T.Vector3(0, spell ? 0 : l.pile ? 0.15 + CH * s0 * 0.4 : 0.15, 0)), q0 = o.quaternion.clone(), q1 = new T.Quaternion();
      if (c && (c.zone === "graveyard" || c.zone === "exile")) flying.add(l.id);
      const kind = o.userData.kind, to = rest.pos.clone();
      if (rest.flat) {
        const lean = rest.lean || 0;
        if (spell) q1.setFromEuler(new T.Euler(-Math.PI / 2 + lean, 0, 0));
        else if (kind === "standee") { q1.setFromEuler(new T.Euler(-(Math.PI / 2 - PITCH) + lean, 0, 0)); if (rest.foot) to.copy(rest.foot); else to.z += CH / 2 * rest.s; }   // its lean back, the rest of the way down, its foot at the pile's near edge
      } else q1.copy(q0);
      const fx = []; o.traverse(q => { const m = q.material; if ((q.isMesh || q.isPoints) && m && !(m.userData && (m.userData.dim || m.userData.cardPart)) && !Object.values(MAT).includes(m)) fx.push(q); });
      if (spell) SeatFX.burst(o, colorsOf(c), { ms: 400, n: 120, spread: 1.2 });   // a spell flares as it resolves (after fx is listed: the flare isn't put out with the crackle)
      // Whatever leaves is gone the moment the view says so: it comes off its place at once (a permanent just clears the
      // page, 80 ms) and is on its way, its fire going out as it starts, so the table never shows a card the log has
      // already sent away. A standing one arcs over its neighbours' tops rather than rising in place, where it would read as
      // drifting onto the pages behind. A resolving spell leaves fast out of the stack.
      // A permanent bound for a pile lies down and takes the pile's size in the first part of its way, so it travels as a
      // card going into a pile, low over its own page, never as a creature standing on the pages it passes.
      // A spell leaving the stack while it stood up as the focus (far larger than where it goes) sheds that size first, so
      // it never sweeps over the table at it.
      const pile = rest.flat && !spell, big = spell && s0 > 1.5 * rest.s, settle = pile ? 0.55 : big ? 0.4 : 1;
      const lift = spell ? 0 : l.pile ? 160 : 80, out = 200, wait = l.wait || 0, total = lift + wait + (spell ? 450 : Math.max(450, ms)), arc = kind === "standee" && !pile ? CH * s0 * 0.7 : 0.6;
      tween(total, (e, k) => {
        const t = k * total;
        if (t < out) { const q = t / out; fx.forEach(f => { if (f.isPoints) f.material.uniforms.uHdr.value *= 0.8; else { f.material.transparent = true; f.material.opacity = Math.min(f.material.opacity, 1 - q); } }); }
        else fx.forEach(f => (f.visible = false));
        if (l.pile) {                               // from a pile: unseen until its turn, then up off the pile, then away
          if (t < wait) return;
          if (!o.visible) depart(l);
          if (t < wait + lift) { o.position.lerpVectors(from, up, (t - wait) / lift); return; }
        } else if (t < lift + wait) { o.position.lerpVectors(from, up, Math.min(1, t / Math.max(1, lift))); return; }
        const r = (t - lift - wait) / (total - lift - wait), q = spell ? 1 - Math.pow(1 - r, 3) : 1 - Math.pow(1 - r, 2.2);
        o.position.lerpVectors(up, to, q); o.position.y += Math.sin(q * Math.PI) * arc;
        o.scale.setScalar(lerp(s0, rest.s, smooth(pile || big ? 0 : 0.25, settle, q))); o.quaternion.slerpQuaternions(q0, q1, Math.min(1, q / (pile ? settle : 1)));   // it lands at its pile's size, which reads (never under the floors)
      }).then(() => {
        scene.remove(o); dispose(o); flying.delete(l.id);
        const now = P.card(l.id), z = now && pieces["z" + now.zone + now.owner]; if (z && z.obj.userData.arrive) z.obj.userData.arrive(l.id);   // (where the view has it now)
      });
    });
    // Cards that join a pile already on the table arrive at it, every one its own card, one after another, from what made
    // them (the spell or ability that just resolved), my hand or their controller's plate. They come in over the open
    // table in front of the pile, not across the cards beside it, and its count rises as each lands.
    const resolved = oldStack.filter(o => !stays(o)), maker = resolved.length === 1 ? resolved[0] : null;   // what made the newcomers, when only one thing could have
    const joins = ms ? Object.entries(pieces).filter(([k, pc]) => !reused[k] && pc.role !== "zone" && pc.ids.some(id => was[id]) && pc.ids.some(id => !was[id])) : [];
    const goal = joins.length || into.length ? targets().out : null;
    if (joins.length) {
      const camPos = new T.Vector3(CAM.pos.x, CAM.pos.y, CAM.pos.z), middle = new T.Vector3(CAM.at.x, 0, CAM.at.z);
      // One queue across all the piles they join, so no two set off together: the pile gaining fewest first (the one
      // Elemental, then the four Beasts), each card far enough after the last that its face is seen on its own.
      const newIn = pc => pc.ids.filter(id => !was[id]).length, total = joins.reduce((t, [, pc]) => t + newIn(pc), 0), each = Math.min(240, 900 / total);
      let queued = 0;
      joins.slice().sort((a, b) => newIn(a[1]) - newIn(b[1])).forEach(([k, pc]) => {
        const t = goal[k]; if (!t) return;
        const src = maker && maker.m.userData.owner === pc.pid ? maker : null;
        const fresh = pc.ids.filter(id => !was[id]), s = t.s || 1, to = t.pos.clone().add(new T.Vector3(0, CH * s / 2, 0)), n0 = queued;
        queued += fresh.length;
        const via = to.clone().add(middle.clone().sub(t.pos).setY(0).normalize().multiplyScalar(2.2 * s)).setY(to.y + 0.6);   // in front of the pile, toward the table's middle
        const landed = pc.ids.filter(id => was[id]);
        retitle(pc.obj, landed);
        fresh.forEach((id, n) => {
          // (From an ability, once it has mostly drawn in, so its tag and its source's face never lie over the first one.)
          const from = src ? src.m.position.clone() : (pc.pid === P.ME && handSlot(id)) || plateAt(pc.pid), m = cardMesh(P.card(id)), wait = (src && src.m.userData.ability ? 250 : 0) + (n0 + n) * each;
          m.scale.setScalar(0.001); scene.add(m);
          tween(wait + 520, (e, kk) => {
            const q = Math.max(0, (kk * (wait + 520) - wait) / 520), qe = ease(q), a = 1 - qe;
            m.position.set(0, 0, 0).addScaledVector(from, a * a).addScaledVector(via, 2 * a * qe).addScaledVector(to, qe * qe);
            m.scale.setScalar(q > 0 ? lerp(s * 0.8, s, qe) : 0.001); m.lookAt(camPos);
          }).then(() => { scene.remove(m); dispose(m); landed.push(id); retitle(pc.obj, landed); });
        });
      });
    }
    // A piece folding into another flies into it, at its size, and is gone as it reaches it; the pile counts it then.
    into.forEach(([o, nk, n]) => {
      const t = goal[nk], from = o.position.clone(), s0 = o.scale.x, host = pieces[nk];
      if (!t) { scene.remove(o); dispose(o); return; }
      const held = n.length && host.ids.length > n.length ? host.ids.filter(id => !n.includes(id)) : null;
      if (held) retitle(host.obj, held);
      // (Past a neighbour it rises to stand on the row's tops as they lean back, travels along above them and comes down
      // into its pile: so it is never lost behind the cards it passes, and never crosses their faces either.)
      // (A fighter coming home to its pile comes along the open middle and up its own page: fightPath.)
      const home = o.userData.fight ? fightPath(from, t.pos, false) : null;
      const hop = !home && from.distanceTo(t.pos) > CW * s0 * 1.5 ? CH * s0 * 1.08 : 0, U = new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
      tween(Math.max(300, ms), (e, k) => { if (home) home(ease(k), o.position); else o.position.lerpVectors(from, t.pos, ease(k)).addScaledVector(U, Math.min(1, 2.2 * Math.sin(Math.PI * k)) * hop); o.scale.setScalar(lerp(s0, t.s || s0, ease(k))); })
        .then(() => { scene.remove(o); dispose(o); if (held && host.obj.parent) retitle(host.obj, host.ids); });
    });
    const marks = H.marks || {};
    Object.entries(pieces).forEach(([k, pc]) => {
      if (reused[k]) return;                        // in place, with its marks and effects
      // (A pile starts where most of its cards were: one a fighter rejoins stays on its page while he flies home to it.)
      const old = (pc.role === "zone" ? null : pc.ids.map(id => was[id]).filter(Boolean).reduce((a, b) => (!a || b.n > a.n ? b : a), null)) || was[k];
      if (old) {
        pc.obj.position.copy(old.pos); pc.obj.scale.setScalar(old.s); pc.obj.userData.fade = old.fade || 0; pc.obj.userData.fromStack = !!old.fromStack;
        // (Cards that lay under a pile's top card come out from behind it: the face that showed stays in front.)
        if (pc.ids.every(id => !was[id] || was[id].under)) pc.obj.position.z -= 0.2 * old.s;
      } else if (ms && pc.role !== "plate" && pc.role !== "floor" && pc.role !== "zone") {   // new to the table: from my hand, or its controller's plate (a new pile grows where it lies, under what flies to it)
        // (A token comes out of the spell or ability that made it, as it resolves: the consequence seen leaving its cause.)
        // (Only when that is unambiguous: one entry resolved, and it was its controller's; otherwise from the controller's plate.)
        const made = maker && maker.m.userData.owner === pc.pid && pc.ids.every(id => (P.card(id) || {}).token) && maker;
        // (At a card's own size, never the spell's as the stack's focus, and already a little toward its controller's side.)
        pc.obj.position.copy(made ? made.m.position.clone().lerp(plateAt(pc.pid), 0.3) : pc.pid === P.ME ? new T.Vector3(0, 0, 9) : plateAt(pc.pid)); pc.obj.scale.setScalar(made ? Math.min(made.m.scale.x, 1.2) : 0.5);
      } else if (ms) { pc.obj.scale.setScalar(0.001); pc.fresh = true; }
      const kind = pc.ids.map(id => marks.cards && marks.cards[id]).find(Boolean);
      // Danger is the blood band on the card's own edge (haloFor, below) where the aim line ends, and a sigil branded into
      // the page at its foot.
      if (kind === "danger") SeatFX.sigil(pc.obj, { r: 1.0, seed: pc.ids[0] });
      else if (kind === "option" && pc.role !== "mana") SeatFX.ember(pc.obj, { seed: pc.ids[0] });
      else if (kind === "selected") SeatFX.chosen(pc.obj, pc.obj.userData.kind === "flat" ? { w: 1.1, d: 0.5, y: 0.012 } : {});
      if (kind && pc.obj.userData.haloParent) haloFor(pc.obj.userData.haloParent, false, kind);
      else if (kind && pc.obj.userData.tilt && pc.obj.userData.tilt.userData.haloParent) {   // flat: the ring sits just above the card
        const hp = pc.obj.userData.tilt.userData.haloParent; haloFor(hp, false, kind); hp.children[hp.children.length - 1].position.z = TH + 0.004;
      }
    });
    // A player who loses life is struck: the blow lands on their plaque as its number changes.
    SEATS.forEach(p => {
      const pl = pieces["plate" + p.id];
      if (ms && pl && lifeWas[p.id] != null && p.life < lifeWas[p.id]) {
        SeatFX.burst(pl.obj, [THEME.dangerRim, "#ffd9a0"], { ms: 700, n: 160, spread: 1.4 });
        // Combat damage from attackers nobody blocked, exactly the life lost: each strikes it, a bolt from the attacker
        // through where its lane lands (an open gap in the row) on to the plaque, so whose blow it was reads, not only that
        // life went. The bolt leaves from wherever the attacker is as it goes home, and is out before the row has closed.
        // Any other loss (life paid, a spell) has only the burst.
        const c = G.combat, lost = lifeWas[p.id] - p.life;
        const by = c && /damage|first strike/i.test(G.phase || "") ? c.attackers.filter(a => a.defender === p.id && !c.blockers.some(b => b.blocking === a.id) && P.card(a.id)) : [];
        if (by.length && by.reduce((t, a) => t + Math.max(0, P.card(a.id).power || 0), 0) === lost) by.forEach(a => {
          const ka = Object.keys(pieces).find(k => pieces[k].role !== "zone" && pieces[k].ids.includes(a.id)); if (!ka) return;
          const src = pieces[ka].obj, to = pl.obj.position.clone().setY(0.3), from = src.position.clone().setY(0.3), via = (landed[a.id] || from.clone().lerp(to, 0.4)).clone().setY(0.35);
          const down = via.clone().add(new T.Vector3(0, 0, 1.6)), path = new T.CatmullRomCurve3([from, via, down, to]);
          const curve = k => { path.points[0].copy(src.position).setY(0.3); return path.getPoint(k); };
          const hit = SeatFX.arc(from, to, [THEME.seatInk[P.card(a.id).controller] || THEME.dangerRim, "#fff0c0"], { width: 0.05, curve, jitter: 0.1, flare: true, source: true, drips: 30 });
          root.add(hit); setTimeout(() => { root.remove(hit); dispose(hit); }, 500);
        });
      }
      lifeWas[p.id] = p.life;
    });
    if (H.afterBuild) H.afterBuild({ pieces, T });
    if (STATS.built !== built0) layoutSig = "";    // something new needs its pose: never skip this layout
    layout(ms);
    if (refit) refitT = setTimeout(() => buildBoard(900), settleAt - performance.now() + 20);   // afterwards, and unhurried
  }

  // Let go of a rebuilt board's GPU objects, keeping the shared geometry, materials and cached textures.
  function dispose(obj) {
    const keep = new Set([...Object.values(GEO), ...Object.values(MAT), ...Object.values(TEX), MAT.halo.map, MAT.back.map, ...SeatFX.shared()]);
    obj.traverse(o => {
      if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
      [].concat(o.material || []).forEach(m => {
        if (keep.has(m)) return;
        if (m.map && !keep.has(m.map)) m.map.dispose();
        m.dispose();
      });
    });
  }

  // Target poses for every piece, for the current focus and combat.
  function targets() {
    const R = regions(), out = {};
    const combat = G.combat, lanes = {};
    SEATS.forEach(p => {
      const r = R[p.id], me = p.id === P.ME, plan = plans[p.id];
      if (!plan) return;
      const zones = Object.entries(pieces).filter(([, x]) => x.pid === p.id && x.role === "zone");
      // Every page has the same bands in the same order from its fixed edge (fitSeat): theirs from the front, toward the
      // table's middle, back; mine from the back, by my hand, forward. In region terms both fixed edges lie at v = r.d/2, so
      // a depth `a` from it is at v = r.d/2 - a, and the page is W × D from there.
      const { W, D } = plan, vAt = a => r.d / 2 - a, sZ = 0.8, sP = me ? 0.95 : PLATE_S;
      r.pw = W; r.pd = D; r.front = vAt(me ? D : 0); r.back = vAt(me ? 0 : D);
      // A band's rows, each unit in its place (seatPlaces, rowU): theirs march away from the fixed edge from its near side,
      // mine toward me from its far side (a standee leans toward the page's front, so my front row stands its lean back
      // from the band's edge and its top stays inside my border).
      const rowsOf = (B, extra = () => ({})) => (B.units || []).forEach(un => {
        const row = Math.floor(un.at / B.perRow), a = me ? B.a1 - B.s * (B.lead + row * B.step) : B.a0 + B.s * (B.lead + row * B.step);
        out[un.key] = { pos: toWorld(r, rowU(B, un.at), vAt(a)), s: B.s, ...extra(un.at, B) };
      });
      rowsOf(plan.C);
      rowsOf(plan.S);
      // Wells: every one carries its sign on its card, at a size that reads on screen, taking turns high and low on the
      // card so neighbours' signs don't run together.
      // Theirs is one well, lying at the outer end of their first support row.
      if (me) rowsOf(plan.L, (i, B) => ({ sign: (B.perRow > 5 ? 0.8 : 1) / B.s, signZ: [-0.14, -0.66][Math.round(rowPlace(i % B.perRow, B.perRow) + (B.perRow - 1) / 2) % 2] }));   // by its place across, so neighbours alternate
      else (plan.L.units || []).forEach(un => (out[un.key] = { pos: toWorld(r, plan.L.u, vAt(plan.L.a0 + plan.L.s * plan.L.lead)), s: plan.L.s }));
      // The back band: the plaque, the commander beside it when it is in the command zone, and the piles. The others' plaque
      // and commander lean back toward their page's back edge, so they stand far enough in for their tops to stay inside
      // the border; mine lean toward my field.
      const backV = vAt(me ? plan.back * 0.55 : plan.plateA);
      const pu = me ? Math.max(0, tableAt(HAND.right + 12, 740).x - BASE.you.x + 1.6 * sP) : plan.place.plate;   // my plaque, just right of the hand
      out["plate" + p.id] = { pos: toWorld(r, pu, backV), s: sP, fade: focus && !r.focused && !me ? 1 : 0 };
      if (me) {
        // Mine lie in my plaque's row, right of it: the hand holds the left of that row and the prompt its right corner, so
        // nothing covers them. Graveyard then
        // exile, each always in its own place, as large as the floors ask, so a card that goes there makes one trip and stays seen.
        const zs = Math.max(sZ, floorScale(toWorld(r, pu + 2.4 * sP, backV), FLOOR.any, true, sZ)), step = zs * CW + 0.25;
        zones.forEach(([k]) => { const i = k.startsWith("zexile") ? 1 : 0; out[k] = { pos: toWorld(r, pu + 1.6 * sP + 0.25 + zs * CW / 2 + i * step, backV), s: zs }; });
      } else {
        // Theirs: beside the plaque toward the table's middle (so they never leave the screen), past the commander while it
        // is there, as large as the floors ask; their name tags inside the border.
        plan.place.zones.forEach((u, i) => zones[i] && (out[zones[i][0]] = { pos: toWorld(r, u, vAt(plan.plateA + (plan.zoneBack || 0))), s: plan.place.zS }));
      }
      // The mat is the page, lying from the fixed edge.
      const sf = soft(), lit = focus ? r.focused : sf.seat ? r.soft : false;
      out["floor" + p.id] = { pos: toWorld(r, 0, r.d / 2 - D / 2), s: 1, floor: { w: W, d: D, yaw: r.yaw, lit: lit || (me && !focus && G.active === P.ME), turn: G.active === p.id, off: !!focus && !r.focused && !me, dim: layer() } };
      // Out of focus is dimmer and greyer, never dark: its names and numbers still read, and nothing changes size. Under the
      // stack (a focus, one tap from gone) everything dims further, but what it touches.
      const touched = new Set(G.stack.flatMap(st => stackTouches(st).concat([st.card])));
      const dimTo = focus && !r.focused && !me ? 0.55 : layer() ? 0.8 : sf.seat && !r.soft && !me ? 0.4 : null;
      if (focus && me) Object.keys(out).forEach(k => { const pc = pieces[k]; if (pc && pc.pid === p.id && pc.role !== "plate" && pc.role !== "floor") out[k].fade = Math.max(out[k].fade || 0, 0.45); });
      if (dimTo) Object.keys(out).forEach(k => {
        const pc = pieces[k];
        if (pc && pc.pid === p.id && pc.role !== "plate" && pc.role !== "floor" && !pc.ids.some(id => touched.has(id))) out[k].fade = dimTo;
      });
    });
    // The turn player's page comes forward a little, the whole leaf from its fixed (front) edge (before combat is staged:
    // that measures the open table between the pages where they are).
    const sf = soft();
    if (sf.seat && R[sf.seat] && R[sf.seat].soft) { const r = R[sf.seat], at = toWorld(r, 0, r.d / 2); carry(out, sf.seat, at, r.yaw, at, GROW, r.yaw); }
    // Combat: every creature in it leaves its place (a token leaves its pile: buildBoard) and stands on the open table in
    // the middle, where it covers no page: the attackers in one row across, in the order they stood, each blocker straight
    // in front of the attacker it blocks (between it and its defender), so who blocks whom reads without a lane. Their
    // places stay empty on their pages, for them to go back to when combat ends.
    if (combat) {
      // Only what is on the battlefield fights: a blocker that has died is in its graveyard pile, which stays where it lies.
      const keyOf = id => Object.keys(pieces).find(kk => pieces[kk].role !== "zone" && pieces[kk].ids.includes(id));
      const M = openMiddle(out), seenX = k => project(out[k].pos).x;
      const groups = [];                            // one per attacking piece: its attackers, and its blockers' pieces
      combat.attackers.forEach(a => {
        const k = keyOf(a.id); if (!k || !out[k]) return;
        let g = groups.find(x => x.k === k);
        if (!g) groups.push(g = { k, as: [], bs: [], from: P.card(a.id).controller });
        g.as.push(a);
        combat.blockers.filter(b => b.blocking === a.id).forEach(b => { const kb = keyOf(b.id); if (kb && out[kb] && !g.bs.includes(kb)) g.bs.push(kb); });
      });
      // In the order they stood; once blocked, an attacker takes its place in the row by where its blockers come from, so
      // no two blockers cross on their way, each stepping straight out to the one it blocks. One nobody blocks keeps to
      // where it stands now (in the row, once it is there), so no blocker passes in front of it on its way.
      const nowX = k => (pieces[k].obj.userData.fight ? project(pieces[k].obj.position).x : seenX(k));
      const placeX = g => (g.bs.length ? g.bs.reduce((t, kb) => t + seenX(kb), 0) / g.bs.length : nowX(g.k));
      groups.sort((x, y) => placeX(x) - placeX(y));
      // Each as large as its side's creatures prefer, or the floors ask where it stands.
      const u = uPx(), mid = tableAt((M.l + M.r) / 2, M.b), sz = {}, fighting = new Set(groups.flatMap(g => [g.k, ...g.bs]));
      fighting.forEach(k => { const me = pieces[k].pid === P.ME; sz[k] = Math.max(BAND.C(me).pref, floorScale(mid, me ? FLOOR.mine : FLOOR.theirs, false)); });
      const turned = k => !!(P.card(pieces[k].ids[0]) || {}).tapped && ["creature", "walker"].includes(pieces[k].role);   // a tapped standee lies turned: as wide as it is tall
      const wide = k => sz[k] * (turned(k) ? CH : CW) * 1.06, tall = k => sz[k] * (turned(k) ? CW : CH);
      // The attackers' row is the far one, unless the attackers are mine: either way the blockers stand between them and
      // who they attack, the near row's feet at the open table's foot and the far row a row's step behind. Where the far
      // row would reach over the page behind, it is one row instead, each blocker just beside the attacker it blocks.
      const mineAtk = groups.length > 0 && groups[0].from === P.ME, U = new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));
      const sNear = Math.max(1, ...[...fighting].filter(k => groups.some(g => (mineAtk ? g.k === k : g.bs.includes(k)))).map(k => sz[k]));
      const Z = { near: mid.z, far: mid.z - STEP * sNear };
      const rows = groups.some(g => g.bs.length) && groups.every(g => project(new T.Vector3(mid.x, 0, Z.far).addScaledVector(U, tall(g.k) * 1.04)).y / u >= M.t - 6);
      // The open stretch of table the row stands in: across the open middle's foot, between the nearest cards that stay
      // (as they stand on screen, not their pages' outlines), the widest gap, so it covers none of them.
      const y0 = Math.min(...[...fighting].map(k => project(new T.Vector3(mid.x, 0, rows ? Z.far : Z.near).addScaledVector(U, tall(k))).y / u)), y1 = M.b + 8;
      const cut = Object.entries(out).filter(([k]) => !fighting.has(k) && pieces[k] && pieces[k].role !== "floor").map(([k, t]) => {
        const s = t.s || 1, w = (turned(k) ? CH : CW) * s / 2, h = (turned(k) ? CW : CH) * s;
        const ps = [-w, w].flatMap(dx => [0, h].map(dy => project(t.pos.clone().add(new T.Vector3(dx, 0, 0)).addScaledVector(U, dy))));
        const ys = ps.map(p => p.y / u), xs = ps.map(p => p.x / u);
        return Math.max(...ys) > y0 && Math.min(...ys) < y1 ? [Math.min(...xs) - 6, Math.max(...xs) + 6] : null;
      }).filter(Boolean).sort((a, b) => a[0] - b[0]);
      let open = [16, 16], at = 16;
      cut.concat([[1164, 1164]]).forEach(([a, b]) => { if (a - at > open[1] - open[0]) open = [at, a]; at = Math.max(at, b); });
      const gl = tableAt(open[0], M.b).x, gr = tableAt(open[1], M.b).x;
      const span = g => (rows ? Math.max(wide(g.k), g.bs.reduce((t, k) => t + wide(k), 0)) : wide(g.k) + g.bs.reduce((t, k) => t + wide(k), 0));
      const packed = groups.reduce((t, g) => t + span(g), 0), gap = Math.max(0.12, Math.min(CW * 0.8, (gr - gl - packed) / Math.max(1, groups.length + 1)));
      const width = packed + gap * Math.max(0, groups.length - 1);
      let x = (gl + gr) / 2 - width / 2, lane = 0;   // lane: this lane's place among all of them, so ends fan out 0.3 apart
      groups.forEach(g => {
        // In one row, each blocker stands on the side of its attacker it comes from, so it steps up without crossing it.
        const w = span(g), cx = project(new T.Vector3(x + w / 2, 0, Z.near)).x;
        const before = rows ? [] : g.bs.filter(kb => seenX(kb) < cx), after = g.bs.filter(kb => !before.includes(kb));
        const lw = before.reduce((t, k) => t + wide(k), 0);
        const atkPos = new T.Vector3(rows ? x + w / 2 : x + lw + wide(g.k) / 2, 0, rows ? Z[mineAtk ? "near" : "far"] : Z.near);
        out[g.k] = { pos: atkPos, s: sz[g.k], fight: true };
        let bx = rows ? x + w / 2 - g.bs.reduce((t, k) => t + wide(k), 0) / 2 : x;
        before.concat(rows ? [] : [g.k], after).forEach(kb => { if (kb !== g.k) out[kb] = { pos: new T.Vector3(bx + wide(kb) / 2, 0, rows ? Z[mineAtk ? "far" : "near"] : Z.near), s: sz[kb], fight: true }; bx += wide(kb); });
        x += w + gap;
        // It lands on the blocker that stopped it, or on the front edge of the defender's page: never on the plaque, which
        // lies behind their whole field, and never in among their cards, where an unassigned attack would read as aimed at
        // one of them. Lanes side by side fan out 0.3 apart at both ends, so neighbours never share a stroke or a pool.
        g.as.forEach((a, n) => {
          const D = R[a.defender], onMe = a.defender === P.ME, d0 = new T.Vector3(D.x, 0, D.z), side = new T.Vector3(d0.z - atkPos.z, 0, atkPos.x - d0.x).normalize();
          // At me, the edge is behind my standing row and the lane would vanish behind a creature, as if aimed at it: it
          // stops short, on the open page in front of my row's tops, where no card stands.
          const dFront = toWorld(D, 0, D.front != null ? D.front - (onMe ? 2.3 : 0) : onMe ? -D.d / 2 - 2.3 : D.d / 2);
          const kb = g.bs.find(k => pieces[k].ids.some(id => combat.blockers.some(b => b.id === id && b.blocking === a.id)));
          if (!kb && combat.blockers.some(b => b.blocking === a.id)) return;   // blocked, its blocker gone: it stays blocked and aims at no one
          const at = lane, fan = (lane++ - (combat.attackers.length - 1) / 2) * 0.3;
          const end = kb ? out[kb].pos.clone().addScaledVector(side, (n - (g.as.length - 1) / 2) * 0.35) : dFront.clone().addScaledVector(side, fan);
          // It leaves 0.3 in front of the attacker's foot, where the card can't hide its start; lanes to one seat each crest
          // 0.15 higher than the last, so where they gather near a blocker they read as separate strands, not a wedge.
          lanes[a.id] = { from: atkPos.clone().addScaledVector(side, (n - (g.as.length - 1) / 2) * 0.3).addScaledVector(d0.clone().sub(atkPos).normalize(), 0.3), to: end, blocked: !!kb, color: THEME.seatInk[g.from] || COLORS[g.from], onMe, apex: 0.14 + at * 0.15, edge: !kb && { r: D, key: a.defender, id: a.id } };   // unblocked: drawLanes spreads the ends along D's front edge
        });
      });
      Object.entries(out).forEach(([k, t]) => { if (!t.fight && pieces[k] && !["plate", "floor"].includes(pieces[k].role)) t.fade = Math.max(t.fade || 0, pieces[k].role === "creature" ? 0.45 : 0.7); });
    }
    // Chosen: the card lifts off its ground a little, over the gold pooled under it.
    const marks = H.marks || {};
    Object.entries(out).forEach(([k, t]) => { const pc = pieces[k]; if (pc && pc.ids.some(id => marks.cards && marks.cards[id] === "selected")) t.lift = 0.1; });
    // A leaned-in page comes off the table to me.
    if (focus) lean(out, R);
    return { out, lanes, R };
  }

  // A fighter's way between its page and the fight: first straight across its own page's depth (out of the page or into
  // it), then along the open middle, on one smooth curve; `out` goes from the page to the fight. It sets `v` (a position).
  function fightPath(from, to, out) {
    const page = out ? from : to, mid = out ? to : from, c = new T.Vector3(page.x, (from.y + to.y) / 2, mid.z);
    return (k, v) => v.set(0, 0, 0).addScaledVector(from, (1 - k) * (1 - k)).addScaledVector(c, 2 * k * (1 - k)).addScaledVector(to, k * k);
  }
  // Apply the targets, animated over ms (0 = at once).
  let layoutId = 0, layoutSig = "", layoutDone = true, aimPts = [];
  function layout(ms = 600) {
    const { out, lanes, R } = targets();
    // The same targets while a move is still under way: let it finish rather than restart its easing (that reads as a stutter).
    const sig = Object.entries(out).map(([k, t]) => k + t.pos.x.toFixed(2) + t.pos.y.toFixed(2) + t.pos.z.toFixed(2) + (t.s || 0).toFixed(2) + (t.fade || 0).toFixed(2) + (t.lift ? "l" : "") + (t.hide ? "h" : "") + (t.floor ? t.floor.w.toFixed(1) + t.floor.d.toFixed(1) + (t.floor.lit ? "L" : "") + (t.floor.turn ? "T" : "") + (t.floor.off ? "O" : "") + (t.floor.dim ? "D" : "") : "")).join("|") + "|" + focus;
    if (ms && !layoutDone && sig === layoutSig) { drawLanes(lanes, out); stackShow(ms); return; }
    layoutSig = sig; layoutDone = false;
    const id = ++layoutId;
    const camPos = new T.Vector3(CAM.pos.x, CAM.pos.y, CAM.pos.z);
    // While a page is held up, nothing of the other seats may draw over it: it writes depth, and their plaques and signs,
    // drawn over everything on the table, are drawn in depth like the rest until it is back down.
    if (focus) Object.values(pieces).forEach(pc => overTable(pc.obj, pc.pid === focus));
    const jobs = Object.entries(pieces).map(([k, pc]) => {
      const t = out[k] || { pos: pc.obj.position.clone(), s: 0, hide: true };
      const o = pc.obj;
      if (pc.fresh && !(pc.pid === P.ME && o.scale.x > 0.1)) o.position.copy(t.pos);
      pc.fresh = false;
      const fl = o.userData.floor;
      const from = { pos: o.position.clone(), s: o.scale.x, fade: o.userData.fade || 0, lift: o.userData.lift || 0, yaw: o.rotation.y, tone: fl ? fl.material.color.r : 1, glow: fl ? fl.userData.glow.material.opacity : 0,
        w: fl ? fl.userData.w || t.floor.w : 0, d: fl ? fl.userData.d || t.floor.d : 0 };
      const fade = t.fade || 0;
      // Stepping into the fight or back from it, or along the fight's row to face its blockers, a card hops over what it
      // passes, so it never slides behind a bystander or through another fighter.
      const along = !fl && t.fight && o.userData.fight && Math.abs(from.pos.x - t.pos.x) > CW;
      const steps = !fl && (!!t.fight !== !!o.userData.fight || along) && from.pos.distanceTo(t.pos) > 0.3;
      o.userData.fight = !!t.fight;
      const far = steps ? from.pos.distanceTo(t.pos) : 0;
      // Out to the fight or home from it, it crosses its own page's depth where it stands and the open middle across, so a
      // diagonal never takes it over another seat's cards on the way (fightPath).
      const bend = steps && !along ? fightPath(from.pos, t.pos, !!t.fight) : null;
      // (Two changing places along the fight's row pass each other as cards on a table would, one in front and one behind,
      // never up over the page behind them: below.)
      // A permanent come down off the stack, where it stood far larger as the focus, sheds that size in the first part of
      // its way, so it never sweeps over the row it joins at it.
      const shed = o.userData.fromStack && from.s > 1.5 * (t.s || 1) ? 0.35 : 1; o.userData.fromStack = false;
      return { o, pc, t, from, fade, far, bend, shed, hop: along ? 0.25 : Math.min(0.9, far * 0.12), over: along, wait: 0, end: 1 };
    });
    // Fighters from one seat set off one after another (in the order below), so two leaving one pile never travel as
    // one, and a blocker crossing the table passes the others' places before they land there. Where the attackers make
    // way for their blockers, they do it first, and the blockers step out once they stand where they will meet them.
    // Along the row, the one with the longest way (one only) passes in front and the rest give way behind it, far enough
    // apart that the name of the one behind still shows over the one in front: the card the eye follows never goes
    // behind the others, and the ones it passes stay named.
    const front = jobs.filter(j => j.over).reduce((m, j) => (!m || j.far > m.far ? j : m), null);
    jobs.forEach(j => { if (j.over) j.hop = (j === front ? 0.35 : -0.3) * (j.t.s || 1); });
    const movers = jobs.filter(j => j.hop), first = movers.some(j => j.over);
    movers.forEach(j => { if (first) [j.wait, j.end] = j.over ? [0, 0.5] : [0.45, 1]; });
    // Leaving a page, the one nearest the fight goes first, so one from further back never crosses where another is just
    // leaving (two from piles one behind the other would travel as one); level, the longest trip first.
    const ahead = j => (j.bend ? -Math.abs(j.from.pos.z - j.t.pos.z) : 0);
    [...new Set(movers.map(j => j.pc.pid + j.over))].forEach(g => movers.filter(j => j.pc.pid + j.over === g).sort((a, b) => (Math.abs(ahead(a) - ahead(b)) > 0.3 ? ahead(b) - ahead(a) : b.far - a.far))
      .forEach((j, n, all) => (j.wait += all.length > 1 ? Math.min(0.45, 0.45 / (all.length - 1)) * n * (j.end - j.wait) : 0)));
    const apply = (k0, raw = k0) => {
      if (id !== layoutId) return;
      jobs.forEach(({ o, pc, t, from, fade, hop, over, wait, end, bend, shed }) => {
        const k = wait || end < 1 ? 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, (raw - wait) / (end - wait)))) : k0;
        if (bend) bend(k, o.position); else o.position.lerpVectors(from.pos, t.pos, k);
        if (over) o.position.z += Math.min(1, 2.2 * Math.sin(k * Math.PI)) * hop;
        else if (hop) o.position.y += Math.sin(k * Math.PI) * hop;
        const s = lerp(from.s, t.hide ? 0.001 : t.s, Math.min(1, k / shed));
        o.visible = s > 0.01;
        if (t.floor) {
          // The page grows or shrinks to its rows with the cards, its border keeping its width (slicePage); it moves and
          // scales as one leaf (carry); its light and the turn's edge (its own layer, cross-faded below) change. Held up,
          // it shades the table under it.
          const fl = o.userData.floor, w = lerp(from.w, t.floor.w, k), d = lerp(from.d, t.floor.d, k);
          o.rotation.y = angLerp(from.yaw, t.floor.yaw, k); o.scale.setScalar(s);
          if (w !== fl.userData.w || d !== fl.userData.d) { slicePage(fl, w, d); fl.userData.w = w; fl.userData.d = d; }
          floorShade(o, { ...t.floor, w, d }, s);
        } else {
          o.scale.setScalar(s);
          // Face the screen: standees and plates lean back by the camera's pitch, so they read upright and square
          // wherever they stand; flat cards are propped up a little so their names stay readable.
          const dz = camPos.z - o.position.z, el = Math.atan2(camPos.y - o.position.y, Math.max(1, dz));
          o.rotation.y = 0;
          (o.userData.pivots || []).forEach(pv => (pv.rotation.x = -(PITCH + (P.card(pc.ids[0]).tapped && !t.fight ? TAP_LEAN : 0))));
          const lift = lerp(from.lift, t.lift || 0, k); o.userData.lift = lift;
          if (o.userData.pivots) o.userData.pivots[o.userData.pivots.length - 1].position.y = 0.02 + lift;
          if (o.userData.tilt) o.userData.tilt.position.y = lift;
          if (o.userData.sign) {
            const sg = o.userData.sign; sg.scale.setScalar(t.sign || sg.userData.fit || 1);
            if (sg.userData.z0 == null) sg.userData.z0 = sg.position.z;
            // On its card: its lower edge, propped up, clear of the card's face, so the card never cuts its letters.
            const clear = sg.geometry.parameters.height * sg.scale.x / 2 * Math.sin(0.95) + 0.05;
            sg.position.z = t.signZ != null ? t.signZ : sg.userData.z0; sg.position.y = Math.max(t.signZ < 0 ? 0.2 : 0.12, clear);
          }
          // Opponents' noncreatures stand nearly upright too: far away, a card lying down is too small to read. My wells lie
          // flat on the page: their signs name them, so they needn't be propped up to be read.
          if (o.userData.tilt) o.userData.tilt.rotation.x = -(Math.PI / 2) + (Math.PI / 2 - el) * (o.userData.well ? 0 : pc.pid !== P.ME ? 0.85 : 0.4);
          if (pc.role === "plate") o.userData.pivot.rotation.x = -PITCH;
        }
        const f = lerp(from.fade, fade, k); o.userData.fade = f;
        if (o.userData.sign) o.userData.sign.material.color.setScalar(1 - 0.8 * f);   // a sign dims with its seat
        // Its effects (a well's light, embers, ash) dim at least as far as the seat they stand in: to a quarter in the
        // background of a side leaned in on.
        const lv = Math.round((1 - 0.75 * Math.min(1, f / 0.92)) * 50) / 50;
        if (o.userData.fxLv !== lv) { o.userData.fxLv = lv; SeatFX.level(o, lv); }
        if (pc.role === "plate") {
          o.userData.plate.material.color.setScalar(1 - 0.55 * f);      // dimmed, never dark: the name and life still read
        }
        o.userData.faces.forEach(m => {
          const tapped = m.userData.tapped && !t.fight;
          m.userData.dim.value = pc.role === "plate" ? f * 0.6 : f; m.userData.tap.value = tapped ? 1 : 0;
        });
      });
    };
    // Spells and abilities on the stack point at what they target. Everything stands leaning back to face me, so an arc
    // that crossed a row would cross faces, and one that ran along a gap traced its neighbours' edges. So the arc comes out
    // from behind its own card, by whichever way crosses least, to a crest just over the middle of its target's top edge,
    // and drops straight down behind the card to its ground, where the card itself hides the end. A plaque is struck on its
    // top edge from above. While I choose targets for my own spell, the ones I've picked get their arcs already.
    //   U runs up a leaning card as I see it; N is its face's normal, toward me.
    const marks = H.marks || {}, U = new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH)), N = new T.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
    const seen = v => project(v);
    // The other spells on the stack stand in front of the table and of each other: an arc passing behind one seems to
    // run into it, so they count as in the way whatever their depth.
    const camUp = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), camRight = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const stackRect = (s, g) => { const ps = [-1, 1].flatMap(a => [-1, 1].map(b => seen(s._pos.clone().addScaledVector(camRight, a * (CW / 2 * s._scale + g)).addScaledVector(camUp, b * (CH / 2 * s._scale + g))))); return { l: Math.min(...ps.map(p => p.x)), r: Math.max(...ps.map(p => p.x)), t: Math.min(...ps.map(p => p.y)), b: Math.max(...ps.map(p => p.y)) }; };
    const aimAt = (st, i, tg, j) => {
      const toMe = camPos.clone().sub(st._pos).normalize();
      // A spell aimed at another spell: a short arch up out of its own top and over, dropping onto the other's top edge
      // and behind it, so the stack itself says what answers what.
      // (A card target is the spell only while that card is on the stack; an ability's card is its source, on the table.)
      const onStack = typeof tg === "number" && (P.card(tg) || {}).zone === "stack" && G.stack.find(x => x !== st && x.spell !== false && x.card === tg && x._pos);
      if (onStack) {
        const top = (s, u) => s._pos.clone().addScaledVector(camUp, CH / 2 * s._scale * u);
        const from = top(st, 0.4).addScaledVector(toMe, -0.05), land = top(onStack, 0.75).addScaledVector(toMe, -0.05), rise = (layer() ? 0.25 : 0.55) * st._scale;   // (up and large, a lower arch)
        const curve = SeatFX.bezier(from, top(st, 1).addScaledVector(camUp, rise), top(onStack, 1).addScaledVector(camUp, rise), land);
        lanes["stack" + i + "_" + j] = { from, to: curve(1), curve, blocked: i > 0, plate: false, colors: colorsOf(P.card(st.card)), aim: true };
        return;
      }
      const k = typeof tg === "number" ? Object.keys(pieces).find(kk => pieces[kk].ids.includes(tg)) : "plate" + tg;
      const t = k && out[k];
      if (!t || t.hide) return;
      const s = t.s || 1, pc = pieces[k], plate = pc.role === "plate", base = t.pos.clone();
      // From just behind its own card, which hides the start; up and forward over the table, from behind its foot, so the
      // way down to the table never runs back through its face.
      const from = st._pos.clone().addScaledVector(toMe, -0.25).addScaledVector(camUp, layer() ? -0.42 * CH * st._scale : 0);
      const top = plate ? 0.82 * s : (CH + (t.lift || 0)) * s;                       // how high its top edge stands, along U
      const at = (u, n, b = base) => b.clone().addScaledVector(U, u).addScaledVector(N, n);
      let curve;
      if (plate) {
        // A plaque: straight up the screen out from behind the spell to a crest level with a point over the plaque, across,
        // and down onto its top edge.
        const peak = at(top + 0.28, 0.05), to = at(top, -0.05), up = U.clone().addScaledVector(toMe, -U.dot(toMe)).normalize();
        const want = seen(at(top + 0.55, 0.05)).y;
        let lo = -12, hi = 12;
        for (let it = 0; it < 24; it++) { const mid = (lo + hi) / 2; if (seen(from.clone().addScaledVector(up, mid)).y > want) lo = mid; else hi = mid; }
        const crest = from.clone().addScaledVector(up, (lo + hi) / 2), turn = crest.clone().lerp(peak, 0.22);
        const climb = SeatFX.bezier(from, from.clone().lerp(crest, 0.5), crest, turn), cross = SeatFX.bezier(turn, turn.clone().lerp(peak, 0.4), peak.clone().addScaledVector(U, 0.25), peak), fall = SeatFX.bezier(peak, peak.clone().addScaledVector(U, 0.1), to.clone().addScaledVector(U, 0.3), to);
        curve = kk => (kk < 0.4 ? climb(kk / 0.4) : kk < 0.75 ? cross((kk - 0.4) / 0.35) : fall((kk - 0.75) / 0.25));
      } else {
        // A card: the arc ends coming straight down onto the middle of its top edge and on down behind it, so the card
        // hides the end and no neighbour's edge is traced. How it gets there is chosen by what it would cross: every other
        // card, pile and plaque as it stands on screen. The way that crosses least wins; the plainest wins a tie.
        const sd = Math.sign(base.x - st._pos.x) || 1, edge = base.x + sd * CW / 2 * s;
        let nb = null;
        Object.entries(out).forEach(([kk, o]) => {
          const q = pieces[kk];
          if (kk === k || !q || q.pid !== pc.pid || o.hide || ["plate", "floor", "zone", "mana"].includes(q.role) || Math.abs(o.pos.z - base.z) > 0.6 * s) return;
          const e = o.pos.x - sd * CW / 2 * (o.s || 1);
          if ((e - edge) * sd > -0.05 && (!nb || Math.abs(e - edge) < Math.abs(nb - edge))) nb = e;
        });
        // A card's face stands square to my view, so all of it lies at its foot's depth: a stretch of arc farther away than
        // that is hidden behind the card itself, but still counts in the margin round it, where it would trace its edge.
        const fwd = new T.Vector3(CAM.at.x, CAM.at.y, CAM.at.z).sub(camPos).normalize(), depth = v => v.clone().sub(camPos).dot(fwd);
        const boxes = Object.entries(out).filter(([kk, o]) => kk !== k && pieces[kk] && pieces[kk].role !== "floor" && !o.hide).map(([kk, o]) => {
          const q = pieces[kk], os = o.s || 1, wide = q.role === "plate" ? 1.6 : CW / 2, tall = q.role === "plate" ? 0.82 : CH;
          const rect = g => { const ps = [-1, 1].flatMap(sx => [0, tall * os + g].map(du => seen(o.pos.clone().add(new T.Vector3(sx * (wide * os + g), 0, 0)).addScaledVector(U, du)))); return { l: Math.min(...ps.map(p => p.x)), r: Math.max(...ps.map(p => p.x)), t: Math.min(...ps.map(p => p.y)), b: Math.max(...ps.map(p => p.y)) }; };
          return { near: rect(0.15), card: rect(0), z: depth(o.pos), plate: q.role === "plate", flat: q.role === "mana" };
        });
        G.stack.forEach(x => { if (x !== st && x._pos) boxes.push({ near: stackRect(x, 0.15), card: stackRect(x, 0), z: Infinity, spell: true }); });
        const inR = (p, r) => p.x > r.l && p.x < r.r && p.y > r.t && p.y < r.b;
        // Ways in: straight; high on the stack's side, or the far side, or from above; in behind the row at half height,
        // where the neighbours hide it; up a wide gap. Each meets a crest just over the target, or barely over it where
        // something stands right behind it.
        const to = at(top * 0.6, -0.45 * s);
        const leads = [[], [at(top + 0.9, -0.05 * s).add(new T.Vector3(-sd * 1.1 * s, 0, 0))], [at(top + 0.9, -0.05 * s).add(new T.Vector3(sd * 1.1 * s, 0, 0))], [at(top + 1.1, -0.05 * s)],
          [at(top * 0.45, -0.5 * s).add(new T.Vector3(-sd * CW * s, 0, 0))]];
        if (nb == null || Math.abs(nb - edge) >= 1.2) { const foot = new T.Vector3(nb != null ? (edge + nb) / 2 : edge + sd * 0.6, 0, base.z); leads.push([at(0.1 * s, -0.25 * s, foot), at(top + 0.1, -0.05 * s, foot)]); }
        let best = null;
        [0.22, 0.08].forEach(over => leads.forEach(lead => {
          const cr = new T.CatmullRomCurve3([from, ...lead, at(top + over, -0.05 * s), at(top * 0.85, -0.25 * s), to], false, "centripetal");
          let hits = 0;
          for (let n = 4; n <= 44; n++) { const v = cr.getPoint(n / 48), p = seen(v), d = depth(v); hits += boxes.filter(b => inR(p, b.near) && (d < b.z - 0.02 || !inR(p, b.card))).length; }   // over it, or beside it within the margin, where it shows
          if (!best || hits < best.hits) best = { cr, hits };
        }));
        // Every way in crosses something: then no diagonal. It climbs to a crest straight over the target, high enough to
        // clear the cards that stand above it on screen (2.2 at the least; a plaque far behind, or a well lying flat, doesn't
        // count), and falls plumb down onto its top edge, so it reads as dropped on this card and never as aimed at the one
        // it passes.
        if (best.hits) {
          const x0 = seen(at(0, 0)).x, col = boxes.filter(b => !b.plate && !b.flat && b.card.r > x0 - 4 && b.card.l < x0 + 4 && b.card.b <= seen(at(top, 0)).y + 6);
          // A spell standing between its own card and the target on screen is passed over too, never through; and with
          // other spells beside it, the arc rises clear over its own card's top, so it plainly leaves this card.
          const x1 = seen(st._pos).x, others = boxes.filter(b => b.spell && b.card.r > Math.min(x0, x1) - 4 && b.card.l < Math.max(x0, x1) + 4);
          if (others.length) col.push(...others, { card: { t: stackRect(st, 0).t - 12 } });
          const clear = col.length ? Math.min(...col.map(b => b.card.t)) - 6 : Infinity;
          let h = Math.max(2.2, top + 0.6);
          for (let it = 0; it < 48 && seen(at(h, -0.05 * s)).y > clear; it++) h += 0.15;   // (the stack up stands high: so may this)
          // Up from the spell, in level from its side, then plumb down: no curve that could swing out over the neighbours.
          const crest = at(h, -0.05 * s), wide = new T.Vector3(-sd * 0.9 * s, 0, 0), land = at(top + 0.02, -0.05 * s);
          const climb = SeatFX.bezier(from, from.clone().addScaledVector(U, crest.clone().sub(from).dot(U) * 0.75), crest.clone().addScaledVector(wide, 0.7), crest);
          const fall = SeatFX.bezier(crest, crest.clone().lerp(land, 0.33), crest.clone().lerp(land, 0.67), land);
          const tuck = SeatFX.bezier(land, at(top * 0.92, -0.12 * s), at(top * 0.72, -0.32 * s), to);
          best = { cr: { getPoint: kk => (kk < 0.55 ? climb(kk / 0.55) : kk < 0.9 ? fall((kk - 0.55) / 0.35) : tuck((kk - 0.9) / 0.1)) } };
        }
        curve = kk => best.cr.getPoint(kk);
      }
      lanes["stack" + i + "_" + j] = { from, to: curve(1), curve, blocked: i > 0, plate, colors: colorsOf(P.card(st.card)), aim: true };
    };
    G.stack.forEach((st, i) => {
      if (!st._pos || focus) return;                // leaning in sets the stack aside, and its arcs with it
      (st.targets || []).forEach((tg, j) => aimAt(st, i, tg, j));
      if (i === 0 && st.controller === P.ME && !(st.targets || []).length) {
        Object.entries(marks.cards || {}).filter(([id, m]) => m === "selected" && (pieces[Object.keys(pieces).find(kk => pieces[kk].ids.includes(+id))] || {}).role !== "mana").forEach(([id], j) => aimAt(st, i, +id, "c" + j));
        Object.entries(marks.players || {}).filter(([, m]) => m === "selected").forEach(([pid], j) => aimAt(st, i, pid, "p" + j));
      }
    });
    drawLanes(lanes, out);
    // Where the arcs run on screen, so the stack's panel (live.js) can keep clear of them too.
    aimPts = Object.values(lanes).filter(l => l.aim && l.curve).flatMap(l => Array.from({ length: 49 }, (_, n) => seen(l.curve(n / 48))));
    stackShow(ms);
    // A page out of focus is in shadow, a page in focus or the turn player's a little brighter: the same page, its rules and
    // mounts still clear, only its light changes, easing from where it was with the move, never in a step. While something
    // is on the stack the whole table dims (the book and every page, never to dark: names still read) and comes back with
    // the same move that takes the last spell off, not after it.
    const floors = jobs.filter(j => j.t.floor).map(j => ({ m: j.o.userData.floor.material, g: j.o.userData.floor.userData.glow.material, i: j.o.userData.floor.userData.ink.material, a: j.from.tone, b: (j.t.floor.lit ? 1.1 : 1) * (j.t.floor.off ? 0.72 : 1) * (j.t.floor.dim ? 0.5 : 1) }));
    const t0 = tableMesh.material.color.r, t1 = layer() ? 0.42 : 1;
    tween(ms || 1, (_, k) => {
      if (id !== layoutId) return;
      const e = 0.5 - 0.5 * Math.cos(Math.PI * k);                                     // the sine: gentle at its fastest
      floors.forEach(f => { f.m.color.setScalar(lerp(f.a, f.b, e)); f.g.color.copy(f.m.color); f.i.color.copy(f.m.color); });   // its rules and the turn's ink are lit with the page
      tableMesh.material.color.setScalar(lerp(t0, t1, e));
    });
    // The turn's border passes from one mat to the next with the turn, never riding the move's slow start: the old one is
    // gone in the first half (150 ms) before the new one inks in, so only one mat is ever marked.
    const glows = jobs.filter(j => j.t.floor).map(j => ({ m: j.o.userData.floor.userData.glow.material, a: j.from.glow, b: j.t.floor.turn ? 1 : 0 }));
    tween(ms ? 300 : 1, (_, k) => { if (id === layoutId) glows.forEach(g => (g.m.opacity = lerp(g.a, g.b, g.b > g.a ? Math.max(0, 2 * k - 1) : Math.min(1, 2 * k)))); });
    const settle = () => { if (id !== layoutId) return; layoutDone = true; if (!focus) Object.values(pieces).forEach(pc => overTable(pc.obj, true)); };
    if (!ms) { apply(1); return settle(); }
    // The board moves on a sine ease: gentler at its fastest than the cubic, so a big move (leaning in, sitting back)
    // glides instead of lurching through its middle.
    return tween(ms, (e, k) => apply(0.5 - 0.5 * Math.cos(Math.PI * k), k)).then(settle);
  }
  // Plaques and their seats' land signs draw over everything on the table (on: as built), or in depth like the rest while
  // another seat's page is held over them (off).
  function overTable(o, on) {
    if (o.userData.overTable === on || (on && o.userData.overTable == null)) return;
    o.userData.overTable = on;
    o.traverse(m => [].concat(m.material || []).forEach(mat => {
      if (mat.userData.overTable == null) { if (mat.depthTest) return; mat.userData.overTable = true; }
      mat.depthTest = !on;
    }));
  }
  // A page held up (lift > 0) writes depth, so what lies under it stays under it, and casts a soft shadow on the table below,
  // down and away from the lamp as far as it is held up; back on the table it is a sheet of ink again.
  function floorShade(o, f, s) {
    const fl = o.userData.floor, h = o.position.y, up = h > 0.02 || !!f.lift;
    if (fl.userData.up !== up) { fl.userData.up = up; Object.assign(fl.material, { depthWrite: up, alphaTest: up ? 0.5 : 0, needsUpdate: true }); }
    let sh = o.userData.shade;
    if (!sh && h > 0.02) {
      sh = o.userData.shade = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: TEX.pageShade, color: 0x1a0e04, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      sh.rotation.x = -Math.PI / 2; sh.renderOrder = -0.8; sh.raycast = () => {}; o.add(sh);   // a shadow takes no taps
    }
    if (!sh) return;
    sh.visible = h > 0.02;
    const yaw = o.rotation.y, wx = h * SHEAR.x, wz = h * SHEAR.z;                         // the shadow's offset on the table, in world terms
    sh.position.set((wx * Math.cos(yaw) - wz * Math.sin(yaw)) / s, (0.012 - o.position.y) / s, (wx * Math.sin(yaw) + wz * Math.cos(yaw)) / s);
    const blur = 1 + h * 0.04;
    sh.scale.set(f.w * 1.12 * blur, f.d * 1.14 * blur, 1);
    sh.material.opacity = 0.8 * Math.min(1, h / 1.2);
  }

  // The stack hides while you lean in on a side: it fades out over the whole move rather than vanishing as it starts, and
  // coming back it fades in where it rests over the whole move back: its own materials and its effects together, nothing
  // sliding. A stack card's edge and back are its own (buildStack), so the whole card fades as one. Anything still drawn
  // with a shared material can't fade, so it shows only while the face is mostly there.
  let stackHidden = false, stackFadeId = 0;
  function stackFade(g, q0, q1, start, d, done) {
    const id = ++stackFadeId, shared = new Set(Object.values(MAT).filter(m => m !== MAT.drop && m !== MAT.hidden)), mats = [], frames = [];
    g.traverse(o => [].concat(o.material || []).forEach(m => {
      if (shared.has(m)) { if (o.isMesh && !frames.includes(o)) frames.push(o); return; }
      if (!mats.some(x => x.m === m)) mats.push({ m, o: m.userData.full != null ? m.userData.full : (m.userData.full = m.isShaderMaterial ? m.uniforms.uHdr.value : m.opacity), t: m.transparent });
    }));
    mats.forEach(x => { if (!x.m.isShaderMaterial) x.m.transparent = true; });
    const set = q => { frames.forEach(o => (o.visible = q > 0.7)); mats.forEach(x => (x.m.isShaderMaterial ? (x.m.uniforms.uHdr.value = x.o * q) : (x.m.opacity = x.o * q))); };
    const total = start + d;
    set(q0); g.visible = true;
    tween(total, (e, k) => id === stackFadeId && g === stackG && set(lerp(q0, q1, ease(Math.max(0, Math.min(1, (k * total - start) / d))))))
      .then(() => { if (id !== stackFadeId || g !== stackG) return; set(q1); if (q1 === 1) mats.forEach(x => { if (!x.m.isShaderMaterial) x.m.transparent = x.t; }); if (done) done(); });
  }
  function stackShow(ms) {
    if (!stackG) return;
    if (focus) {
      if (stackHidden) { if (!stackG.userData.out) stackG.visible = false; return; }   // one built while leaning in stays hidden
      stackHidden = true;
      if (!ms || !stackG.visible) { stackFadeId++; stackG.visible = false; return; }
      const g = stackG; g.userData.out = true; stackFade(g, 1, 0, 0, ms, () => (g.visible = false));
      return;
    }
    stackG.userData.out = false;
    if (!stackHidden) { stackG.visible = true; return; }
    stackHidden = false;
    if (!ms) { stackFadeId++; stackG.visible = true; return stackFade(stackG, 1, 1, 0, 1); }
    stackFade(stackG, 0, 1, 0, ms);
  }

  // ---- Lanes: the fire between a source and what it's aimed at ------------------------------------------------------
  // Attacks are a stroke of the attacker's seat ink with white-gold pulses running along it, low on the page, ending in a
  // flare on the defender's page edge or at the foot of the blocker that stopped it. Spells and abilities: a thin live
  // arc from behind the card down onto each target's top and behind it, held dark until the card has flown in.
  let laneG = null, stackArrive = 0;
  const landed = {};                    // where each unblocked attack lands, by attacker: its blow passes there (buildBoard)
  function drawLanes(lanes, out) {
    if (laneG) { root.remove(laneG); dispose(laneG); }
    laneG = new T.Group(); root.add(laneG);
    Object.keys(landed).forEach(id => delete landed[id]);   // (only the lanes drawn now)
    const delay = Math.max(0, stackArrive - performance.now()) / 1000;
    // An attack nobody blocked lands on the front edge of the defender's page, at the point of the edge nearest its
    // attacker, so a lane runs short and straight; lanes at one page are spread at least 0.9 apart along its edge, so they
    // never bundle. At me the edge lies under my standing row's lean, so they land just past it, on the open book.
    const edges = {};
    Object.values(lanes).forEach(l => { if (!l.aim && l.edge) (edges[l.edge.key] = edges[l.edge.key] || []).push(l); });
    Object.values(edges).forEach(ls => {
      const r = ls[0].edge.r, half = Math.max(0.3, (r.pw || r.w) / 2 - 0.6), c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
      const v = (r.front != null ? r.front : ls[0].onMe ? -r.d / 2 : r.d / 2) + (ls[0].onMe ? -0.6 : 0.15);
      ls.forEach(l => (l.u = Math.max(-half, Math.min(half, (l.from.x - r.x) * c - (l.from.z - r.z) * sn))));
      ls.sort((a, b) => a.u - b.u);
      for (let i = 1; i < ls.length; i++) ls[i].u = Math.max(ls[i].u, ls[i - 1].u + 0.9);
      const over = ls[ls.length - 1].u - half;
      if (over > 0) ls.forEach(l => (l.u -= over));
      if (ls[0].u < -half) ls.forEach((l, i) => (l.u = ls.length > 1 ? -half + i * 2 * half / (ls.length - 1) : 0));   // more lanes than the edge holds at 0.9: as far apart as it allows
      // At me, one landing on a creature's top would read as aimed at it (as if blocked by it): it lands in the nearest
      // open gap of my row instead.
      if (ls[0].onMe && out) {
        const uv = p => [(p.x - r.x) * c - (p.z - r.z) * sn, (p.x - r.x) * sn + (p.z - r.z) * c];
        const mine = Object.entries(out).filter(([k, t]) => { const pc = pieces[k]; return pc && pc.pid === ls[0].edge.key && !t.fight && !t.hide && ["creature", "walker"].includes(pc.role); });
        const near = Math.min(...mine.map(([, t]) => Math.abs(uv(t.pos)[1] - v)));   // the front row: the one nearest the edge
        const stand = mine.filter(([, t]) => Math.abs(uv(t.pos)[1] - v) < near + 0.5).map(([k, t]) => { const u0 = uv(t.pos)[0], w = (P.card(pieces[k].ids[0]) || {}).tapped ? CH : CW; return [u0 - (t.s || 1) * w / 2 - 0.12, u0 + (t.s || 1) * w / 2 + 0.12]; });
        // In the gap, clear of both neighbours; lanes that come to one gap share it, spread evenly across it.
        const gaps = {};
        ls.forEach(l => {
          const hit = stand.find(([a, b]) => l.u > a && l.u < b); if (!hit) return;
          const left = l.u - hit[0] < hit[1] - l.u, edgeU = left ? hit[0] : hit[1];
          const next = left ? Math.max(edgeU - 0.8, ...stand.map(s => s[1]).filter(b => b <= edgeU)) : Math.min(edgeU + 0.8, ...stand.map(s => s[0]).filter(a => a >= edgeU));
          const lo = Math.min(edgeU, next), hi = Math.max(edgeU, next);
          (gaps[lo.toFixed(2)] = gaps[lo.toFixed(2)] || { lo, hi, ls: [] }).ls.push(l);
        });
        Object.values(gaps).forEach(g => g.ls.forEach((l, i) => (l.u = g.lo + (i + 1) * (g.hi - g.lo) / (g.ls.length + 1))));
      }
      ls.forEach(l => (l.to = landed[l.edge.id] = toWorld(r, l.u, v)));
    });
    Object.values(lanes).forEach(l => {
      if (l.aim) return laneG.add(SeatFX.arc(l.from, l.to, l.colors, { width: l.blocked ? 0.021 : 0.0315, curve: l.curve, jitter: 0.08, flare: !l.blocked && !l.plate, drips: l.blocked ? 15 : 30, delay }));
      const from = new T.Vector3(l.from.x, 0, l.from.z), to = new T.Vector3(l.to.x, 0, l.to.z), d = to.distanceTo(from);
      if (l.blocked && d > 1) to.lerp(from, 0.2 / d);   // at the blocker's ground, just at its foot
      // It runs low, a hand's breadth over the page, so wherever a standing card is in its way it passes behind it, under
      // the card's lean, and the card hides it: it never crosses a face.
      const top = l.apex || 0.14, curve = SeatFX.bezier(from, from.clone().lerp(to, 0.25).setY(top), from.clone().lerp(to, 0.75).setY(top), to);
      laneG.add(SeatFX.arc(from, to, [l.color], { width: 0.035, curve, jitter: 0.05, ink: true, dash: true, flare: true, source: true, drips: 6 }));
    });
  }

  // ---- Plates: commander, name, life; standing at the back of each seat ----------------------------------------------
  // A plaque: brass with its patina in a bronze rim riveted like the pages' corner mounts. The name and life are engraved
  // in the book's serif, cut dark with a lit lower lip; the life sits in a sunk panel of the same brass. The commander's
  // face is pressed into a wax seal in the seat's colour that overlaps the plaque's end. The turn player's plaque has a
  // lit ember set into it; a plaque you can choose is rimmed in the signal's light.
  const SERIF = '"IM Fell English", Georgia, serif';
  function bannerTex(p) {
    const cv = document.createElement("canvas"); cv.width = 720; cv.height = 180;
    const x = cv.getContext("2d"), col = COLORS[p.id], mark = H.marks && H.marks.players && H.marks.players[p.id];
    const ring = mark === "selected" ? THEME.signal.selected : mark ? THEME.signal.option : null;
    const X = 30, Y = 36, W = 672, Hh = 126, R = 8, br = IMG[TEXS.bronze], brc = IMG[TEXS.bronzeClean];
    const pat = (img, fb) => (img ? x.createPattern(img, "repeat") : fb);
    if (ring) { x.shadowColor = ring; x.shadowBlur = 34; rr(x, X - 5, Y - 5, W + 10, Hh + 10, R + 4); x.lineWidth = mark === "selected" ? 14 : 8; x.strokeStyle = ring; x.stroke(); x.stroke(); x.shadowBlur = 0; }
    else { x.shadowColor = "rgba(0,0,0,.75)"; x.shadowBlur = 16; x.shadowOffsetY = 5; }
    // The rim: clean bronze, bevelled.
    rr(x, X, Y, W, Hh, R); x.fillStyle = pat(brc, THEME.bronze); x.fill();
    x.shadowColor = "transparent"; x.shadowOffsetY = 0;
    const bev = x.createLinearGradient(0, Y, 0, Y + Hh); bev.addColorStop(0, "rgba(255,236,190,.45)"); bev.addColorStop(0.5, "rgba(255,255,255,0)"); bev.addColorStop(1, "rgba(0,0,0,.5)");
    rr(x, X, Y, W, Hh, R); x.fillStyle = bev; x.fill(); x.lineWidth = 3; x.strokeStyle = "#1e1206"; x.stroke();
    // The field: patinated brass, sunk a step inside the rim.
    const I = 11;
    x.save(); rr(x, X + I, Y + I, W - 2 * I, Hh - 2 * I, 4); x.clip();
    x.fillStyle = pat(br, THEME.bronze); x.fillRect(X, Y, W, Hh);
    const sheen = x.createLinearGradient(0, Y, 0, Y + Hh); sheen.addColorStop(0, "rgba(0,0,0,.3)"); sheen.addColorStop(0.18, "rgba(255,240,200,.12)"); sheen.addColorStop(1, "rgba(0,0,0,.22)");
    x.fillStyle = sheen; x.fillRect(X, Y, W, Hh);
    x.restore();
    rr(x, X + I, Y + I, W - 2 * I, Hh - 2 * I, 4); x.lineWidth = 2; x.strokeStyle = "rgba(20,10,2,.85)"; x.stroke();
    rr(x, X + I + 1.5, Y + I + 2, W - 2 * I - 3, Hh - 2 * I - 3, 4); x.lineWidth = 1; x.strokeStyle = "rgba(255,230,180,.25)"; x.stroke();
    [[X + W - 6, Y + 6], [X + W - 6, Y + Hh - 6]].forEach(([cx, cy]) => { x.beginPath(); x.arc(cx - 0, cy, 4.5, 0, Math.PI * 2); x.fillStyle = "#1a1008"; x.fill(); x.beginPath(); x.arc(cx - 1, cy - 1, 2, 0, Math.PI * 2); x.fillStyle = "rgba(255,220,160,.6)"; x.fill(); });
    // Engraving: a deep cut in near-black ink, a 1-px light bevel on its lower lip, a shadow inside its upper edge.
    const engrave = (t, tx, ty) => {
      x.fillStyle = "rgba(255,238,195,.85)"; x.fillText(t, tx, ty + 1.5);
      x.fillStyle = "#0b0602"; x.fillText(t, tx, ty);
      x.save(); x.globalAlpha = 0.6; x.fillStyle = "#000"; x.fillText(t, tx, ty - 1); x.restore();
    };
    x.textBaseline = "middle";
    const cy = Y + Hh / 2;
    // Life: a sunk panel at the right end, the numerals engraved in it.
    x.font = `400 96px ${SERIF}`;
    const lw = Math.max(126, x.measureText(String(p.life)).width + 40), lx = X + W - I - 8 - lw;
    rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5); x.fillStyle = "rgba(30,16,4,.42)"; x.fill();
    x.save(); rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5); x.clip(); x.shadowColor = "rgba(0,0,0,.8)"; x.shadowBlur = 10; x.shadowOffsetY = 4; x.lineWidth = 6; x.strokeStyle = "rgba(0,0,0,.6)"; x.stroke(); x.restore();
    rr(x, lx, Y + I + 7, lw, Hh - 2 * I - 14, 5); x.lineWidth = 1.5; x.strokeStyle = "rgba(255,230,180,.35)"; x.stroke();
    x.textAlign = "center"; x.font = `400 96px ${SERIF}`;
    x.fillStyle = "rgba(0,0,0,.6)"; x.fillText(p.life, lx + lw / 2, cy + 3);
    x.fillStyle = "#f0dcae"; x.fillText(p.life, lx + lw / 2, cy + 1); x.textAlign = "left";
    // The name, on a band of quieter brass: the patina is burnished off where the lettering is cut, so no blotch crosses it.
    const band = x.createLinearGradient(0, Y + I, 0, Y + Hh - I);
    band.addColorStop(0, "rgba(196,156,92,0)"); band.addColorStop(0.18, "rgba(196,156,92,.72)"); band.addColorStop(0.82, "rgba(176,138,78,.72)"); band.addColorStop(1, "rgba(176,138,78,0)");
    x.fillStyle = band; x.fillRect(160, Y + I, lx - 172, Hh - 2 * I);
    let name = p.name + (p.monarch ? " ♛" : ""), fs = 66;
    x.font = `400 ${fs}px ${SERIF}`;
    while (fs > 40 && x.measureText(name).width > lx - 196) { fs -= 2; x.font = `400 ${fs}px ${SERIF}`; }
    engrave(name, 178, cy + 4);
    if (G.active === p.id) {                                                         // whose turn: a lit ember set into the plaque
      const ex = lx - 30;
      x.beginPath(); x.arc(ex, cy, 16, 0, Math.PI * 2); x.fillStyle = "#1a0c02"; x.fill();
      const g = x.createRadialGradient(ex, cy, 0, ex, cy, 14); g.addColorStop(0, "#fff1c0"); g.addColorStop(0.5, THEME.signal.option); g.addColorStop(1, "rgba(255,120,30,0)");
      x.shadowColor = THEME.signal.option; x.shadowBlur = 24; x.beginPath(); x.arc(ex, cy, 13, 0, Math.PI * 2); x.fillStyle = g; x.fill(); x.shadowBlur = 0;
    }
    // The seal: a pool of wax in the seat's colour over the plaque's left end, rim pressed up, the commander's face in it,
    // a gloss where the lamp catches it.
    const cmd = P.card(p.commander[0]), img = cmd && IMG[P.art(cmd)], sx = 92, sy = cy;
    x.save(); x.shadowColor = "rgba(0,0,0,.7)"; x.shadowBlur = 12; x.shadowOffsetY = 4;
    x.beginPath(); for (let i = 0; i <= 30; i++) { const a = i / 30 * Math.PI * 2, r2 = 74 + Math.sin(i * 2.3) * 3.5 + Math.sin(i * 5.1) * 2.5; x.lineTo(sx + Math.cos(a) * r2, sy + Math.sin(a) * r2); } x.closePath();
    x.fillStyle = col; x.fill(); x.restore();
    const wax = x.createRadialGradient(sx - 22, sy - 26, 4, sx, sy, 78); wax.addColorStop(0, "rgba(255,255,255,.35)"); wax.addColorStop(0.35, "rgba(255,255,255,0)"); wax.addColorStop(0.8, "rgba(0,0,0,.15)"); wax.addColorStop(1, "rgba(0,0,0,.45)");
    x.beginPath(); x.arc(sx, sy, 76, 0, Math.PI * 2); x.fillStyle = wax; x.fill();
    x.beginPath(); x.arc(sx, sy, 56, 0, Math.PI * 2); x.lineWidth = 7; x.strokeStyle = "rgba(0,0,0,.35)"; x.stroke();
    x.beginPath(); x.arc(sx, sy, 60, Math.PI * 0.95, Math.PI * 1.75); x.lineWidth = 3; x.strokeStyle = "rgba(255,255,255,.3)"; x.stroke();
    x.save(); x.beginPath(); x.arc(sx, sy, 52, 0, Math.PI * 2); x.clip();
    if (img) { drawCover(x, img, sx - 52, sy - 52, 104, 104); }
    x.fillStyle = col; x.globalAlpha = 0.45; x.fillRect(sx - 56, sy - 56, 112, 112); x.globalAlpha = 1;
    const pr = x.createRadialGradient(sx, sy, 30, sx, sy, 54); pr.addColorStop(0, "rgba(0,0,0,0)"); pr.addColorStop(1, "rgba(0,0,0,.55)"); x.fillStyle = pr; x.fillRect(sx - 56, sy - 56, 112, 112);
    x.restore();
    return texFrom(cv);
  }
  function banner(p) {
    const m = new T.Mesh(new T.PlaneGeometry(3.2, 0.8), new T.MeshBasicMaterial({ map: bannerTex(p), transparent: true, depthTest: false }));
    m.renderOrder = 10;
    const grp = new T.Group(), pivot = new T.Group();
    m.position.y = 0.42; pivot.add(m); grp.add(pivot); grp.userData.pivot = pivot; grp.userData.plate = m;
    const cmd = P.card(p.commander[0]);
    if (cmd && cmd.zone === "command") {
      // The commander leans beside the plaque, never behind it (the plaque draws over everything), on its piles' side (above
      // it would cross their border); the piles step out past it (fitSeat).
      const me = p.id === P.ME, side = zoneSide(p.id), cm = cardMesh(cmd);
      // (Its foot stands on the table with the plaque's, never sunk through it.)
      const cs = me ? 1.15 : 0.9;
      cm.scale.setScalar(cs); cm.position.set(side * 2.2, cs * CH / 2 + 0.03, -0.06); cm.rotation.z = -0.08 * side;
      const mark = H.marks && H.marks.cards && H.marks.cards[cmd.id];
      if (mark) haloFor(cm, false, mark);
      pivot.add(pickable(cm, { type: "card", id: cmd.id, commander: true }));
    }
    return pickable(grp, { type: "plate", pid: p.id });
  }
  // A seat's mat: graphite felt with a stitched edge in the seat's colour, drawn to the mat's size so edges keep their
  // width. Lit (the field in focus) brightens the felt and the edge; the turn player's mat gets its border inked solid.
  let feltPattern = null;
  function felt(x) {
    if (!feltPattern) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 128;
      const g = cv.getContext("2d");
      for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.045)" : "rgba(0,0,0,.09)"; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
      feltPattern = cv;
    }
    return x.createPattern(feltPattern, "repeat");
  }
  // A seat's page: a thin leaf of vellum written on the tome, with a ruled border in the seat's ink at full strength (so the
  // four seats tell apart at a glance) and small bronze corner mounts. The page is the same picture whatever happens: in
  // focus or on its turn it is lit by its material (layout), and the turn's edge lies on it as its own layer.
  //   It grows and shrinks with its rows without anything on it stretching. The vellum is laid in world units from the
  // page's fixed edge (vellumTex, uv1), so growing only shows more of it. The edge, border and mounts (pageTex, uv) are
  // drawn once per seat and sliced in nine (slicePage): a band PAGE_B wide round the page keeps its width, and only the
  // plain middle between the rules stretches.
  const PAGE_B = 0.8, VEL_TILE = 9;
  function vellumTex(mine) {
    const k = "vellum|" + mine;
    if (TEX[k]) return TEX[k];
    const S = 1024, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const x = cv.getContext("2d"), u = n => n * S / VEL_TILE, vel = IMG[TEXS.vellum];
    x.fillStyle = THEME.page.base; x.fillRect(0, 0, S, S);
    if (vel) x.drawImage(vel, 0, 0, S, S);
    x.fillStyle = mine ? "rgba(255,245,215,.1)" : "rgba(40,25,10,.1)"; x.fillRect(0, 0, S, S);
    // Faint marginalia: ruled lines, so the page reads as written on (20 to a tile, so they meet across tiles).
    x.strokeStyle = "rgba(60,40,15,.12)"; x.lineWidth = u(0.012);
    for (let i = 0; i < 20; i++) { const py = (i + 0.5) * S / 20; x.beginPath(); x.moveTo(0, py); x.lineTo(S, py); x.stroke(); }
    const map = texFrom(cv); map.wrapS = map.wrapT = T.RepeatWrapping; map.channel = 1;
    const normal = imgTex("vellumN"); normal.channel = 1;
    return (TEX[k] = { map, normal });
  }
  // The page's sliced layers, drawn for a w × d page: "mask", its ragged edge as alpha; "ink", the edge browning where hands
  // have held it, the ruled border and the corner mounts; "glow", whose turn it is: the band between the strong rule and the
  // fine one filled in the seat's ink, printed on the page and lit like it, never a light of its own.
  function pageTex(pid, kind, w, d) {
    const k = ["page", kind, pid, w.toFixed(1), d.toFixed(1)].join("|");
    if (TEX[k]) return TEX[k];
    const ppu = Math.min(84, 1300 / w), cv = document.createElement("canvas");
    cv.width = Math.round(w * ppu); cv.height = Math.round(d * ppu);
    const x = cv.getContext("2d"), u = n => n * ppu, m = u(0.16), R = u(0.12), W = cv.width - 2 * m, Hh = cv.height - 2 * m;
    // The page's edge is a little ragged, the same way each time it is drawn.
    const page = () => { let sd = 7 + pid.length * 131 + pid.charCodeAt(0); const j = () => ((sd = (sd * 16807) % 2147483647) / 2147483647 - 0.5) * u(0.05); x.beginPath(); x.moveTo(m, m + R); for (let px = m; px <= m + W; px += u(0.5)) x.lineTo(px, m + j()); for (let py = m; py <= m + Hh; py += u(0.5)) x.lineTo(m + W + j(), py); for (let px = m + W; px >= m; px -= u(0.5)) x.lineTo(px, m + Hh + j()); for (let py = m + Hh; py >= m; py -= u(0.5)) x.lineTo(m + j(), py); x.closePath(); };
    const s = u(0.3), ink = THEME.seatInk[pid] || COLORS[pid];
    if (kind === "mask") { x.fillStyle = "#000"; x.fillRect(0, 0, cv.width, cv.height); page(); x.fillStyle = "#fff"; x.fill(); }
    else if (kind === "glow") { x.strokeStyle = ink; x.lineWidth = u(0.2); x.strokeRect(m + s + u(0.04), m + s + u(0.04), W - 2 * s - u(0.08), Hh - 2 * s - u(0.08)); }
    else {
      // Age: the leaf darkens toward its edge, within the band that keeps its width, and browns softly right at it; no line
      // is drawn round it.
      x.save(); page(); x.clip();
      [[0, 1], [1, 0]].forEach(([ax, ay]) => [0, 1].forEach(e => {
        const g = ax ? x.createLinearGradient(e ? cv.width : 0, 0, e ? cv.width - u(PAGE_B) : u(PAGE_B), 0) : x.createLinearGradient(0, e ? cv.height : 0, 0, e ? cv.height - u(PAGE_B) : u(PAGE_B));
        g.addColorStop(0, "rgba(70,45,15,.2)"); g.addColorStop(1, "rgba(70,45,15,0)"); x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
      }));
      x.lineWidth = u(0.16); x.strokeStyle = "rgba(120,80,35,.16)"; page(); x.stroke();
      x.restore();
      // The ruled border in the seat's ink: a strong rule and a fine one inside it.
      x.strokeStyle = ink;
      x.lineWidth = u(0.08); x.strokeRect(m + s, m + s, W - 2 * s, Hh - 2 * s);
      x.lineWidth = u(0.025); x.strokeRect(m + s + u(0.13), m + s + u(0.13), W - 2 * s - u(0.26), Hh - 2 * s - u(0.26));
      // Bronze corner mounts, small.
      const br = IMG[TEXS.bronzeClean];
      x.fillStyle = br ? x.createPattern(br, "repeat") : THEME.bronze; x.strokeStyle = "#2a1a08"; x.lineWidth = u(0.02);
      [[m, m, 1, 1], [m + W, m, -1, 1], [m, m + Hh, 1, -1], [m + W, m + Hh, -1, -1]].forEach(([cx, cy, dx, dy]) => {
        x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = u(0.04); x.shadowOffsetY = u(0.012);
        x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + dx * u(0.4), cy); x.lineTo(cx + dx * u(0.31), cy + dy * u(0.1)); x.lineTo(cx + dx * u(0.1), cy + dy * u(0.1)); x.lineTo(cx + dx * u(0.1), cy + dy * u(0.31)); x.lineTo(cx, cy + dy * u(0.4)); x.closePath(); x.fill();
        x.shadowColor = "transparent"; x.stroke();
        x.beginPath(); x.arc(cx + dx * u(0.065), cy + dy * u(0.065), u(0.022), 0, Math.PI * 2); x.fillStyle = "#1a1008"; x.fill(); x.fillStyle = br ? x.createPattern(br, "repeat") : THEME.bronze;   // a rivet
      });
    }
    return (TEX[k] = texFrom(cv));
  }
  // Lay the page's plane out for a w × d page: the band round it PAGE_B wide in world units, the middle what is left (uv,
  // against the layers drawn for tw × td); the vellum in world units from the fixed edge (uv1). The plane stays a unit
  // square scaled to the page.
  function slicePage(mesh, w, d) {
    const geo = mesh.geometry, tw = mesh.userData.tw, td = mesh.userData.td, bx = Math.min(0.5, PAGE_B / w), by = Math.min(0.5, PAGE_B / d);
    const xs = [-0.5, -0.5 + bx, 0.5 - bx, 0.5], ys = [0.5, 0.5 - by, -0.5 + by, -0.5];
    const us = [0, PAGE_B / tw, 1 - PAGE_B / tw, 1], vs = [1, 1 - PAGE_B / td, PAGE_B / td, 0];
    const pos = geo.attributes.position, uv = geo.attributes.uv, uv1 = geo.attributes.uv1;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const n = j * 4 + i; pos.setXY(n, xs[i], ys[j]); uv.setXY(n, us[i], vs[j]); uv1.setXY(n, xs[i] * w / VEL_TILE + 0.37, (ys[j] + 0.5) * d / VEL_TILE + 0.21); }
    pos.needsUpdate = uv.needsUpdate = uv1.needsUpdate = true;
    geo.computeBoundingSphere();
    mesh.scale.set(w, d, 1);
  }

  // ---- The stack: floating over the centre of the table, top spell in front ------------------------------------------
  let stackG = null, stackBox = null, tableMesh = null, landing = 0;
  // Where an object sits on screen, in CSS pixels: for overlays placed beside it.
  function screenBox(o) {
    const b = new T.Box3().setFromObject(o), r = { left: 1e9, top: 1e9, right: -1e9, bottom: -1e9 };
    [b.min.x, b.max.x].forEach(x => [b.min.y, b.max.y].forEach(y => [b.min.z, b.max.z].forEach(z => {
      const p = project(new T.Vector3(x, y, z));
      r.left = Math.min(r.left, p.x); r.right = Math.max(r.right, p.x); r.top = Math.min(r.top, p.y); r.bottom = Math.max(r.bottom, p.y);
    })));
    return r;
  }
  // Where a card's face is on screen, in px (its effects and shadow left out).
  function faceBox(m) {
    m.updateWorldMatrix(true, false);
    const ps = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project(m.localToWorld(new T.Vector3(a * CW / 2, b * CH / 2, 0))));
    return { left: Math.min(...ps.map(p => p.x)), right: Math.max(...ps.map(p => p.x)), top: Math.min(...ps.map(p => p.y)), bottom: Math.max(...ps.map(p => p.y)) };
  }
  // What each card says, on screen, where the board is going: for every card on the table and on the stack, the boxes
  // of its face, its name strip (top sixth) and its foot (bottom sixth), in px, so an overlay can keep off them. A piece
  // still moving is taken at its target, with the lean it has now.
  function cardBoxes() {
    const out = targets().out, boxes = [], M = new T.Matrix4(), S = new T.Vector3();
    const faceOf = o => { let f = null; o.traverse(m => { if (!f && m.isMesh && m.visible && m.material && m.material.userData && m.material.userData.dim) f = m; }); return f; };
    const add = (face, world) => {
      face.geometry.computeBoundingBox();
      const b = face.geometry.boundingBox, z = (b.min.z + b.max.z) / 2, h = b.max.y - b.min.y;
      const box = (y0, y1) => { const ps = [[b.min.x, y0], [b.max.x, y0], [b.max.x, y1], [b.min.x, y1]].map(([x, y]) => project(new T.Vector3(x, y, z).applyMatrix4(world))); return { l: Math.min(...ps.map(p => p.x)), r: Math.max(...ps.map(p => p.x)), t: Math.min(...ps.map(p => p.y)), b: Math.max(...ps.map(p => p.y)) }; };
      boxes.push({ face: box(b.min.y, b.max.y), name: box(b.max.y - h / 6, b.max.y), foot: box(b.min.y, b.min.y + h / 6) });
    };
    Object.entries(pieces).forEach(([k, pc]) => {
      const t = out[k], face = ["floor", "plate", "zone"].includes(pc.role) ? null : faceOf(pc.obj);
      if (!face || !t || t.hide) return;
      pc.obj.updateWorldMatrix(true, true);
      const rel = M.copy(pc.obj.matrixWorld).invert().multiply(face.matrixWorld);
      add(face, new T.Matrix4().compose(t.pos, pc.obj.quaternion, S.setScalar(t.s || 1)).multiply(rel));
    });
    if (stackG && stackG.visible) stackG.children.forEach(m => {
      const f = m.userData.pick && faceOf(m), rest = m.userData.rest;
      if (!f) return;
      m.updateWorldMatrix(true, true);
      const rel = M.copy(m.matrixWorld).invert().multiply(f.matrixWorld), at = rest ? new T.Matrix4().compose(rest.pos, rest.q, S.setScalar(rest.s)) : m.matrix;
      add(f, new T.Matrix4().copy(stackG.matrixWorld).multiply(at).multiply(rel));
    });
    return boxes;
  }
  // The open table in the middle, on screen (1180×820 units): below the page across, between the side pages, above the
  // tops of my creatures, measured where the pages are going (`out`). The stack and combat stand there, so they cover no page.
  function openMiddle(out = targets().out) {
    const u = uPx(), box = (pid, f) => {
      const t = out["floor" + pid]; if (!t) return null;
      const ps = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => project(toWorld({ x: t.pos.x, z: t.pos.z, yaw: t.floor.yaw }, a * t.floor.w / 2 * t.s, b * t.floor.d / 2 * t.s)));
      return f(ps.map(p => p.x / u), ps.map(p => p.y / u));
    };
    const across = SEATS.find(p => p.id !== P.ME && BASE[p.id].x === 0), left = SEATS.find(p => BASE[p.id].x < 0), right = SEATS.find(p => BASE[p.id].x > 0);
    let t = across ? box(across.id, (xs, ys) => Math.max(...ys)) : 60, b = box(P.ME, (xs, ys) => Math.min(...ys)) || 600;
    Object.entries(pieces).forEach(([k, pc]) => {                     // my creatures' tops, leaning back over my page's edge
      const o = out[k]; if (pc.pid !== P.ME || pc.role !== "creature" || !o) return;
      b = Math.min(b, project(o.pos.clone().add(new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH)).multiplyScalar(CH * (o.s || 1)))).y / u);
    });
    const l = left ? box(left.id, xs => Math.max(...xs)) : 60, r = right ? box(right.id, xs => Math.min(...xs)) : 1120;
    return { l, r, t: (t || 60) + 10, b: b - 10 };
  }
  // A stack entry is itself, not its card: two activations of one source are two entries (the view's own id for each).
  function stackKey(s) { return s.id != null ? "s" + s.id : "c" + s.card; }
  // The cards on the battlefield a stack entry touches: what it targets, and for a sweep with no targets ("Exile all
  // creatures", "Destroy each nonland permanent") everything it reads as sweeping, so they stay lit and uncovered too.
  function stackTouches(s) {
    const ids = (s.targets || []).filter(t => typeof t === "number");
    const c = P.card(s.card), text = (s.text || "") + " " + ((s.spell !== false && c && !c.faceDown && (P.face(c) || {}).text) || "");   // (an ability's own text; a spell's rules text too)
    const sweep = /\b(?:all|each)\s+(?:other\s+)?(?:(creatures?)|(?:nonland\s+)?(permanents?))\b/i.exec(text);
    if (!sweep) return ids;
    const hit = pc => pc.role !== "zone" && pc.role !== "plate" && pc.role !== "floor" && (sweep[1] ? pc.role === "creature" : pc.role !== "mana" || !/nonland/i.test(sweep[0]));
    return ids.concat(Object.values(pieces).filter(hit).flatMap(pc => pc.ids));
  }
  function buildStack(n = G.stack.length, origin = null, ms = 0) {
    const items = G.stack.slice(G.stack.length - n);
    const sig = items.map(s => stackKey(s) + ":" + s.card + ":" + s.controller + ":" + (s.spell === false) + ":" + JSON.stringify(s.targets || [])).join(",") + "|" + layer();   // (its place keeps clear of its targets)
    if (stackG && stackG.userData.sig === sig) {   // the same spells: keep them, and remember where they are
      stackG.children.filter(m => m.userData.pick).forEach(m => { const s = items.find(x => stackKey(x) === m.userData.stackKey); if (s) { s._pos = m.position.clone(); s._scale = m.scale.x; s._q = m.quaternion.clone(); } picks.push(...m.children.filter(o => o.isMesh), m); });
      return;
    }
    const had = {};                                 // where the cards already on the stack stood, to move on from there
    if (stackG) {
      stackG.children.forEach(m => m.userData.pick && (had[m.userData.stackKey] = { pos: m.position.clone(), s: m.scale.x }));
      if (stackG.parent) stackG.parent.remove(stackG); stackG.traverse(o => { const i = picks.indexOf(o); if (i >= 0) picks.splice(i, 1); }); dispose(stackG);
    }
    stackG = new T.Group(); stackG.userData.sig = sig; root.add(stackG);
    const camPos = new T.Vector3(CAM.pos.x, CAM.pos.y, CAM.pos.z);
    // Set aside, the top spell stands at the left of the open middle, raised off the table, all of them a size smaller
    // than that space allows (never under the floor); each under it a step to the right and back, so its name and art
    // show beside the top one. Up, the stack is the table's focus: it comes forward over the middle, centred, as large as
    // it can be without covering what it points at (at the least as large as the open middle allows).
    const big = layer(), M = openMiddle(), u = uPx(), camUp = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), camRight = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const fitW = (M.r - M.l - 16) / (CW * (0.9 * items.length + 0.1)), mid = Math.max(FLOOR.any * 1.1 / CW, Math.min(240, M.b - M.t, fitW));
    let hPx = big ? mid : Math.max(FLOOR.any * 1.1 / CW, mid * 0.75), cy = (M.t + M.b) / 2, x0 = M.l + 16 + hPx * CW / 2, raise = big ? 3 : 1.6;
    if (big) {
      // What it points at, on screen where the board is going (a standing card's face, a plaque), with a margin.
      // (A tapped standee lies turned: as wide as it is tall.)
      const out = targets().out, U = new T.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH)), aimed = [], keys = new Set();
      items.forEach(s => (s.targets || []).filter(tg => typeof tg !== "number").concat(stackTouches(s)).forEach(tg => {
        const k = typeof tg === "number" ? Object.keys(pieces).find(kk => pieces[kk].role !== "zone" && pieces[kk].ids.includes(tg)) : "plate" + tg, o = k && out[k];
        if (!o || o.hide || keys.has(k)) return;
        keys.add(k);
        const plate = k.startsWith("plate"), turned = !plate && ["creature", "walker"].includes(pieces[k].role) && !!(P.card(pieces[k].ids[0]) || {}).tapped;
        const os = o.s || 1, wide = plate ? 1.6 : (turned ? CH : CW) / 2, tall = plate ? 0.82 : turned ? CW : CH;
        const ps = [-1, 1].flatMap(sx => [0, tall * os].map(du => project(o.pos.clone().add(new T.Vector3(sx * wide * os, 0, 0)).addScaledVector(U, du))));
        aimed.push({ l: Math.min(...ps.map(p => p.x)) / u - 10, r: Math.max(...ps.map(p => p.x)) / u + 10, t: Math.min(...ps.map(p => p.y)) / u - 10, b: Math.max(...ps.map(p => p.y)) / u + 10 });
      }));
      // The row of spells as it would stand at height h, centred on (x, y) (the ones under the top a size smaller). Where
      // that covers what it points at, it stands higher, clear above it, or else to one side of it.
      const row = (h, x, y) => { const w = CW * h * (0.9 * items.length + 0.1), l = x - w / 2; return { l, r: l + w, t: y - h / 2, b: y + h / 2 + 12 }; };
      // (Nor may it stand under a plaque, which draws over everything and would hide its name.)
      const plaques = SEATS.map(p => out["plate" + p.id]).filter(o => o && !o.hide).map(o => {
        const ps = [-1, 1].flatMap(sx => [0, 0.82 * (o.s || 1)].map(du => project(o.pos.clone().add(new T.Vector3(sx * 1.6 * (o.s || 1), 0, 0)).addScaledVector(U, du))));
        return { l: Math.min(...ps.map(p => p.x)) / u, r: Math.max(...ps.map(p => p.x)) / u, t: Math.min(...ps.map(p => p.y)) / u, b: Math.max(...ps.map(p => p.y)) / u };
      });
      const hits = b => aimed.concat(plaques).some(a => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t);
      const most = Math.min(290, (M.r - M.l + 120) / (CW * (0.9 * items.length + 0.1)));
      const xm = (M.l + M.r) / 2, ways = (h, w = CW * h * (0.9 * items.length + 0.1)) => [[xm, cy], ...aimed.map(a => [xm, a.t - h / 2 - 14]), [M.l + w / 2, cy], [M.r - w / 2, cy]];
      let clear = false;
      find: for (let h = most; h > mid; h -= 10) for (const [x, y] of ways(h)) {
        const b = row(h, x, y);
        if (b.t < 46 || b.l < M.l - 60 || b.r > M.r + 60 || hits(b)) continue;
        hPx = h; x0 = b.l + h * CW / 2; cy = y; clear = true; break find;
      }
      // None clear of what it touches (a sweep touches every creature): it stands as it does set aside, in the open
      // middle, where it covers no page, and what it touches stays in sight.
      if (!clear && aimed.length) { hPx = Math.max(FLOOR.any * 1.1 / CW, mid * 0.75); x0 = M.l + 16 + hPx * CW / 2; raise = 1.6; }
    }
    const at0 = tableAt(x0, cy, raise), per = Math.abs(project(at0.clone().addScaledVector(camUp, 0.5)).y - project(at0.clone().addScaledVector(camUp, -0.5)).y) / u;
    const sc0 = hPx / per;
    items.slice().reverse().forEach((s, j) => {                 // bottom first, so the top lands in front
      const i = items.length - 1 - j, c = P.card(s.card), m = cardMesh(c);
      // Its edge and back are its own, not the shared ones, so the whole card can fade (leaning in, sitting back).
      const own = x => (x === MAT.hidden || x.userData.dim ? x : Object.assign(x.clone(), { userData: { cardPart: true } }));
      m.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); });
      const sc = sc0 * (i === 0 ? 1 : 0.8) * (s.spell === false ? 0.72 : 1);   // abilities sit smaller than spells
      m.scale.setScalar(sc);
      m.position.copy(at0).addScaledVector(camRight, i * 0.9 * CW * sc0).addScaledVector(camUp, i * 0.1 * sc0).add(new T.Vector3(0, 0, -0.5 * i));
      m.lookAt(camPos);
      // A cast spell is the real thing: its mana crackles off the card. A shadow under it keeps it off the page.
      const drop = new T.Mesh(GEO.halo, MAT.drop); drop.position.set(0.05, -0.08, -TH * 3); drop.scale.setScalar(0.95); m.add(drop);
      SeatFX.spell(m, colorsOf(c), CW, s.spell === false ? 0.5 : 1, s.card);
      const tag = new T.Mesh(new T.PlaneGeometry(0.62, 0.2), new T.MeshBasicMaterial({ map: tagTex(s.spell === false ? "Ability" : P.player(s.controller).name, COLORS[s.controller]), transparent: true }));
      tag.position.set(0, -CH / 2 - 0.02, 0.02); m.add(tag);
      if (hPx > mid) { tag.scale.setScalar(mid / hPx); tag.position.y = -CH / 2 + 0.08 - 0.1 * mid / hPx; }   // (the owner's tag stays the size it was)
      if (big) m.renderOrder = 10;
      m.userData.owner = s.controller;                // where it goes when it resolves, if the view no longer says
      m.userData.ability = s.spell === false; m.userData.stackKey = stackKey(s);
      stackG.add(pickable(m, { type: "card", id: s.card, stack: true }));
      s._pos = m.position.clone(); s._scale = sc; s._q = m.quaternion.clone();
      m.userData.rest = { pos: s._pos, s: sc, q: s._q };   // where it comes to rest, however it gets there (cardBoxes)
      // The whole stack's box, for its panel to stand beside, not over the cards under the top one.
      const b = faceBox(m);
      stackBox = j === 0 ? b : { left: Math.min(stackBox.left, b.left), right: Math.max(stackBox.right, b.right), top: Math.min(stackBox.top, b.top), bottom: Math.max(stackBox.bottom, b.bottom) };
      const from = origin && ms ? origin(s) : null, was = had[stackKey(s)];
      if (!from && was && ms) {                     // already on the stack: it moves over for what came on top, never jumps
        const to = m.position.clone();
        m.position.copy(was.pos); m.scale.setScalar(was.s);
        tween(ms, k => { m.position.lerpVectors(was.pos, to, k); m.scale.setScalar(lerp(was.s, sc, k)); });
      }
      if (from) {                                   // fly in from where it was cast or activated
        // (Up as the focus, it covers most of its way first and grows to that size only at the end, where it stands clear
        // of what it points at: on the way it is a card's size, never one large over the table.)
        const to = m.position.clone(), s0 = big ? Math.min(sc * 0.5, 1.3) : sc * 0.5, grow = big ? 0.75 : 0;
        m.position.copy(from); m.scale.setScalar(s0); stackArrive = Math.max(stackArrive, performance.now() + ms);
        SeatFX.burst(m, colorsOf(c), { ms: ms + 300, n: 160, spread: 1.2 });                 // it ignites as it is cast
        // While it flies, the page says so (body.stack-landing): the prompt holds its alarm until the spell has landed.
        landing++; document.body.classList.add("stack-landing");
        // (An opponent's comes down off their own page into the open middle and along it, never across another seat's
        // cards, where it would seem to be aimed at them: fightPath.)
        const way = s.controller !== P.ME ? fightPath(from, to, true) : null;
        tween(ms, k0 => { const k = big ? 1 - (1 - k0) * (1 - k0) : k0; if (way) { way(k, m.position); m.position.y += Math.sin(k * Math.PI) * 0.3; } else { m.position.lerpVectors(from, to, k); m.position.y += Math.sin(k * Math.PI) * 1.2; } m.scale.setScalar(lerp(s0, sc, smooth(grow, 1, k0))); })
          .then(() => { if (--landing <= 0) { landing = 0; document.body.classList.remove("stack-landing"); } });
      }
    });
  }
  function tagTex(text, col) {
    const k = "tag|" + text + col;
    if (TEX[k]) return TEX[k];
    const cv = document.createElement("canvas"); cv.width = 248; cv.height = 80;
    const x = cv.getContext("2d");
    rr(x, 4, 4, 240, 72, 6); x.fillStyle = IMG[TEXS.vellum] ? x.createPattern(IMG[TEXS.vellum], "repeat") : THEME.bone; x.fill();
    x.lineWidth = 3; x.strokeStyle = "rgba(40,22,5,.85)"; x.stroke();
    x.beginPath(); for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r2 = 16 + (i % 2 ? 2 : -1); x.lineTo(30 + Math.cos(a) * r2, 40 + Math.sin(a) * r2); } x.closePath(); x.fillStyle = col; x.fill(); x.lineWidth = 1.5; x.strokeStyle = "rgba(0,0,0,.4)"; x.stroke();
    x.font = `700 44px ${NUM}`; x.fillStyle = THEME.ink; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 140, 42, 180);
    return (TEX[k] = texFrom(cv));
  }

  // ---- Overlays: hand, what's happening and what you can do, scenarios ----------------------------------------------
  let handBox, statusEl, scenEl;
  const DECIDE = {
    early: ["Your main phase", "Pass"], mid: ["Your main phase", "To combat"], attack: ["Blocks are in — damage next", "Deal damage"],
    defend: ["Bo attacks you — choose blockers", "No blocks"], late: ["Ana's main phase — you have priority", "Pass"],
  };
  function buildOverlay() {
    overlay = el("div", "g-overlay");
    stageEl.appendChild(overlay);
    handBox = el("div", "g-hand"); overlay.appendChild(handBox);
    statusEl = el("div", "h-status"); overlay.appendChild(statusEl);
    scenEl = el("div", "h-scen");
    Object.entries(window.Scenario ? Scenario.list : {}).forEach(([k, s]) => {
      const b = el("button", "", P.esc(s.title)); b.dataset.k = k;
      b.addEventListener("click", () => loadScenario(k)); scenEl.appendChild(b);
    });
    overlay.appendChild(scenEl);
  }
  // The hand follows the board: what a resolving spell does to it (draws, discards) shows once the spell has landed.
  let handAt = 0, handT = 0;
  function syncOverlay() {
    const drawHand = () => { if (!(H.handOpts && H.handOpts.render)) handBox.innerHTML = ""; K.hand(handBox, H.handOpts); };
    clearTimeout(handT);
    if (handAt > performance.now()) handT = setTimeout(drawHand, handAt - performance.now()); else drawHand();
    if (LIVE) { scenEl.hidden = true; if (H.overlay) H.overlay({ statusEl, handBox, overlay }); return; }
    handBox.querySelectorAll(".hcard").forEach(h => { if (!G.playable.includes(+h.dataset.id)) h.classList.replace("playable", "unplayable"); else h.classList.replace("unplayable", "playable"); });
    const [what, act] = DECIDE[Scenario.current] || ["", "Pass"];
    statusEl.innerHTML = `<div class="turn">Turn ${G.turn} · ${P.esc(G.phase)}</div><div class="what">${P.esc(what)}</div><button class="act">${P.esc(act)}</button>`;
    statusEl.querySelector(".act").addEventListener("click", e => { e.target.textContent = "Interactions come next"; });
    scenEl.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === Scenario.current));
  }
  function loadScenario(k) {
    closeModals(); unsift(); focus = null;
    Scenario.load(k);
    buildBoard(); syncOverlay();                     // a jump between unrelated boards cuts: a dev tool, not a game moment
    if (G.decision === "blockers") markBlockers();
    try { localStorage.setItem("h-scenario", k); } catch (e) {}
  }
  // Choosing blockers: my untapped creatures glow.
  function markBlockers() {
    Object.values(pieces).forEach(pc => {
      if (pc.pid === P.ME && pc.role === "creature" && !P.card(pc.ids[0]).tapped && pc.obj.userData.haloParent) haloFor(pc.obj.userData.haloParent, false);
    });
  }

  // ---- Modals: one at a time; close with ✕, a tap outside or Escape ------------------------------------------------
  function closeModals() { document.querySelectorAll(".scrim, .g-modal").forEach(m => m.remove()); }
  function modal(scrim, box) {
    const x = el("button", "g-close", "✕"); x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => scrim.remove());
    (box.querySelector(".info") || box).appendChild(x);             // in the leaf's corner, not floating over the card image
    let downOnScrim = false;
    scrim.addEventListener("pointerdown", e => (downOnScrim = e.target === scrim));
    scrim.addEventListener("pointerup", e => { if (downOnScrim && e.target === scrim) scrim.remove(); downOnScrim = false; });
    return scrim;
  }
  function inspect(id) { closeModals(); P.inspect(id); }
  // Every inspector, wherever it was opened (a hand card, a related card), gets the same ✕ and closing.
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => {
    if (nd.classList && nd.classList.contains("scrim") && !nd.querySelector(".g-close") && document.querySelector(".proto-h:not([hidden])")) {
      const box = nd.querySelector(".inspector, .sheet"); if (box) modal(nd, box);
    }
  }))).observe(document.body, { childList: true });
  function profile(p) {
    closeModals();
    const scrim = el("div", "g-modal scrim-like seat-" + p.id);
    const box = el("div", "g-profile");
    const cmd = P.card(p.commander[0]);
    const dmg = Object.entries(p.commanderDamage || {}).map(([src, n]) => {
      const c = P.card(+src);
      return `<li><span class="av sm" style="background-image:url('${P.art(c)}')"></span>${P.esc(whose(c.owner))} ${P.esc(shortName(c))}<b>${n}<small> / 21</small></b></li>`;
    }).join("");
    box.innerHTML = `
      <header><span class="av" style="background-image:url('${P.art(cmd)}')"></span>
        <div><h3>${P.esc(p.name)}</h3><div class="sub">${P.esc(P.name(cmd))}${cmd.commanderCasts ? ` · cast ${cmd.commanderCasts}×, tax {${cmd.commanderCasts * 2}}` : ""}</div></div>
        <div class="big">${p.life}<small>life</small></div></header>
      ${p.poison || p.monarch ? `<div class="flags">${p.poison ? `<span>${p.poison} poison</span>` : ""}${p.monarch ? "<span>♛ Monarch</span>" : ""}</div>` : ""}
      ${dmg ? `<h4>Commander damage taken</h4><ul class="dmg">${dmg}</ul>` : ""}
      <h4>Cards</h4>
      <div class="zones">
        <div><b>${p.handCount}</b>in hand</div>
        <div><b>${p.library}</b>in library</div>
        <button data-z="graveyard"><b>${p.graveyard.length}</b>in graveyard</button>
        <button data-z="exile"><b>${p.exile.length}</b>in exile</button>
      </div>`;
    box.querySelectorAll("[data-z]").forEach(b => b.addEventListener("click", () => { scrim.remove(); const ids = p[b.dataset.z]; if (ids.length) sift(ids, zoneWorld(p, b.dataset.z), `${whose(p.id)} ${b.dataset.z}`); }));
    scrim.appendChild(box);
    document.body.appendChild(modal(scrim, box));
  }
  function zoneWorld(p) { const pc = pieces["plate" + p.id]; return pc.obj.getWorldPosition(new T.Vector3()); }

  // ---- Sifting a pile: its cards rise and fan out in front of the camera ---------------------------------------------
  let sifting = null;
  // `src`: the pile on the table they came from, which they fold back into wherever it has gone by then.
  function sift(ids, fromWorld, title, src = null) {
    if (sifting) unsift();
    src = src || (Object.values(pieces).find(pc => pc.ids.length === ids.length && pc.ids.every((id, i) => id === ids[i])) || {}).obj || null;
    const grp = new T.Group(); scene.add(grp);
    const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
    const shade = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0, depthWrite: false }));
    shade.position.copy(cam.position).addScaledVector(fwd, 6.6); shade.quaternion.copy(cam.quaternion);
    shade.renderOrder = 15;                         // over the plates too; the sifted cards are nearer, so they stay clear
    grp.add(shade);
    const D = 6, vh = 2 * D * Math.tan(T.MathUtils.degToRad(cam.fov / 2)), vw = vh * cam.aspect;
    const n = ids.length, rows = n <= 6 ? 1 : n <= 14 ? 2 : n <= 27 ? 3 : 4, cols = Math.ceil(n / rows);   // a big pile in more rows, so its cards stay large enough to read
    const sc = Math.min(1.25, (vw * 0.86) / (cols * (CW + 0.08)), (vh * 0.7) / (rows * (CH + 0.1)));
    const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const centre = cam.position.clone().addScaledVector(fwd, D).addScaledVector(up, -vh * 0.04);
    const cards = ids.map((id, i) => {
      const c = P.card(id), m = cardMesh(c);
      facesOf(m).forEach(f => (f.userData.tap.value = c.tapped ? 1 : 0));
      const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - r * cols);
      const to = centre.clone().addScaledVector(right, (k - (inRow - 1) / 2) * (CW + 0.08) * sc).addScaledVector(up, ((rows - 1) / 2 - r) * (CH + 0.1) * sc);
      m.position.copy(fromWorld); m.quaternion.setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)); m.scale.setScalar(0.9);
      m.userData.pick = { type: "card", id, sift: true };
      grp.add(m);
      // A tapped card is turned 15° as well as shaded, as it lies on the table, and a little smaller so it keeps its gap.
      const q1 = cam.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), c.tapped ? -Math.PI / 12 : 0));
      return { m, from: fromWorld.clone(), to, q0: m.quaternion.clone(), q1, s: c.tapped ? sc * 0.86 : sc, i };
    });
    sifting = { grp, cards, shade, title, src };
    // The title says what the pile is and how many, and how to use it.
    const tapped = ids.filter(id => P.card(id).tapped).length, count = /×\d/.test(title) || n < 2 ? "" : ` ×${n}`;
    const cap = el("div", "g-sifttitle", `<span><b>${P.esc(title + count)}${tapped ? `<i> · ${tapped} tapped</i>` : ""}</b><small>Tap a card to look at it; tap away to put them back</small></span>`);
    const x = el("button", "g-close", "✕"); x.setAttribute("aria-label", "Put back"); x.addEventListener("click", unsift); cap.appendChild(x);
    // It sits right above the fanned cards, so the instruction belongs to them; the prompt below steps back meanwhile.
    const topY = project(centre.clone().addScaledVector(up, rows * (CH + 0.1) * sc / 2)).y;
    cap.style.top = Math.max(10, topY - 14) + "px"; cap.style.transform = "translate(-50%, -100%)";
    overlay.appendChild(cap); sifting.cap = cap; document.body.classList.add("sifting");
    tween(520, k => {
      shade.material.opacity = 0.72 * k;
      cards.forEach(o => {
        const kk = Math.max(0, Math.min(1, k * 1.4 - o.i * 0.4 / n));
        o.m.position.lerpVectors(o.from, o.to, kk); o.m.position.addScaledVector(up, Math.sin(kk * Math.PI) * 0.6);
        o.m.quaternion.slerpQuaternions(o.q0, o.q1, kk); o.m.scale.setScalar(lerp(0.9, o.s, kk));
      });
    });
  }
  function unsift() {
    if (!sifting) return;
    const s = sifting; sifting = null; s.cap.remove(); document.body.classList.remove("sifting");
    // Back into their pile, following it if the page it lies on is moving too, and gone as they reach it.
    const home = new T.Vector3();
    tween(380, k => {
      s.shade.material.opacity = 0.72 * (1 - k);
      if (s.src && s.src.parent) s.src.getWorldPosition(home); else home.copy(s.cards.length ? s.cards[0].from : home);
      s.cards.forEach(o => { o.m.position.lerpVectors(o.to, home, k); o.m.scale.setScalar(lerp(o.m.scale.x, s.src ? s.src.scale.x * 0.9 : 0.9, k)); o.m.visible = k < 0.97; });
    }).then(() => scene.remove(s.grp));
  }



  // ---- Touch: tap to look, hold to peek. Tap an opponent to lean in on their board; tap away to sit back. -------------
  let gesture = null, peekEl = null, holdTimer = null;
  function pickAt(x, y) {
    raycaster.setFromCamera(new T.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
    const pool = sifting ? sifting.cards.flatMap(o => o.m.children) : picks;
    const hits = [];
    for (const hit of raycaster.intersectObjects(pool, false)) {
      let o = hit.object, vis = true, top = o;
      for (let q = o; q; q = q.parent) { if (!q.visible) vis = false; top = q; }
      if (!vis || top !== scene) continue;
      while (o && !o.userData.pick) o = o.parent;
      if (o) hits.push({ pick: o.userData.pick, obj: o });
    }
    return hits.find(h => h.pick.type === "plate") || hits[0] || null;      // plates draw over everything, so they win
  }
  function focusOn(pid) { focus = pid === P.ME ? null : pid; if (H.onFocus) H.onFocus(focus); buildBoard(500); }
  function onDown(e) {
    gesture = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (!gesture || gesture.moved) return;
      const h = pickAt(gesture.x, gesture.y);
      if (h && h.pick.type === "card") { gesture.peek = true; peekEl = peek(P.card(h.pick.id), gesture); }
    }, 380);
  }
  function onMove(e) {
    if (gesture && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 10) gesture.moved = true;
    if (gesture && gesture.moved && H.dragMove && !sifting) H.dragMove(gesture.from || (gesture.from = pickAt(gesture.x, gesture.y)), e.clientX, e.clientY, pickAt(e.clientX, e.clientY));
  }
  function onUp(e) {
    clearTimeout(holdTimer);
    const g = gesture; gesture = null;
    if (peekEl) { peekEl.remove(); peekEl = null; return; }
    if (g && g.moved && !g.peek && H.drag && !sifting) { H.drag(g.from || pickAt(g.x, g.y), pickAt(e.clientX, e.clientY)); return; }
    if (!g || g.peek || g.moved || performance.now() - g.t > 500) return;
    const hit = pickAt(g.x, g.y);
    if (sifting) { if (hit && hit.pick.sift) { if (!(H.tap && H.tap(hit.pick, hit, true))) inspect(hit.pick.id); } else unsift(); return; }
    if (H.tap && H.tap(hit && hit.pick, hit)) return;
    if (!hit) { if (focus) focusOn(null); return; }
    const pk = hit.pick;
    if (pk.type === "seat") return focusOn(focus === pk.pid ? null : pk.pid);
    if (pk.type === "plate") return pk.pid === P.ME || focus === pk.pid ? profile(P.player(pk.pid)) : focusOn(pk.pid);
    if (pk.type === "card") return inspect(pk.id);
    if (pk.type === "pile") return sift(pk.ids, hit.obj.getWorldPosition(new T.Vector3()), pk.title, hit.obj);
    if (pk.type === "zone") {
      const p = P.player(pk.pid), z = pieces["z" + pk.zone + pk.pid], ids = z && z.obj.userData.landed ? z.obj.userData.landed() : p[pk.zone];   // what has landed there, as its sign counts
      if (Array.isArray(ids) && ids.length) sift(ids, hit.obj.getWorldPosition(new T.Vector3()), `${whose(p.id)} ${pk.zone}`);
      else profile(p);
    }
  }
  function closePeek() { if (peekEl) { peekEl.remove(); peekEl = null; } }
  // A world point on screen, in CSS pixels: for overlays that point at pieces.
  function project(v, c = cam) { const p = v.clone().project(c); return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight }; }
  function peek(c, at) {
    const p = el("div", "g-peek");
    if (c.faceDown) p.classList.add("back"); else p.style.backgroundImage = `url("${P.image(c)}")`;
    p.style.left = Math.max(10, Math.min(innerWidth - 270, at.x - 130)) + "px";
    p.style.top = Math.max(10, at.y - 400) + "px";
    document.body.appendChild(p);
    return p;
  }

  // ---- Frame loop -------------------------------------------------------------------------------------------------------
  const tweens = new Set();
  function tween(ms, fn) {
    return new Promise(res => {
      const t0 = performance.now();
      const tw = { step(now) { const k = Math.min(1, (now - t0) / ms); fn(ease(k), k); if (k >= 1) { tweens.delete(tw); res(); } } };
      tweens.add(tw);
    });
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    tweens.forEach(t => t.step(now));
    RIM.time.value = now / 1000;
    RIM.option.setStyle(THEME.signal.option).multiplyScalar(0.7 + 0.3 * Math.sin(now / 420));
    RIM.danger.setStyle(THEME.dangerRim).multiplyScalar(0.72 + 0.28 * Math.pow(Math.max(0, Math.sin(now / 300)), 4));   // a heartbeat, plain at arm's length, and never past full: blood, not light
    Object.values(pieces).forEach(pc => pc.obj.userData.faces.forEach(m => { if (m.userData.rimKind) m.userData.rim.value.copy(RIM[m.userData.rimKind]); }));
    SeatFX.tick(now);
    if (composer) composer.render(); else renderer.render(scene, cam);
    handBox.classList.toggle("away", !!sifting || !!H.handAway);
  }
  function resize() {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    if (composer) { composer.setPixelRatio(Math.min(renderer.getPixelRatio(), 1.5)); composer.setSize(innerWidth, innerHeight); }
    cam.aspect = innerWidth / innerHeight;
    const hHalf = Math.atan(Math.tan(T.MathUtils.degToRad(CAM.fov / 2)) * 1.44);       // keep the table's width on narrower screens
    cam.fov = Math.max(CAM.fov, T.MathUtils.radToDeg(2 * Math.atan(Math.tan(hHalf) / cam.aspect)));
    cam.updateProjectionMatrix();
  }
  // The table: the open tome, seen from above its lower edge. Two pages meet at a spine that folds down into shadow; each
  // page curves up out of the fold and lies flat toward its outer edge, where the page block shows as a stack of fine
  // edges over the leather cover. Canvas units map to the table plane (60 × 50, centred at z = −4).
  function tomeCanvas() {
    const S = 2048, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const x = cv.getContext("2d"), px = wx => (wx + 30) / 60 * S, pz = wz => (wz + 29) / 50 * S, u = S / 60;
    // The cover: dark leather, a blind-tooled rule round it.
    const lea = IMG[TEXS.tome];
    x.fillStyle = "#24160c"; x.fillRect(0, 0, S, S);
    if (lea) { x.globalAlpha = 0.35; x.drawImage(lea, 0, 0, S, S); x.globalAlpha = 1; }
    x.fillStyle = "rgba(20,10,4,.55)"; x.fillRect(0, 0, S, S);
    const L = px(-15.2), Rr = px(15.2), T0 = pz(-15.6), B = pz(7.2), G0 = px(0);
    x.strokeStyle = "rgba(150,110,60,.35)"; x.lineWidth = 3; x.strokeRect(L - u * 1.4, T0 - u * 1.2, Rr - L + u * 2.8, B - T0 + u * 2.4);
    // The spread casts a soft shadow on the cover past its far edge, where the open book lifts off the table.
    const far = x.createLinearGradient(0, T0 - u * 1.6, 0, T0);
    far.addColorStop(0, "rgba(0,0,0,0)"); far.addColorStop(0.7, "rgba(0,0,0,.35)"); far.addColorStop(1, "rgba(0,0,0,.6)");
    x.fillStyle = far; x.fillRect(L - u * 0.9, T0 - u * 1.6, Rr - L + u * 1.8, u * 1.6);
    // The page block: under each page, the edges of the leaves stacked toward the cover in fine light and dark lines.
    [[L, G0], [G0, Rr]].forEach(([x0, x1], i) => {
      const out = i === 0 ? -1 : 1, ox = i === 0 ? x0 : x1;
      for (let k = 12; k >= 1; k--) {
        const o = k * u * 0.045;
        x.fillStyle = k % 2 ? "#c4ae84" : "#6e5a3a";
        x.beginPath(); x.moveTo(G0, T0 - o * 0.6); x.lineTo(ox + out * o, T0 - o * 0.6); x.lineTo(ox + out * o, B + o); x.lineTo(G0, B + o); x.closePath(); x.fill();
      }
    });
    // The pages: pale paper, a little warmer than the fields written on them.
    const vel = IMG[TEXS.vellum];
    [[L, G0], [G0, Rr]].forEach(([x0, x1]) => {
      x.save(); x.beginPath(); x.rect(x0, T0, x1 - x0, B - T0); x.clip();
      x.fillStyle = "#dcc8a0"; x.fillRect(x0, T0, x1 - x0, B - T0);                 // the paper, with the vellum's grain laid faintly over it
      if (vel) { x.globalAlpha = 0.45; for (let yy = T0; yy < B; yy += 1024) for (let xx = x0; xx < x1; xx += 1024) x.drawImage(vel, xx, yy, 1024, 1024); x.globalAlpha = 1; }
      x.globalCompositeOperation = "multiply"; x.fillStyle = "#e6d6ba"; x.fillRect(x0, T0, x1 - x0, B - T0); x.globalCompositeOperation = "source-over";
      x.restore();
    });
    // Each leaf curves, in two broad bands either side of the gutter: it rises out of a deep shaded fold (0.4 dark at the
    // gutter, fading over a fifth of the leaf, a shadow, not a trench) into a wide crest of light, shades as it falls flat
    // toward its outer edge, and darkens
    // again at the very edge where it turns down over the block. Its head and foot shade a little too, where the leaf lifts
    // away from the cover.
    [-1, 1].forEach(sd => {
      const wd = Math.abs((sd < 0 ? L : Rr) - G0), g = x.createLinearGradient(G0, 0, G0 + sd * wd, 0);
      g.addColorStop(0, "rgba(40,22,8,.4)"); g.addColorStop(0.04, "rgba(50,28,10,.32)"); g.addColorStop(0.1, "rgba(70,40,14,.18)"); g.addColorStop(0.2, "rgba(80,48,18,0)");
      g.addColorStop(0.3, "rgba(255,244,220,.34)"); g.addColorStop(0.46, "rgba(255,244,220,.14)"); g.addColorStop(0.6, "rgba(60,35,12,0)");
      g.addColorStop(0.78, "rgba(60,35,12,.15)"); g.addColorStop(0.93, "rgba(60,35,12,.28)"); g.addColorStop(1, "rgba(40,22,8,.52)");
      x.fillStyle = g; x.fillRect(sd < 0 ? L : G0, T0, wd, B - T0);
      // The leaves under the top one show at its outer edge as fine lines, the thickness of the block seen from above.
      for (let k = 1; k <= 5; k++) { x.fillStyle = k % 2 ? "rgba(45,26,8,.55)" : "rgba(255,244,220,.22)"; x.fillRect((sd < 0 ? L : Rr) - sd * u * 0.07 * k - 1, T0, 2, B - T0); }
    });
    const hf = x.createLinearGradient(0, T0, 0, B);
    hf.addColorStop(0, "rgba(50,28,10,.22)"); hf.addColorStop(0.06, "rgba(50,28,10,0)"); hf.addColorStop(0.94, "rgba(50,28,10,0)"); hf.addColorStop(1, "rgba(50,28,10,.22)");
    x.fillStyle = hf; x.fillRect(L, T0, Rr - L, B - T0);
    x.fillStyle = "rgba(30,16,6,.55)"; x.fillRect(G0 - 1.5, T0 - u * 0.7, 3, B - T0 + u * 1.4);   // the fold itself: a hairline
    // The spine's ends show past the page block: leather, with a headband.
    [[T0 - u * 0.7, -1], [B + u * 0.7, 1]].forEach(([yy]) => { rr(x, G0 - u * 0.5, yy - u * 0.25, u, u * 0.5, u * 0.2); x.fillStyle = "#3a2414"; x.fill(); x.fillStyle = "#7a2e3a"; x.fillRect(G0 - u * 0.35, yy - u * 0.08, u * 0.7, u * 0.16); });
    // Foxing.
    for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(120,80,30,${0.02 + Math.random() * 0.05})`; x.beginPath(); x.arc(L + Math.random() * (Rr - L), T0 + Math.random() * (B - T0), 3 + Math.random() * 14, 0, Math.PI * 2); x.fill(); }
    // Lamplight: warm over the middle, falling off toward the far corners.
    const lamp = x.createRadialGradient(S / 2, pz(-2.5), S * 0.06, S / 2, pz(-2.5), S * 0.5);
    lamp.addColorStop(0, "rgba(255,200,130,.1)"); lamp.addColorStop(0.55, "rgba(0,0,0,.06)"); lamp.addColorStop(1, "rgba(10,5,2,.8)");
    x.fillStyle = lamp; x.fillRect(0, 0, S, S);
    return cv;
  }
  function woodCanvas() {
    const S = 2048, cv = document.createElement("canvas"); cv.width = cv.height = S;
    const x = cv.getContext("2d"), wd = THEME.wood;
    x.fillStyle = wd.base; x.fillRect(0, 0, S, S);
    const plank = S / 26;
    for (let r = 0; r < 26; r++) {                                   // planks, each its own shade, with a seam
      x.fillStyle = `rgba(${r % 3 ? "0,0,0" : "255,220,170"},${0.02 + ((r * 37) % 7) / 180})`; x.fillRect(0, r * plank, S, plank);
      for (let i = 0; i < 26; i++) {                                 // grain: long wavy lines along the plank
        const y0 = r * plank + Math.random() * plank, a = 1 + Math.random() * 3, f = 0.002 + Math.random() * 0.004, ph = Math.random() * 6;
        x.beginPath();
        for (let px = 0; px <= S; px += 16) x.lineTo(px, y0 + a * Math.sin(px * f + ph) + 1.5 * Math.sin(px * 0.013 + ph * 2));
        x.lineWidth = 0.6 + Math.random() * 1.8; x.strokeStyle = Math.random() < 0.7 ? "rgba(10,5,2,.26)" : "rgba(255,210,150,.06)"; x.stroke();
      }
      x.fillStyle = "rgba(5,3,1,.75)"; x.fillRect(0, r * plank, S, 2);
    }
    const lamp = x.createRadialGradient(S / 2, S * 0.48, S * 0.05, S / 2, S * 0.48, S * 0.46);
    lamp.addColorStop(0, "rgba(255,200,140,.10)"); lamp.addColorStop(0.55, "rgba(0,0,0,.15)"); lamp.addColorStop(1, "rgba(5,3,2,.92)");
    x.fillStyle = lamp; x.fillRect(0, 0, S, S);
    return cv;
  }
  function buildScene() {
    scene = new T.Scene();
    scene.background = new T.Color(THEME.bg);
    const table = tableMesh = new T.Mesh(new T.PlaneGeometry(60, 50), new T.MeshStandardMaterial({ map: texFrom(tomeCanvas()), normalMap: imgTex("tomeN", [6, 5]), normalScale: new T.Vector2(0.6, 0.6), roughness: 0.95 }));
    SeatFX.init(T, scene, renderer);
    table.rotation.x = -Math.PI / 2; table.position.z = -4; table.receiveShadow = true; table.renderOrder = -4; scene.add(table);   // first: everything lies on it
    // It is the bottom of everything, so it writes no depth: across a plane this large, depth isn't fine enough to keep a page
    // 3 mm above it in front from every point of view, and a leaning view finds angles where the pages and ash drop under it.
    table.material.depthWrite = false;
    // One lamp over the table, warm, and a little of the room: the pages shade by it, the cards never do.
    scene.add(new T.AmbientLight(0xffe6c4, 0.35));
    const lamp = new T.PointLight(0xffc98a, 260, 70, 1.7); lamp.position.set(0, 17, -4); scene.add(lamp);
    const sun = new T.DirectionalLight(0xffe9cc, 0.6);
    sun.position.set(SUN.x, SUN.y, SUN.z); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 60 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun);
    SEATS.forEach(p => (MAT["seat_" + p.id] = new T.MeshBasicMaterial({ color: new T.Color(COLORS[p.id]) })));
  }

  // ---- Prototype hooks --------------------------------------------------------------------------------------------------
  let started = false;
  function mount(stage) {
    stageEl = stage;
    stage.appendChild(el("div", "g-loading", "Setting the table…"));
    Promise.all([import("three"), import("three/addons/postprocessing/EffectComposer.js"), import("three/addons/postprocessing/RenderPass.js"), import("three/addons/postprocessing/UnrealBloomPass.js"), import("three/addons/postprocessing/OutputPass.js")])
      .then(([three, ec, rp, ub, op]) => { T = three; PP = { EffectComposer: ec.EffectComposer, RenderPass: rp.RenderPass, UnrealBloomPass: ub.UnrealBloomPass, OutputPass: op.OutputPass }; return preload(); }).then(() => {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.domElement.className = "g-canvas";
      stage.querySelector(".g-loading").remove();
      stage.appendChild(renderer.domElement);
      cam = new T.PerspectiveCamera(34, innerWidth / innerHeight, 1, 120);
      cam.position.set(CAM.pos.x, CAM.pos.y, CAM.pos.z); cam.lookAt(CAM.at.x, CAM.at.y, CAM.at.z);
      raycaster = new T.Raycaster();
      buildGeometry(); buildScene(); buildOverlay();
      // Light that is brighter than white blooms: the spells and the arcs. Cards and pages never reach it.
      composer = new PP.EffectComposer(renderer, new T.WebGLRenderTarget(innerWidth, innerHeight, { samples: 2, type: T.HalfFloatType }));
      composer.addPass(new PP.RenderPass(scene, cam));
      bloom = new PP.UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.75, 0.55, 1.15);
      composer.addPass(bloom); composer.addPass(new PP.OutputPass());
      const cv = renderer.domElement;
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", () => { gesture = null; clearTimeout(holdTimer); if (peekEl) { peekEl.remove(); peekEl = null; } });
      addEventListener("keydown", e => { if (e.key === "Escape") { closeModals(); unsift(); if (focus) focusOn(null); } });
      let k = "mid"; try { k = new URLSearchParams(location.search).get("s") || localStorage.getItem("h-scenario") || k; } catch (e) {}
      resize();
      if (LIVE) { buildBoard(); syncOverlay(); } else loadScenario(Scenario.list[k] ? k : "mid");
      window.__h = { T, scene, cam, focusOn, loadScenario, sift, unsift, profile, inspect, pickAt, pieces: () => pieces,
        refresh(ms = 500) { closePeek(); buildBoard(ms); syncOverlay(); }, stats: STATS, renderer: () => renderer, layout, loadImage, closeModals, project, get focus() { return focus; },
        stackRect: () => (stackG && stackG.visible ? stackBox : null), poses: () => targets().out, cardBoxes, aims: () => aimPts, stackLanding: () => Math.max(0, stackArrive - performance.now()),
        stackAt: id => { const m = stackG && stackG.children.find(o => o.userData.pick && o.userData.pick.id === id); return m ? faceBox(m) : null; } };
      window.__h.setFocus = pid => { focus = pid && pid !== P.ME ? pid : null; if (H.onFocus) H.onFocus(focus); };
      if (H.ready) H.ready(window.__h);
      started = true;
      if (!stage.hidden) start();
    }).catch(err => { const l = stage.querySelector(".g-loading"); if (l) l.textContent = "Couldn't load three.js: " + err.message; console.error(err); });
  }
  function start() { if (running || !started) return; running = true; resize(); requestAnimationFrame(frame); }
  P.register("h", {
    title: "Seat",
    mount,
    show() { start(); resize(); },
    hide() { running = false; closeModals(); },
  });
})();
