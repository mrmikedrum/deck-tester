// Standees, on WebGL, as a composed stage rather than a world to fly around. The camera never moves.
//   The seat in front is a large tilted mat; the other three sit smaller along the top. Swiping, or tapping a seat,
//   turns them between those places like a turntable. Creatures and planeswalkers stand up facing you; everything
//   else lies on the mat. Tapped cards dim and lean back. Plates show life only; a tap on one opens the rest.
(function () {
  const P = window.Proto, K = window.Kit, G = P.G, DB = window.CARDS;
  const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
  let T = null;                                 // three.js, once loaded

  // ---- Geometry (units: a card is 1 tall) ----------------------------------------------------------------
  const CW = 0.716, CH = 1, TH = 0.014;         // card width, height, thickness
  const S = 1.12;                                // standee scale
  const PHI = 0.96;                              // mats tilt this far up from facing the camera
  const LEAN = Math.PI / 2 - PHI, LEAN_TAPPED = LEAN + 0.5;   // standees lean back to face the camera
  const SEATS = G.players.slice().sort((a, b) => a.seat - b.seat);
  const seatOf = pid => P.player ? P.player(pid).seat : SEATS.find(p => p.id === pid).seat;
  const seatAngle = s => -s * Math.PI / 2;
  const COLORS = { you: "#e8b04b", ana: "#a98bff", bo: "#45c2d8", cy: "#f0806f" };
  const actionable = new Set(G.actionable || []);

  // ---- Small helpers ------------------------------------------------------------------------------------------
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const lerp = (a, b, k) => a + (b - a) * k;
  const angLerp = (a, b, k) => { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * k; };
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const whose = pid => (pid === P.ME ? "Your" : P.player(pid).name + "'s");
  const shortName = c => { const n = P.name(c); return n.length > 15 && n.includes(", ") ? n.split(", ")[0] : n; };
  function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }

  // ---- Images and fonts ---------------------------------------------------------------------------------------
  const IMG = {};
  function loadImage(src) {
    if (!src || IMG[src]) return Promise.resolve();
    return new Promise(res => { const i = new Image(); i.onload = () => { IMG[src] = i; res(); }; i.onerror = () => res(); i.src = src; });
  }
  function preload() {
    const srcs = new Set(Object.values(G.cards).map(c => P.art(c)).filter(Boolean));
    const fonts = document.fonts ? Promise.all(['700 40px "Barlow Condensed"', '600 40px "Barlow Condensed"', '600 30px "Barlow"'].map(f => document.fonts.load(f))) : Promise.resolve();
    const timeout = new Promise(r => setTimeout(r, 3000));
    return Promise.all([Promise.race([fonts, timeout]), ...[...srcs].map(loadImage)]);
  }

  // ---- Card faces, drawn once per distinct look ---------------------------------------------------------------
  const FW = 336, FH = 468;
  const NUM = '"Barlow Condensed", "Arial Narrow", sans-serif';
  function nameLines(x, text, maxW) {
    for (let s = 50; s >= 40; s -= 2) { x.font = `700 ${s}px ${NUM}`; if (x.measureText(text).width <= maxW) return { s, lines: [text] }; }
    const words = text.split(" ");
    for (let s = 44; s >= 30; s -= 2) {
      x.font = `700 ${s}px ${NUM}`;
      const lines = []; let cur = "";
      for (const w of words) { const t = cur ? cur + " " + w : w; if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
      lines.push(cur);
      if (lines.length <= 2 && lines.every(l => x.measureText(l).width <= maxW)) return { s, lines };
    }
    x.font = `700 30px ${NUM}`; return { s: 30, lines: [text] };
  }
  function drawCover(x, img, X, Y, W, H) {
    const r = Math.max(W / img.width, H / img.height), w = img.width * r, h = img.height * r;
    x.drawImage(img, X + (W - w) / 2, Y + (H - h) / 2.6, w, h);
  }
  function pill(x, text, X, Y, bg, fg) {
    x.font = `700 26px ${NUM}`;
    const w = x.measureText(text).width + 22;
    rr(x, X, Y, w, 36, 18); x.fillStyle = bg; x.fill();
    x.fillStyle = fg; x.textBaseline = "middle"; x.fillText(text, X + 11, Y + 19);
    return w;
  }
  function kwIcon(x, k, cx, cy, r) {
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fillStyle = "#14181f"; x.fill();
    x.lineWidth = 3; x.strokeStyle = "rgba(255,255,255,.85)"; x.stroke();
    x.save(); x.translate(cx - r * 0.62, cy - r * 0.62); x.scale(r * 1.24 / 24, r * 1.24 / 24);
    x.fillStyle = "#fff"; x.fill(new Path2D(K.KW[k])); x.restore();
  }
  function gem(x, cx, cy, on) {
    x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4);
    if (on) { x.shadowColor = "#7fe3ff"; x.shadowBlur = 18; }
    rr(x, -15, -15, 30, 30, 5); x.fillStyle = on ? "#8ff0ff" : "#56657a"; x.fill();
    x.lineWidth = 3; x.strokeStyle = on ? "#e9fdff" : "#9aa7b8"; x.stroke(); x.restore();
  }
  const PIP = { W: ["#f3edd2", "#3b3420"], U: ["#5fa4e8", "#0b1a2a"], B: ["#7b6c88", "#fff"], R: ["#e2694f", "#2a0d06"], G: ["#4fae63", "#062010"], C: ["#c2c8d0", "#1a1d22"] };
  function shortType(c) {
    const t = P.typeLine(c), sub = (t.split("—")[1] || "").trim();
    if (/Aura|Equipment|Saga|Class|Vehicle/.test(sub)) return sub.split(" ")[0];
    return t.split("—")[0].replace("Legendary ", "").replace("Snow ", "").trim();
  }
  function drawBack(x, label) {
    const g = x.createLinearGradient(0, 0, FW, FH); g.addColorStop(0, "#1f3355"); g.addColorStop(1, "#0d1424");
    x.fillStyle = "#0b0d12"; x.fillRect(0, 0, FW, FH);
    rr(x, 12, 12, FW - 24, FH - 24, 16); x.fillStyle = g; x.fill();
    x.save(); x.translate(FW / 2, FH / 2);
    for (let i = 0; i < 3; i++) { x.beginPath(); x.ellipse(0, 0, 104 - i * 26, 156 - i * 38, 0, 0, Math.PI * 2); x.lineWidth = 6 - i; x.strokeStyle = `rgba(201,166,74,${0.85 - i * 0.22})`; x.stroke(); }
    x.restore();
    if (label) { x.font = `700 40px ${NUM}`; x.fillStyle = "#f3e6c4"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(label, FW / 2, FH / 2); x.textAlign = "left"; }
  }
  function drawFace(c, { tip } = {}) {
    const cv = document.createElement("canvas"); cv.width = FW; cv.height = FH;
    const x = cv.getContext("2d");
    if (c.faceDown) { drawBack(x, "Face down"); return cv; }
    const fr = K.frame(c), f = P.face(c);
    x.fillStyle = "#0b0d12"; x.fillRect(0, 0, FW, FH);
    rr(x, 10, 10, FW - 20, FH - 20, 18); x.fillStyle = fr; x.fill();
    if (c.token) {                                   // tokens: a striped frame
      x.save(); rr(x, 10, 10, FW - 20, FH - 20, 18); x.clip();
      x.strokeStyle = "rgba(255,255,255,.28)"; x.lineWidth = 9;
      for (let i = -FH; i < FW + FH; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i - FH, FH); x.stroke(); }
      x.restore();
    }
    // Name: the card's identity, as large as the card allows.
    x.font = `700 50px ${NUM}`;
    const nl = nameLines(x, shortName(c), FW - 60);
    const barH = nl.lines.length > 1 ? 96 : 66;
    rr(x, 20, 20, FW - 40, barH, 12); x.fillStyle = "rgba(10,13,18,.92)"; x.fill();
    if (c.commander) { x.lineWidth = 5; x.strokeStyle = "#f4c65e"; x.stroke(); }
    x.fillStyle = "#f6f3ea"; x.textBaseline = "middle"; x.font = `700 ${nl.s}px ${NUM}`;
    nl.lines.forEach((l, i) => x.fillText(l, 32, 20 + barH / 2 + (i - (nl.lines.length - 1) / 2) * nl.s * 0.98 + 2));
    // Art
    const footH = 104, artY = 20 + barH + 8, artH = FH - 20 - footH - 8 - artY;
    x.save(); rr(x, 20, artY, FW - 40, artH, 10); x.clip();
    const img = IMG[P.art(c)];
    if (img) drawCover(x, img, 20, artY, FW - 40, artH); else { x.fillStyle = "#222a35"; x.fillRect(20, artY, FW - 40, artH); }
    x.restore();
    let px = 28;
    const tags = [];
    if (c.copyOf) tags.push("Copy");
    if (c.transformed) tags.push("Transformed");
    if (c.goaded) tags.push("Goaded");
    if (c.becameLand) tags.push("Land now");
    tags.forEach(t => (px += pill(x, t, px, artY + 8, "rgba(10,13,18,.85)", "#fff") + 6));
    if (c.owner !== c.controller) pill(x, whose(c.owner), 28, artY + artH - 44, COLORS[c.owner], "#111");
    // Foot: what matters at a glance
    const fy = FH - 20 - footH, mid = fy + footH / 2;
    rr(x, 20, fy, FW - 40, footH, 12); x.fillStyle = "rgba(10,13,18,.9)"; x.fill();
    let lx = 62;
    const kws = K.keywords(c);
    kws.slice(0, 3).forEach(k => { kwIcon(x, k, lx, mid, 27); lx += 62; });
    if (kws.length > 3) { x.font = `700 32px ${NUM}`; x.fillStyle = "#fff"; x.fillText("+" + (kws.length - 3), lx - 26, mid + 2); lx += 30; }
    if (f.abilities && !f.manaAbility && !c.becameLand) { gem(x, lx, mid, actionable.has(c.id)); lx += 50; }
    const right = FW - 30;
    if (P.isCreature(c)) {
      const b = P.basePT(c), pw = c.power != null ? c.power : b.power, tg = c.toughness != null ? c.toughness : b.toughness;
      x.font = `700 62px ${NUM}`;
      const txt = `${pw}/${tg}`, w = Math.max(110, x.measureText(txt).width + 30);
      rr(x, right - w, fy + 14, w, footH - 28, 12); x.fillStyle = "#f1ece2"; x.fill();
      x.fillStyle = pw > b.power || tg > b.toughness ? "#11632b" : pw < b.power || tg < b.toughness ? "#9b1d1d" : "#16120c";
      x.textAlign = "center"; x.fillText(txt, right - w / 2, mid + 3); x.textAlign = "left";
    } else if (P.isPW(c)) {
      const loy = (c.counters && c.counters.LOYALTY) || f.loyalty;
      x.beginPath(); x.moveTo(right - 100, fy + 14); x.lineTo(right, fy + 14); x.lineTo(right, mid + 10); x.quadraticCurveTo(right - 50, fy + footH - 4, right - 100, mid + 10); x.closePath();
      x.fillStyle = "#1d1d22"; x.fill(); x.lineWidth = 4; x.strokeStyle = "#d9d9e6"; x.stroke();
      x.font = `700 54px ${NUM}`; x.fillStyle = "#fff"; x.textAlign = "center"; x.fillText(loy, right - 50, mid + 1); x.textAlign = "left";
    } else if (P.isLand(c)) {
      const prod = (DB[c.card] && DB[c.card].produces) || [];
      const pips = c.becameLand ? ["G"] : prod.slice(0, 5);
      let pxx = right - 22;
      pips.slice().reverse().forEach(m => { const [bg, fg] = PIP[m] || PIP.C; x.beginPath(); x.arc(pxx, mid, 22, 0, Math.PI * 2); x.fillStyle = bg; x.fill(); x.font = `700 30px ${NUM}`; x.fillStyle = fg; x.textAlign = "center"; x.fillText(m, pxx, mid + 2); x.textAlign = "left"; pxx -= 50; });
    } else {
      x.font = `600 36px ${NUM}`; x.fillStyle = "#c8d0db"; x.textAlign = "right"; x.fillText(shortType(c), right, mid + 2); x.textAlign = "left";
    }
    if (tip) { x.font = `700 28px ${NUM}`; pill(x, tip, 28, fy - 46, COLORS[c.controller], "#111"); }
    return cv;
  }

  // ---- three.js scene ---------------------------------------------------------------------------------------
  let renderer, scene, cam, raycaster, root, stageEl, overlay, running = false;
  const GEO = {}, MAT = {}, TEX = {};
  const picks = [];                               // meshes that answer taps
  const halos = [];

  function texFrom(canvas) {
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }
  function faceKey(c) { return [c.card, c.faceDown, c.token, c.power, c.toughness, (c.keywords || []).join(), c.copyOf, c.transformed, c.goaded, c.becameLand, c.landName, c.commander, actionable.has(c.id), c.owner !== c.controller && c.owner, JSON.stringify(c.counters || {})].join("|"); }
  function faceTex(c) { const k = faceKey(c); return TEX[k] || (TEX[k] = texFrom(drawFace(c))); }

  // A material for card faces: unlit so every seat reads the same, with a "dim" amount for tapped cards.
  function faceMat(tex, dim) {
    const m = new T.MeshBasicMaterial({ map: tex });
    m.userData.dim = { value: dim ? 1 : 0 };
    m.onBeforeCompile = sh => {
      sh.uniforms.dim = m.userData.dim;
      sh.fragmentShader = "uniform float dim;\n" + sh.fragmentShader.replace("#include <map_fragment>",
        "#include <map_fragment>\nfloat g_ = dot(diffuseColor.rgb, vec3(.299,.587,.114));\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(g_) * .5, dim * .85);");
    };
    return m;
  }

  function buildGeometry() {
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
    GEO.base = new T.BoxGeometry(CW * S + 0.12, 0.09, 0.34);
    GEO.chip = new T.CylinderGeometry(0.16, 0.16, 0.06, 28);
    GEO.chipTop = new T.CircleGeometry(0.16, 28);
    GEO.halo = new T.PlaneGeometry(CW * 1.34, CH * 1.26);
    MAT.hidden = new T.MeshBasicMaterial({ visible: false });
    MAT.edge = new T.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 0.8 });
    MAT.edgeDark = new T.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.7 });
    const back = document.createElement("canvas"); back.width = FW; back.height = FH; drawBack(back.getContext("2d"));
    MAT.back = new T.MeshBasicMaterial({ map: texFrom(back) });
    MAT.base = new T.MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.45, metalness: 0.2 });
    const glow = document.createElement("canvas"); glow.width = 160; glow.height = 200;
    const g = glow.getContext("2d"); g.shadowColor = "#fff"; g.shadowBlur = 22; g.strokeStyle = "#fff"; g.lineWidth = 10;
    rr(g, 26, 26, 108, 148, 12); g.stroke(); g.stroke();
    MAT.halo = new T.MeshBasicMaterial({ map: texFrom(glow), color: 0x7fe3ff, transparent: true, blending: T.AdditiveBlending, depthWrite: false });
  }

  // One card: a thin box with its face on +Z, centred on the origin, 1 tall.
  function cardMesh(c, { dim = false, back = false } = {}) {
    const grp = new T.Group();
    const edge = new T.Mesh(GEO.edge, [MAT.hidden, c && c.token ? MAT.edgeDark : MAT.edge]);
    edge.castShadow = true;
    const front = new T.Mesh(GEO.face, back || !c ? MAT.back : faceMat(faceTex(c), dim));
    front.position.z = TH / 2 + 0.0008;
    const rear = new T.Mesh(GEO.face, MAT.back);
    rear.position.z = -TH / 2 - 0.0008; rear.rotation.y = Math.PI;
    grp.add(edge, front, rear);
    grp.userData.front = front;
    return grp;
  }
  function pickable(obj, pick) { obj.userData.pick = pick; obj.traverse(o => { if (o.isMesh) picks.push(o); }); return obj; }
  function haloFor(parent, flat) {
    const h = new T.Mesh(GEO.halo, MAT.halo);
    if (flat) { h.rotation.x = -Math.PI / 2; h.position.y = 0.002; } else h.position.z = -TH;
    parent.add(h); halos.push(h);
  }
  function chipTex(text, bg, fg, sub) {
    const k = "chip|" + text + bg + sub;
    if (TEX[k]) return TEX[k];
    const cv = document.createElement("canvas"); cv.width = cv.height = 128;
    const x = cv.getContext("2d");
    x.beginPath(); x.arc(64, 64, 62, 0, Math.PI * 2); x.fillStyle = bg; x.fill();
    x.lineWidth = 6; x.strokeStyle = "rgba(255,255,255,.75)"; x.stroke();
    x.fillStyle = fg; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `700 ${sub ? 54 : 62}px ${NUM}`; x.fillText(text, 64, sub ? 54 : 68);
    if (sub) { x.font = `700 24px ${NUM}`; x.fillText(sub, 64, 96); }
    return (TEX[k] = texFrom(cv));
  }
  // A chip lying on the table (or on a base): counters and pile counts.
  function chip(text, bg, fg, sub) {
    const g = new T.Group();
    const body = new T.Mesh(GEO.chip, new T.MeshStandardMaterial({ color: bg, roughness: 0.5 }));
    body.castShadow = true;
    const top = new T.Mesh(GEO.chipTop, new T.MeshBasicMaterial({ map: chipTex(text, bg, fg, sub) }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.031;
    g.add(body, top);
    return g;
  }
  const CTR = { P1P1: ["#2f8f4e", "#fff"], CHARGE: ["#3a6fc4", "#fff", "charge"], LORE: ["#7a4fc0", "#fff", "lore"], STORY: ["#7a4fc0", "#fff", "story"], LUCK: ["#b48a2c", "#111", "luck"], INDESTRUCTIBLE: ["#ccc", "#111", "indestr."] };
  function counterChips(c) {
    return Object.entries(c.counters || {}).filter(([k]) => k !== "LOYALTY").map(([k, v]) => {
      const [bg, fg, sub] = CTR[k] || ["#566", "#fff", k.toLowerCase()];
      return chip(k === "P1P1" ? "+" + v : String(v), bg, fg, sub);
    });
  }

  // ---- Pieces on the table ----------------------------------------------------------------------------------------
  // A standee: the card upright in a base, leaning back. Tapped ones dim and lean further.
  function standee(c, copies = 1, ids = [c.id]) {
    const grp = new T.Group();
    const seatCol = new T.Color(COLORS[c.controller]);
    for (let i = Math.min(copies, 3) - 1; i >= 0; i--) {
      const one = new T.Group();
      const base = new T.Mesh(GEO.base, MAT.base); base.position.y = 0.045; base.castShadow = true; base.receiveShadow = true;
      const stripe = new T.Mesh(new T.BoxGeometry(CW * S + 0.12, 0.03, 0.01), new T.MeshBasicMaterial({ color: seatCol }));
      stripe.position.set(0, 0.06, 0.171);
      const pivot = new T.Group(); pivot.position.y = 0.07; pivot.rotation.x = -(c.tapped ? LEAN_TAPPED : LEAN);
      const card = cardMesh(c, { dim: c.tapped }); card.scale.setScalar(S); card.position.y = CH * S / 2;
      pivot.add(card);
      P.attachments(c.id).forEach((a, k) => {           // auras and equipment peek out from behind
        const am = cardMesh(a); am.scale.setScalar(S * 0.82);
        am.position.set(0.16 + k * 0.1, CH * S / 2 + 0.36 + k * 0.2, -0.03 - k * 0.02); am.rotation.z = -0.08;
        pickable(am, { type: "card", id: a.id });
        pivot.add(am);
      });
      if (i === 0 && actionable.has(c.id)) haloFor(card, false);
      one.add(base, stripe, pivot);
      one.position.set(i * 0.13, 0, -i * 0.26);
      grp.add(one);
      if (i === 0) {
        let cx = -CW * S / 2 + 0.08;
        counterChips(c).forEach(ch => { ch.position.set(cx, 0.12, 0.3); cx += 0.34; grp.add(ch); });
      }
    }
    if (copies > 1) { const ch = chip("×" + copies, "#e9e4d6", "#14161a"); ch.position.set(CW * S / 2 - 0.02, 0.12, 0.3); grp.add(ch); }
    return pickable(grp, copies > 1 ? { type: "pile", ids, title: shortName(c) } : { type: "card", id: c.id });
  }
  // A card lying face up. Tapped: dims and turns a little.
  function flat(c) {
    const grp = new T.Group();
    const card = cardMesh(c, { dim: c.tapped });
    card.rotation.x = -Math.PI / 2; card.position.y = TH / 2 + 0.002;
    grp.add(card);
    P.attachments(c.id).forEach((a, k) => {
      const am = cardMesh(a); am.rotation.x = -Math.PI / 2; am.scale.setScalar(0.86);
      am.position.set(0.12 + k * 0.08, 0.001, -0.3 - k * 0.2);
      pickable(am, { type: "card", id: a.id }); grp.add(am);
    });
    let cx = -CW / 2 + 0.12;
    counterChips(c).forEach(ch => { ch.position.set(cx, TH + 0.035, 0.32); cx += 0.34; grp.add(ch); });
    if (actionable.has(c.id)) haloFor(grp, true);
    if (c.tapped) grp.rotation.y = -0.16;
    return pickable(grp, { type: "card", id: c.id });
  }
  // Identical cards in a neat pile, with a count chip.
  function pile(ids, title) {
    const grp = new T.Group(), c = P.card(ids[0]), n = ids.length;
    for (let i = 0; i < Math.min(n, 10); i++) {
      const m = cardMesh(c, { dim: c.tapped }); m.rotation.x = -Math.PI / 2;
      m.rotation.z = (rnd() - 0.5) * 0.06; m.position.set((rnd() - 0.5) * 0.03, TH * (i + 0.5) + 0.002, (rnd() - 0.5) * 0.03);
      grp.add(m);
    }
    const top = TH * Math.min(n, 10);
    const ch = chip("×" + n, "#e9e4d6", "#14161a"); ch.position.set(-CW / 2 + 0.06, top + 0.035, 0.36); grp.add(ch);
    if (c.tapped) grp.rotation.y = -0.16;
    return pickable(grp, { type: "pile", ids, title: title || shortName(c) });
  }
  // Different cards overlapped so every name shows, like lands fanned on a real table.
  function cascade(ids, title) {
    const grp = new T.Group(), step = 0.205;
    ids.forEach((id, i) => {
      const c = P.card(id), m = cardMesh(c, { dim: c.tapped });
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, TH * (i + 0.5) + 0.002 + i * 0.002, i * step - (ids.length - 1) * step / 2);
      grp.add(m);
      if (actionable.has(id)) { const h = new T.Group(); h.position.copy(m.position); h.position.y -= 0.004; haloFor(h, true); grp.add(h); }
    });
    return pickable(grp, { type: "pile", ids, title });
  }
  // A zone pile: the library face down, the graveyard and exile face up, as tall as they are deep.
  function zonePile(pid, zone, ids, count) {
    const grp = new T.Group(), n = count != null ? count : ids.length;
    const h = Math.max(0.004, n * 0.0075);
    const box = new T.Mesh(new T.BoxGeometry(CW, h, CH), [MAT.edge, MAT.edge, MAT.hidden, MAT.edge, MAT.edge, MAT.edge]);
    box.position.y = h / 2; box.castShadow = true; box.receiveShadow = true;
    grp.add(box);
    if (n) {
      const topCard = zone === "library" ? cardMesh(null, { back: true }) : cardMesh(P.card(ids[ids.length - 1]));
      topCard.rotation.x = -Math.PI / 2; topCard.position.y = h + TH / 2;
      if (zone === "exile") topCard.rotation.z = 0.12;
      grp.add(topCard);
    }
    return pickable(grp, { type: "zone", pid, zone });
  }

  // ---- One seat's mat -----------------------------------------------------------------------------------------------
  // A mat is laid out in its own frame: x to the right, z toward the viewer, y up out of the mat. It is MW wide and
  // MD deep. Rows from far to near: two rows of standees, other permanents, then mana. Zones sit on the right edge.
  const MW = 12, MD = 7.8, CX = -0.55;   // mat size; rows centre a little left of the zones column
  const boards = {};
  function rowX(n, sp, centre = 0) { return k => centre + (k - (n - 1) / 2) * sp; }
  function layoutSeat(p) {
    const mat = new T.Group();
    root.add(mat);
    const b = boards[p.id] = { mat, zones: {}, mana: new T.Group(), seat: p.seat, p };
    const panel = b.panel = new T.Mesh(new T.PlaneGeometry(MW, MD), new T.MeshStandardMaterial({ map: matTex(COLORS[p.id]), transparent: true, roughness: 0.9 }));
    panel.rotation.x = -Math.PI / 2; panel.receiveShadow = true;
    mat.add(pickable(panel, { type: "mat", pid: p.id }));
    mat.add(b.mana);

    const A = K.arrange(p.id);
    const isPWItem = it => P.isPW(P.card(it.ids[0]));
    const chars = [...A.creatures.filter(it => P.card(it.ids[0]).commander), ...A.others.filter(isPWItem), ...A.creatures.filter(it => !P.card(it.ids[0]).commander)];
    const others = A.others.filter(it => !isPWItem(it));
    const place = (obj, x, z, into = mat) => { obj.position.x = x; obj.position.z = z; into.add(obj); };
    const ch = K.overflow(chars, 16, "More creatures");
    const front = ch.slice(0, 8), back = ch.slice(8);
    [[front, -0.85, 0], [back, -2.6, 0.5]].forEach(([row, z, stagger]) => {
      const X = rowX(row.length, 1.06, CX);
      row.forEach((it, k) => {
        const c = P.card(it.ids[0]);
        place(it.kind === "cascade" ? cascade(it.ids, it.title) : standee(c, it.ids.length, it.ids), X(k) + (row.length > 1 ? stagger : 0), z);
      });
    });
    const flatItem = it => it.kind === "cascade" ? cascade(it.ids, it.title) : it.kind === "stack" ? pile(it.ids) : flat(P.card(it.ids[0]));
    const orow = K.overflow(others, 10, "More permanents");
    const OX = rowX(orow.length, 0.88, CX);
    orow.forEach((it, k) => place(flatItem(it), OX(k), 0.8 + (it.kind === "cascade" ? 0.205 * (it.ids.length - 1) / 2 : 0)));
    const mana = [];
    A.mana.forEach(it => {
      if (it.kind !== "cascade") return mana.push(it);
      const parts = Math.ceil(it.ids.length / 4), per = Math.ceil(it.ids.length / parts);
      for (let i = 0; i < it.ids.length; i += per) mana.push({ kind: "cascade", ids: it.ids.slice(i, i + per), title: it.title });
    });
    const MX = rowX(mana.length, 0.92, CX);
    mana.forEach((it, k) => place(flatItem(it), MX(k), 2.3 + (it.kind === "cascade" ? 0.205 * (it.ids.length - 1) / 2 : 0), b.mana));
    // Zones down the right edge: library, graveyard, then exile and the command zone when they hold anything.
    const zx = MW / 2 - 0.6;
    const zone = (name, obj, z) => { b.zones[name] = obj; place(obj, zx, z, b.mana); };
    zone("library", zonePile(p.id, "library", [], p.library), -2.75);
    zone("graveyard", zonePile(p.id, "graveyard", p.graveyard), -1.4);
    if (p.exile.length) zone("exile", zonePile(p.id, "exile", p.exile), -0.05);
    if (p.command.length) {
      const g = new T.Group();
      const plinth = new T.Mesh(new T.BoxGeometry(CW + 0.16, 0.16, CH + 0.16), new T.MeshStandardMaterial({ color: 0x8a6d2c, roughness: 0.4, metalness: 0.5 }));
      plinth.position.y = 0.08; plinth.castShadow = true;
      const cm = flat(P.card(p.command[0])); cm.position.y = 0.16;
      g.add(plinth, cm); zone("command", g, 1.3);
    }
    b.banner = banner(p); mat.add(b.banner);
  }
  function matTex(col) {
    const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 512;
    const x = cv.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, "rgba(28,38,52,.92)"); g.addColorStop(1, "rgba(16,22,31,.96)");
    rr(x, 6, 6, 1012, 500, 40); x.fillStyle = g; x.fill();
    x.lineWidth = 5; x.strokeStyle = col; x.globalAlpha = 0.7; x.stroke();
    return texFrom(cv);
  }
  // The player's plate, standing at the mat's far-left corner: commander, name, life. A tap opens the rest.
  function bannerTex(p) {
    const cv = document.createElement("canvas"); cv.width = 720; cv.height = 180;
    const x = cv.getContext("2d"), col = COLORS[p.id];
    if (G.priority === p.id) { x.shadowColor = col; x.shadowBlur = 26; }
    rr(x, 14, 22, 692, 140, 70); x.fillStyle = "rgba(10,14,20,.94)"; x.fill();
    x.shadowBlur = 0; x.lineWidth = 7; x.strokeStyle = col; x.stroke();
    const img = IMG[P.art(P.card(p.commander[0]))];
    x.save(); x.beginPath(); x.arc(92, 92, 56, 0, Math.PI * 2); x.clip();
    if (img) drawCover(x, img, 36, 36, 112, 112); x.restore();
    x.font = `700 58px ${NUM}`; x.fillStyle = col; x.textBaseline = "middle";
    x.fillText(p.name + (p.monarch ? " ♛" : ""), 168, 94);
    x.font = `700 100px ${NUM}`; x.fillStyle = "#f3f1ea"; x.textAlign = "right"; x.fillText(p.life, 676, 98); x.textAlign = "left";
    if (G.active === p.id) { rr(x, 168, 0, 104, 40, 20); x.fillStyle = col; x.fill(); x.font = `700 28px ${NUM}`; x.fillStyle = "#111"; x.fillText("TURN", 186, 21); }
    return texFrom(cv);
  }
  function banner(p) {
    const m = new T.Mesh(new T.PlaneGeometry(3.4, 0.85), new T.MeshBasicMaterial({ map: bannerTex(p), transparent: true }));
    const pivot = new T.Group();
    pivot.position.set(-MW / 2 + 1.7, 0.02, -MD / 2 + 0.12);
    pivot.rotation.x = -LEAN;
    m.position.y = 0.5; pivot.add(m);
    return pickable(pivot, { type: "banner", pid: p.id });
  }

  // ---- Stage: the camera never moves. Seats move between four slots, like a turntable. -----------------------------
  // Slot 0 is the seat in front (large, everything shown). Slots 1–3 are the seats to its left, across and right,
  // smaller along the top, showing their creatures and permanents; their mana and zones fold away.
  let front = 0, turning = 0;
  const tweens = new Set();
  function tween(ms, fn) {
    return new Promise(res => {
      const t0 = performance.now();
      const tw = { step(now) { const k = Math.min(1, (now - t0) / ms); fn(ease(k), k); if (k >= 1) { tweens.delete(tw); res(); } } };
      tweens.add(tw);
    });
  }
  function slots() {
    const k = Math.min(1, cam.aspect / 1.44);
    return [
      { x: -0.75 * k, y: -1.25, z: -20, s: 1.13 * k, yaw: 0 },
      { x: -5.25 * k, y: 3.72, z: -20, s: 0.4 * k, yaw: 0.2 },
      { x: 0, y: 3.82, z: -20.5, s: 0.4 * k, yaw: 0 },
      { x: 5.25 * k, y: 3.72, z: -20, s: 0.4 * k, yaw: -0.2 },
    ];
  }
  function slotPose(sl) {
    const q = new T.Quaternion().setFromEuler(new T.Euler(0, sl.yaw, 0)).multiply(new T.Quaternion().setFromEuler(new T.Euler(PHI, 0, 0)));
    return { pos: new T.Vector3(sl.x, sl.y, sl.z), q, s: sl.s };
  }
  function poseMat(b, pose) {
    b.mat.position.copy(pose.pos); b.mat.quaternion.copy(pose.q); b.mat.scale.setScalar(pose.s);
    const small = pose.s < 0.7;
    b.mana.visible = !small;
    if (b.small !== small) {                                         // small seats cast no shadows onto the seat in front
      b.small = small;
      b.mat.traverse(o => { if (!o.isMesh) return; if (o.userData.cs == null) o.userData.cs = o.castShadow; o.castShadow = !small && o.userData.cs; });
    }
    b.panel.scale.y = small ? 0.62 : 1; b.panel.position.z = small ? -MD * 0.19 : 0;
    b.banner.scale.setScalar(Math.pow(0.95 / pose.s, 0.6));         // plates stay legible when their seat is small
  }
  function placeSeats() { const sl = slots(); Object.values(boards).forEach(b => poseMat(b, slotPose(sl[(b.seat - front + 4) % 4]))); }
  function turnTo(seat) {
    if (seat === front) return Promise.resolve();
    const sl = slots(), id = ++turning;
    const from = {}, to = {};
    Object.values(boards).forEach(b => { from[b.p.id] = slotPose(sl[(b.seat - front + 4) % 4]); to[b.p.id] = slotPose(sl[(b.seat - seat + 4) % 4]); });
    front = seat;
    return tween(720, k => {
      if (id !== turning) return;
      Object.values(boards).forEach(b => {
        const a = from[b.p.id], z = to[b.p.id];
        const pos = a.pos.clone().lerp(z.pos, k); pos.z -= Math.sin(k * Math.PI) * 5;     // swing back as it turns
        poseMat(b, { pos, q: a.q.clone().slerp(z.q, k), s: lerp(a.s, z.s, k) });
      });
    });
  }
  const turn = dir => turnTo(((front + dir) % 4 + 4) % 4);

  // ---- The stack, floating at the right: top spell first and largest ------------------------------------------------
  let stackG = null;
  function renderStack(n) {
    if (stackG) { scene.remove(stackG); stackG.traverse(o => { const i = picks.indexOf(o); if (i >= 0) picks.splice(i, 1); }); }
    stackG = new T.Group(); scene.add(stackG);
    const k = Math.min(1, cam.aspect / 1.44);
    const items = G.stack.slice(G.stack.length - n);
    let y = 2.05;
    items.forEach((s, i) => {
      const c = P.card(s.card), sc = i === 0 ? 1.55 : 1.12, m = cardMesh(c);
      y -= CH * sc / 2;
      m.scale.setScalar(sc); m.position.set(7.35 * k, y, -20); m.rotation.y = -0.18;
      const glow = new T.Mesh(GEO.halo, new T.MeshBasicMaterial({ map: MAT.halo.map, color: new T.Color(COLORS[s.controller]), transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
      glow.position.z = -TH; m.add(glow);
      const tag = new T.Mesh(new T.PlaneGeometry(0.62, 0.2), new T.MeshBasicMaterial({ map: tagTex(P.player(s.controller).name, COLORS[s.controller]), transparent: true }));
      tag.position.set(0, -CH / 2 - 0.02, 0.02); m.add(tag);
      stackG.add(pickable(m, { type: "card", id: s.card }));
      s._pos = m.position.clone(); s._scale = sc;
      y -= CH * sc / 2 + 0.38;
    });
  }
  function tagTex(text, col) {
    const k = "tag|" + text;
    if (TEX[k]) return TEX[k];
    const cv = document.createElement("canvas"); cv.width = 248; cv.height = 80;
    const x = cv.getContext("2d");
    rr(x, 4, 4, 240, 72, 36); x.fillStyle = col; x.fill();
    x.font = `700 50px ${NUM}`; x.fillStyle = "#111"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(text, 124, 42);
    return (TEX[k] = texFrom(cv));
  }

  // ---- Overlays: the hand, and one replay button ---------------------------------------------------------------------
  let handBox;
  function buildOverlay() {
    overlay = el("div", "g-overlay");
    stageEl.appendChild(overlay);
    handBox = el("div", "g-hand"); overlay.appendChild(handBox);
    K.hand(handBox);
    const replay = el("button", "g-replay", "▶"); replay.setAttribute("aria-label", "Replay the last spells"); replay.title = "Replay the last spells";
    replay.addEventListener("click", () => director());
    overlay.appendChild(replay);
  }
  function syncOverlay() { handBox.classList.toggle("away", front !== 0 || !!sifting); }

  // ---- Modals: one at a time; close with ✕, a tap outside or Escape ------------------------------------------------
  function closeModals() { document.querySelectorAll(".scrim, .g-modal").forEach(m => m.remove()); }
  function modal(scrim, box) {
    const x = el("button", "g-close", "✕"); x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => scrim.remove());
    box.appendChild(x);
    let downOnScrim = false;
    scrim.addEventListener("pointerdown", e => (downOnScrim = e.target === scrim));
    scrim.addEventListener("pointerup", e => { if (downOnScrim && e.target === scrim) scrim.remove(); downOnScrim = false; });
    return scrim;
  }
  function inspect(id) { closeModals(); P.inspect(id); }
  // Every inspector, wherever it was opened (a hand card, a related card), gets the same ✕ and closing.
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(nd => {
    if (nd.classList && nd.classList.contains("scrim") && !nd.querySelector(".g-close") && document.querySelector(".proto-g:not([hidden])")) {
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
  function zoneWorld(p, zone) { const b = boards[p.id], z = b.zones[zone]; return (z && z.visible && b.mana.visible ? z : b.banner).getWorldPosition(new T.Vector3()); }

  // ---- Sifting a pile: its cards rise and fan out in front of the camera ---------------------------------------------
  let sifting = null;
  function sift(ids, fromWorld, title) {
    if (sifting) unsift();
    const grp = new T.Group(); scene.add(grp);
    const fwd = new T.Vector3(); cam.getWorldDirection(fwd);
    const shade = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0, depthWrite: false }));
    shade.position.copy(cam.position).addScaledVector(fwd, 6.6); shade.quaternion.copy(cam.quaternion);
    grp.add(shade);
    const D = 6, vh = 2 * D * Math.tan(T.MathUtils.degToRad(cam.fov / 2)), vw = vh * cam.aspect;
    const n = ids.length, rows = n <= 6 ? 1 : n <= 14 ? 2 : 3, cols = Math.ceil(n / rows);
    const sc = Math.min(1.25, (vw * 0.86) / (cols * (CW + 0.08)), (vh * 0.7) / (rows * (CH + 0.1)));
    const right = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const centre = cam.position.clone().addScaledVector(fwd, D).addScaledVector(up, -vh * 0.04);
    const cards = ids.map((id, i) => {
      const c = P.card(id), m = cardMesh(c, { dim: c.tapped });
      const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, n - r * cols);
      const to = centre.clone().addScaledVector(right, (k - (inRow - 1) / 2) * (CW + 0.08) * sc).addScaledVector(up, ((rows - 1) / 2 - r) * (CH + 0.1) * sc);
      m.position.copy(fromWorld); m.quaternion.setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)); m.scale.setScalar(0.9);
      m.userData.pick = { type: "card", id, sift: true };
      grp.add(m);
      return { m, from: fromWorld.clone(), to, q0: m.quaternion.clone(), i };
    });
    sifting = { grp, cards, shade, title };
    const cap = el("div", "g-sifttitle", `<span>${P.esc(title)}</span>`);
    const x = el("button", "g-close", "✕"); x.setAttribute("aria-label", "Put back"); x.addEventListener("click", unsift); cap.appendChild(x);
    overlay.appendChild(cap); sifting.cap = cap;
    tween(520, k => {
      shade.material.opacity = 0.72 * k;
      cards.forEach(o => {
        const kk = Math.max(0, Math.min(1, k * 1.4 - o.i * 0.4 / n));
        o.m.position.lerpVectors(o.from, o.to, kk); o.m.position.addScaledVector(up, Math.sin(kk * Math.PI) * 0.6);
        o.m.quaternion.slerpQuaternions(o.q0, cam.quaternion, kk); o.m.scale.setScalar(lerp(0.9, sc, kk));
      });
    });
  }
  function unsift() {
    if (!sifting) return;
    const s = sifting; sifting = null; s.cap.remove();
    tween(380, k => {
      s.shade.material.opacity = 0.72 * (1 - k);
      s.cards.forEach(o => { o.m.position.lerpVectors(o.to, o.from, k); o.m.scale.setScalar(lerp(o.m.scale.x, 0.9, k)); });
    }).then(() => scene.remove(s.grp));
  }


  // ---- Touch: tap to look, hold to peek, swipe to turn the table. The camera itself never moves. ----------------------
  const ptrs = new Map();
  let gesture = null, peekEl = null, holdTimer = null;
  function pickAt(x, y) {
    raycaster.setFromCamera(new T.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
    const pool = sifting ? sifting.cards.flatMap(o => o.m.children) : picks;
    for (const hit of raycaster.intersectObjects(pool, false)) {
      let o = hit.object, vis = true, top = o;
      for (let q = o; q; q = q.parent) { if (!q.visible) vis = false; top = q; }
      if (!vis || top !== scene) continue;                           // hidden, or no longer on the stage
      while (o && !o.userData.pick) o = o.parent;
      if (o) return { pick: o.userData.pick, obj: o };
    }
    return null;
  }
  function onDown(e) {
    ptrs.set(e.pointerId, true);
    cancelDirector();
    if (ptrs.size > 1) { gesture = null; return; }
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
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    clearTimeout(holdTimer);
    const g = gesture; gesture = null;
    if (peekEl) { peekEl.remove(); peekEl = null; return; }
    if (!g || g.peek) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (g.moved) {                                         // a swipe turns the table one seat
      if (!sifting && Math.abs(dx) > 60 && Math.abs(dx) > 1.4 * Math.abs(dy)) turn(dx < 0 ? -1 : 1);
      return;
    }
    if (performance.now() - g.t > 500) return;
    const hit = pickAt(g.x, g.y);
    if (sifting) { if (hit && hit.pick.sift) inspect(hit.pick.id); else unsift(); return; }
    if (!hit) return;
    const pk = hit.pick;
    let b = null;                                          // anything on a seat that isn't in front brings that seat in front
    for (let q = hit.obj; q && !b; q = q.parent) b = Object.values(boards).find(x => x.mat === q) || null;
    if (b && b.seat !== front) return turnTo(b.seat);
    if (pk.type === "banner") return profile(P.player(pk.pid));
    if (pk.type === "card") return inspect(pk.id);
    if (pk.type === "pile") return sift(pk.ids, hit.obj.getWorldPosition(new T.Vector3()), pk.title);
    if (pk.type === "zone") {
      const p = P.player(pk.pid), ids = p[pk.zone];
      if (Array.isArray(ids) && ids.length) sift(ids, hit.obj.getWorldPosition(new T.Vector3()), `${whose(p.id)} ${pk.zone}`);
      else profile(p);
    }
  }
  function peek(c, at) {
    const p = el("div", "g-peek");
    if (c.faceDown) p.classList.add("back"); else p.style.backgroundImage = `url("${P.image(c)}")`;
    p.style.left = Math.max(10, Math.min(innerWidth - 270, at.x - 130)) + "px";
    p.style.top = Math.max(10, at.y - 400) + "px";
    document.body.appendChild(p);
    return p;
  }

  // ---- Director: replay the last spells. Each caster's plate pulses and the spell flies to the stack. ----------------
  let dirToken = 0;
  function cancelDirector() { if (dirToken) { dirToken++; K.caption(null); } }
  async function director() {
    const my = ++dirToken, alive = () => my === dirToken;
    await turnTo(0);
    renderStack(0);
    const order = G.stack.slice().reverse();                   // bottom of the stack first
    for (const st of K.steps) {
      if (!alive()) return;
      K.caption(st);
      if (!st.card) break;
      const b = boards[st.pid], bn = b.banner;
      const from = bn.getWorldPosition(new T.Vector3());
      const base = bn.scale.x;
      await tween(380, k => bn.scale.setScalar(base * (1 + 0.25 * Math.sin(k * Math.PI))));
      const n = order.findIndex(s => s.card === st.card) + 1;
      renderStack(n); const target = G.stack[G.stack.length - n];
      const landed = stackG.children[0]; landed.visible = false;
      const m = cardMesh(P.card(st.card)); scene.add(m);
      const q0 = b.mat.quaternion.clone().multiply(new T.Quaternion().setFromEuler(new T.Euler(-Math.PI / 2, 0, 0)));
      await tween(820, k => {
        m.position.lerpVectors(from, target._pos, k); m.position.y += Math.sin(k * Math.PI) * 1.2; m.position.z += Math.sin(k * Math.PI) * 3;
        m.quaternion.slerpQuaternions(q0, landed.quaternion, k); m.scale.setScalar(lerp(0.6, target._scale, k));
      });
      scene.remove(m); landed.visible = true;
      await new Promise(r => setTimeout(r, 1100));
    }
    if (alive()) { renderStack(G.stack.length); setTimeout(() => alive() && K.caption(null), 2600); }
  }

  // ---- Frame loop -------------------------------------------------------------------------------------------------------
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    tweens.forEach(t => t.step(now));
    MAT.halo.opacity = 0.55 + 0.45 * Math.sin(now / 420);
    renderer.render(scene, cam);
    syncOverlay();
  }
  function resize() {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
    placeSeats(); renderStack(G.stack.length);
  }
  function buildScene() {
    scene = new T.Scene();
    scene.background = new T.Color(0x0a0f15);
    const glowC = document.createElement("canvas"); glowC.width = glowC.height = 256;
    const gx = glowC.getContext("2d"), rg = gx.createRadialGradient(128, 150, 10, 128, 128, 128);
    rg.addColorStop(0, "#1b2a3a"); rg.addColorStop(1, "#0a0f15"); gx.fillStyle = rg; gx.fillRect(0, 0, 256, 256);
    const backdrop = new T.Mesh(new T.PlaneGeometry(90, 60), new T.MeshBasicMaterial({ map: texFrom(glowC) }));
    backdrop.position.z = -45; scene.add(backdrop);
    root = new T.Group(); scene.add(root);
    scene.add(new T.AmbientLight(0xffffff, 1.5));
    const sun = new T.DirectionalLight(0xfff4e2, 1.5);
    sun.position.set(-3, 12, 2); sun.target.position.set(0, 0, -20); scene.add(sun.target);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 40 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun);
    SEATS.forEach(layoutSeat);
  }

  // ---- Prototype hooks --------------------------------------------------------------------------------------------------
  let started = false;
  function mount(stage) {
    stageEl = stage;
    stage.appendChild(el("div", "g-loading", "Setting the table…"));
    import(THREE_URL).then(mod => { T = mod; return preload(); }).then(() => {
      renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
      renderer.domElement.className = "g-canvas";
      stage.querySelector(".g-loading").remove();
      stage.appendChild(renderer.domElement);
      cam = new T.PerspectiveCamera(32, innerWidth / innerHeight, 1, 120);
      raycaster = new T.Raycaster();
      buildGeometry(); buildScene(); buildOverlay();
      const cv = renderer.domElement;
      cv.addEventListener("pointerdown", onDown);
      cv.addEventListener("pointermove", onMove);
      cv.addEventListener("pointerup", onUp);
      cv.addEventListener("pointercancel", e => { ptrs.delete(e.pointerId); gesture = null; clearTimeout(holdTimer); if (peekEl) { peekEl.remove(); peekEl = null; } });
      addEventListener("keydown", e => { if (e.key === "Escape") { closeModals(); unsift(); } if (e.key === "ArrowLeft") turn(1); if (e.key === "ArrowRight") turn(-1); });
      window.__g = { T, scene, cam, turnTo, turn, sift, unsift, profile, inspect, director, pickAt, renderer, boards };
      resize();
      started = true;
      if (!stage.hidden) start();
    }).catch(err => { const l = stage.querySelector(".g-loading"); if (l) l.textContent = "Couldn't load three.js: " + err.message; });
  }
  function start() {
    if (running || !started) return;
    running = true; resize(); requestAnimationFrame(frame);
    if (!start.once) { start.once = true; if (!/nodirector/.test(location.search)) director(); }
  }
  P.register("g", {
    title: "Standees",
    mount,
    show() { start(); resize(); },
    hide() { running = false; cancelDirector(); closeModals(); },
  });
})();
