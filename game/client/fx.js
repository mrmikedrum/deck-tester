// Spell effects: the magic on the table. A cast spell crackles with its colours; a targeting line is a live arc of
// that energy; a card in danger has a sigil branded into the page at its foot; a card you can act on has embers
// stirring under it; a creature stands in the ash it was cast into. Particles are textured sprites moved by turbulence in
// the shader, drawn brighter than white so the bloom pass turns them into light. Everything rides the three.js object it
// belongs to. h.js calls FX.spell, FX.arc, FX.sigil, FX.ember, FX.ash and FX.tick.
(function () {
  const FX = window.SeatFX = {}, World = window.SeatWorld;
  let T = null, scene = null, pixelRatio = 1, now = 0, tmp = null;
  const live = new Set();                       // every effect, so tick can update and drop detached ones
  const SPR = {};                               // sprite textures

  // Mana as light. Black is violet with a dark heart; colourless is cold silver.
  const MANA = { W: "#ffe3a0", U: "#3fa6ff", B: "#9a4cff", R: "#ff5a1f", G: "#4fe26f", C: "#bcd2e8" };
  const DARK = { W: "#c98a2a", U: "#0b3fa8", B: "#2a0450", R: "#8a0e00", G: "#0a5a28", C: "#3a4a5a" };
  // A cubic Bézier through four points, for the arcs' curves.
  FX.bezier = (a, b, c, d) => k => { const u = 1 - k; return a.clone().multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * k).addScaledVector(c, 3 * u * k * k).addScaledVector(d, k * k * k); };
  FX.colors = cols => (cols && cols.length ? cols : ["C"]).map(k => (k[0] === "#" ? k : MANA[k] || MANA.C));   // a mana letter, or a colour as is
  FX.darks = cols => (cols && cols.length ? cols : ["C"]).map(k => DARK[k] || DARK.C);
  const HDR = 2.6;                              // signal brightness over white: what blooms

  FX.init = (three, sc, renderer) => {
    T = three; scene = sc; pixelRatio = renderer.getPixelRatio(); tmp = new T.Vector3();
    const tex = cv => { const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; return t; };
    SPR.ember = tex(World.emberSprite()); SPR.streak = tex(World.streakSprite());
    SPR.basin = tex(World.basinSprite()); SPR.glow = tex(World.wellGlowSprite()); SPR.ash = tex(World.ashSprite());
    SPR.brand = tex(glyphCanvas(false)); SPR.brandGlow = tex(glyphCanvas(true));
    const pool = document.createElement("canvas"); pool.width = pool.height = 128;
    const g = pool.getContext("2d"), rg = g.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(0.5, "rgba(255,255,255,.35)"); rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128); SPR.pool = tex(pool);
  };
  // The danger sigil, as a brand leaves it: a ring round a four-pointed star with rays between. `glow` false is the burn
  // itself, near-black lines with a narrow singed-brown edge and crisp, as cut by a hot iron; true is the heat left in the
  // same lines, white so its material tints it, thinner, inside the burn.
  function glyphCanvas(glow) {
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const g = cv.getContext("2d"), c = 128;
    const draw = (k, col) => {
      g.strokeStyle = g.fillStyle = col; g.lineCap = g.lineJoin = "round";
      g.lineWidth = 9 * k; g.beginPath(); g.arc(c, c, 106, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 3.5 * k; g.beginPath(); g.arc(c, c, 86, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 6 * k;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8; g.beginPath(); g.moveTo(c + Math.cos(a) * 90, c + Math.sin(a) * 90); g.lineTo(c + Math.cos(a) * 102, c + Math.sin(a) * 102); g.stroke(); }
      g.lineWidth = 7 * k; g.beginPath();
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 20 : 70; g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r); }
      g.closePath(); g.stroke();
    };
    if (glow) { g.shadowColor = "#fff"; g.shadowBlur = 4; draw(0.45, "#fff"); return cv; }
    g.shadowColor = "rgba(110,52,14,.9)"; g.shadowBlur = 7; draw(1.25, "rgba(96,46,14,.55)");   // the singed edge
    g.shadowBlur = 0; draw(1, "#170904");                                                        // the burnt line
    return cv;
  }
  const attached = o => { for (let q = o; q; q = q.parent) if (q === scene) return true; return false; };
  // Effects are seeded by the card they belong to: a rebuild makes the same particles, in the same places, mid-flight.
  let rand = Math.random;
  const seeded = seed => { let a = (seed * 2654435761 + 1013904223) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const withSeed = (seed, fn) => { if (seed == null) return fn(); const prev = rand; rand = seeded(seed); try { return fn(); } finally { rand = prev; } };
  FX.shared = () => Object.values(SPR);
  // Dim every effect a piece carries to k of its strength (1 is full): a seat in the background keeps its wells and embers
  // but quietly. The effects that set their own opacity each frame read `level` in their tick.
  FX.level = (obj, k) => obj.traverse(o => {
    if (!o.userData.fxRoot) return;
    o.traverse(q => {
      if (q.userData.fx) q.userData.level = k;
      const m = q.material; if (!m) return;
      if (m.userData.base == null) m.userData.base = m.isShaderMaterial ? m.uniforms.uHdr.value : m.opacity;
      if (m.isShaderMaterial) m.uniforms.uHdr.value = m.userData.base * k; else m.opacity = m.userData.base * k;
    });
  });

  // ---- A particle emitter: sprites born on a shape, carried by turbulence, living a short life, then born again ------
  const VERT = `
    uniform float uTime; uniform float uSize; uniform float uRise; uniform float uSpread; uniform float uSpeed; uniform float uTurb;
    attribute vec4 aSeed; attribute vec3 aColor; attribute vec3 aStart; attribute vec3 aDir;
    varying vec3 vColor; varying float vLife; varying float vAng;
    vec3 curl(vec3 p) {                          // cheap turbulence: three bent sine fields
      return vec3(sin(p.y * 7.1 + uTime * 2.3) + sin(p.z * 5.3 - uTime * 1.7), sin(p.z * 6.7 + uTime * 1.9) + sin(p.x * 4.9 + uTime * 2.9), sin(p.x * 5.9 - uTime * 2.1) + sin(p.y * 6.1 + uTime * 1.3));
    }
    void main() {
      float life = fract(uTime * uSpeed * (0.6 + aSeed.x * 0.8) + aSeed.y);
      vLife = life;
      vec3 p = aStart + aDir * life * uSpread * 2.0;
      p += curl(aStart * 3.0 + aSeed.xyz * 9.0) * uTurb * life;
      p.y += life * uRise;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.5, 1.0, life));
      gl_PointSize = uSize * (0.4 + aSeed.z * 0.9) * fade * (22.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vColor = aColor; vAng = aSeed.w * 6.2831 + uTime * (aSeed.x - 0.5) * 4.0;
    }`;
  const FRAG = `
    uniform sampler2D uSprite; uniform float uHdr;
    varying vec3 vColor; varying float vLife; varying float vAng;
    void main() {
      vec2 d = gl_PointCoord - 0.5; float c = cos(vAng), s = sin(vAng);
      vec2 uv = vec2(c * d.x - s * d.y, s * d.x + c * d.y) + 0.5;
      vec4 t = texture2D(uSprite, uv);
      float a = t.a * (1.0 - vLife * 0.5);
      vec3 col = mix(vColor, vec3(1.0), t.r * 0.6) * uHdr;
      gl_FragColor = vec4(col * a, a);
    }`;
  function emitter({ n, colors, start, dir, size = 10, rise = 0.5, spread = 0.12, speed = 0.9, turb = 0.08, sprite = "ember", hdr = HDR, blending = "add" }) {
    const g = new T.BufferGeometry();
    const seed = new Float32Array(n * 4), col = new Float32Array(n * 3), st = new Float32Array(n * 3), dr = new Float32Array(n * 3);
    const cs = colors.map(c => new T.Color(c));
    for (let i = 0; i < n; i++) {
      seed.set([rand(), rand(), rand(), rand()], i * 4);
      const c = cs[Math.floor(rand() * cs.length)]; col.set([c.r, c.g, c.b], i * 3);
      const s = start(i), d = dir(i, s); st.set([s.x, s.y, s.z], i * 3); dr.set([d.x, d.y, d.z], i * 3);
    }
    g.setAttribute("position", new T.BufferAttribute(st.slice(), 3));
    g.setAttribute("aSeed", new T.BufferAttribute(seed, 4)); g.setAttribute("aColor", new T.BufferAttribute(col, 3));
    g.setAttribute("aStart", new T.BufferAttribute(st, 3)); g.setAttribute("aDir", new T.BufferAttribute(dr, 3));
    const m = new T.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uSize: { value: size * pixelRatio }, uRise: { value: rise }, uSpread: { value: spread }, uSpeed: { value: speed }, uTurb: { value: turb }, uSprite: { value: SPR[sprite] }, uHdr: { value: hdr } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: blending === "add" ? T.AdditiveBlending : T.NormalBlending,
    });
    const p = new T.Points(g, m); p.frustumCulled = false; p.renderOrder = 20;
    p.userData.fx = { tick(t) { m.uniforms.uTime.value = t; } };
    live.add(p);
    return p;
  }

  // A cast spell: its mana crackles off the card's rim and lifts off its face. Attached to the card mesh (1 tall,
  // `cw` wide, facing +z).
  FX.spell = (mesh, colors, cw = 0.716, strength = 1, seed = null) => withSeed(seed, () => {
    const cols = FX.colors(colors);
    // Born on the rim, a hair behind the face, and lifted only a little off it, mostly backward: the energy clings to the
    // edge and the face, name and art stay clear.
    const rim = () => { const side = rand(), t = rand() * 2 - 1; return side < 0.3 ? new T.Vector3(t * cw / 2, 0.5, -0.03) : side < 0.5 ? new T.Vector3(t * cw / 2, -0.5, -0.03) : side < 0.75 ? new T.Vector3(-cw / 2, t / 2, -0.03) : new T.Vector3(cw / 2, t / 2, -0.03); };
    const out = (i, s) => new T.Vector3(Math.abs(s.x) > cw / 2 - 0.01 ? Math.sign(s.x) * (0.5 + rand() * 0.5) : (rand() - 0.5) * 0.3, Math.abs(s.y) > 0.49 ? Math.sign(s.y) * (0.5 + rand() * 0.5) : (rand() - 0.5) * 0.3, -0.6 - rand() * 0.4).normalize();
    // Crackle: short, quick streaks running along the rim.
    const crackle = emitter({ n: Math.round(80 * strength), colors: cols, size: 8, rise: 0.04, spread: 0.06, speed: 1.4, turb: 0.035, sprite: "streak", hdr: HDR * 0.8, start: rim, dir: out });
    // Embers: a few slow motes lifting off the top edge, behind the card.
    const motes = emitter({ n: Math.round(24 * strength), colors: cols, size: 4, rise: 0.3, spread: 0.04, speed: 0.35, turb: 0.05, sprite: "ember", hdr: HDR * 0.7, start: rim, dir: out });
    // Smoke: the dark heart, the same colours gone to shadow, well behind the card.
    const smoke = emitter({ n: 36, colors: FX.darks(colors), size: 26, rise: 0.25, spread: 0.05, speed: 0.22, turb: 0.08, sprite: "ember", hdr: 0.8, blending: "normal",
      start: () => { const s = rim(); s.multiplyScalar(0.92); s.z = -0.22; return s; }, dir: out });
    smoke.renderOrder = 19;
    mesh.add(smoke, motes, crackle);
    return crackle;
  });

  // Embers under a card you can act on: coals and a few sparks, the warm ember of the signal palette, never a mana colour.
  FX.ember = (parent, { y = 0.012, w = 0.9, d = 0.5, seed = null } = {}) => withSeed(seed, () => {
    const p = emitter({ n: 70, colors: ["#ffb347", "#ff7a1a", "#ffd58a"], size: 5, rise: 0.5, spread: 0.04, speed: 0.45, turb: 0.06,
      start: () => new T.Vector3((rand() - 0.5) * w, y, (rand() - 0.5) * d + 0.1), dir: () => new T.Vector3(0, 1, 0) });
    p.userData.fxRoot = true; parent.add(p);
    return p;
   });

  // Ash: the vellum singed round where a creature was cast, `r` across, the card standing in the middle of it. The same
  // burn turned and mirrored each card's own way, so a row never shows one stamp repeated. Drawn as page, never as light.
  FX.ash = (parent, { r = 1.0, y = 0.005, seed = null } = {}) => withSeed(seed, () => {
    const m = new T.Mesh(new T.PlaneGeometry(r, r * 0.6), new T.MeshBasicMaterial({ map: SPR.ash, transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = (rand() - 0.5) * 0.4; m.position.set(0, y, 0.04); m.renderOrder = 0;
    m.scale.set(rand() < 0.5 ? -1 : 1, rand() < 0.5 ? -1 : 1, 1);
    m.userData.fxRoot = true; parent.add(m);
    return m;
  });

  // The sigil: a card something is aimed at has a mark branded into the page at its foot, in front of it where the leaning
  // card leaves it in view: crisp burnt lines lying flat on the vellum, a card's width across, with the heat still in them,
  // a dull oxblood that deepens with a heartbeat. No char, no blot: a brand, not a stain. Nothing of it blooms.
  FX.sigil = (parent, { r = 1.0, y = 0.008, seed = null } = {}) => withSeed(seed, () => {
    const g = new T.Group(), w = r * 0.62;
    const flat = (map, mat, dy) => { const m = new T.Mesh(new T.PlaneGeometry(w, w), new T.MeshBasicMaterial(Object.assign({ map, transparent: true, depthWrite: false, toneMapped: false }, mat))); m.rotation.x = -Math.PI / 2; m.position.y = dy; m.renderOrder = 1; return m; };
    const burn = flat(SPR.brand, {}, 0), heat = flat(SPR.brandGlow, { color: new T.Color("#8e1a10") }, 0.001);
    g.add(burn, heat); g.position.set(0, y, 0.42 * r); g.rotation.y = (rand() - 0.5) * 0.3;
    g.userData.fx = { tick(t) { const beat = Math.pow(Math.max(0, Math.sin(t * 2.4)), 6), lv = g.userData.level != null ? g.userData.level : 1; burn.material.opacity = lv; heat.material.opacity = (0.55 + 0.45 * beat) * lv; } };
    g.userData.fxRoot = true; live.add(g); parent.add(g);
    return g;
  });

  // A land is a well: the page under it is a pool of its mana. Light in the mana's colour, laid on the vellum like a wash
  // (not added as light: on tan, added light only goes pale), so the pool is brighter than the page and still never
  // reaches the bloom. It fills the card's footprint and spreads soft past its edge, to about 1.25× the card, with a
  // warmer lit heart near the edge. It breathes slowly; now and then a mote drifts up. Added to the card's lying-down
  // frame, where +z is up off the page. Tapped, the well is drawn down: the light goes, and a dull stain of its colour
  // gone to brown is left.
  FX.well = (parent, colors, { w = 0.72, h = 1, tapped = false, seed = null } = {}) => withSeed(seed, () => {
    const cols = FX.colors(colors), col = new T.Color(cols[0]), col2 = new T.Color(cols[cols.length - 1]);
    const g = new T.Group();
    const plane = (map, sx, sy, mat, z) => { const m = new T.Mesh(new T.PlaneGeometry(w * sx, h * sy), new T.MeshBasicMaterial(Object.assign({ map, transparent: true, depthWrite: false, toneMapped: false }, mat))); m.position.z = z; m.renderOrder = 0; return m; };
    // Just over the page (z > 0): under it, the table hides them.
    if (tapped) {
      const stain = plane(SPR.glow, 1.55, 1.45, { color: col.clone().lerp(new T.Color("#3a2a1c"), 0.55).multiplyScalar(0.75), opacity: 0.6 }, 0.0015);
      stain.rotation.z = (rand() - 0.5) * 0.06;
      g.add(stain);
    } else {
      // The wash: the mana's own colour, barely lifted, so a blue well is a clear blue and a colourless one silver.
      const pool = plane(SPR.glow, 1.6, 1.5, { color: col.clone().lerp(new T.Color(1, 1, 1), 0.1), opacity: 0.72 }, 0.0015);
      // The heart: a little of the second colour as light, inside the wash, so the pool looks lit rather than painted.
      const pool2 = plane(SPR.glow, 1.4, 1.32, { color: col2.clone().multiplyScalar(0.4), opacity: 0.8, blending: T.AdditiveBlending }, 0.0025);
      pool.rotation.z = (rand() - 0.5) * 0.06; pool2.rotation.z = (rand() - 0.5) * 0.08;
      g.add(pool, pool2);
      const motes = emitter({ n: 3, colors: cols, size: 3, rise: 0, spread: 0.12, speed: 0.12, turb: 0.03, sprite: "ember", hdr: HDR * 0.3,
        start: () => new T.Vector3((rand() - 0.5) * w * 0.8, (rand() - 0.5) * h * 0.8, 0.02), dir: () => new T.Vector3((rand() - 0.5) * 0.15, (rand() - 0.5) * 0.15, 1).normalize() });
      g.add(motes);
      const phase = rand() * 6.28;
      g.userData.fx = { tick(t) { const lv = g.userData.level != null ? g.userData.level : 1, b = 1 + 0.08 * Math.sin(t * 0.9 + phase); pool.material.opacity = 0.72 * b * lv; pool2.material.opacity = 0.8 * b * lv; } };
    }
    g.userData.fxRoot = true; if (g.userData.fx) live.add(g); parent.add(g);
    return g;
  });

  // Gold under a card you have chosen: a steady pool of gilt on its ground, in front of its foot, no sparks. Embers mean
  // "you could"; this means "you did". It stays below the bloom, so its light never washes over the card's face.
  FX.chosen = (parent, { w = 1.0, d = 0.42, y = 0.01 } = {}) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshBasicMaterial({ map: SPR.pool, color: new T.Color("#f1c86a").multiplyScalar(0.75), transparent: true, opacity: 0.7, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(0, y, 0.2); m.renderOrder = 0;
    m.userData.fxRoot = true; parent.add(m);
    return m;
  };

  // A burst: a spell igniting as it leaves the hand, or collapsing as it resolves. Short-lived; removes itself.
  FX.burst = (parent, colors, { ms = 600, n = 140, size = 14, spread = 0.9 } = {}) => {
    const p = emitter({ n, colors: FX.colors(colors), size, rise: 0.2, spread, speed: 1 / (ms / 1000) / 1.0, turb: 0.2, sprite: "streak",
      start: () => new T.Vector3((rand() - 0.5) * 0.3, (rand() - 0.5) * 0.4, 0), dir: () => new T.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize() });
    const t0 = now;
    p.userData.fx = { tick(t) { p.material.uniforms.uTime.value = (t - t0); p.material.uniforms.uHdr.value = HDR * Math.max(0, 1 - (t - t0) / (ms / 1000)); if (t - t0 > ms / 1000) { live.delete(p); if (p.parent) p.parent.remove(p); } } };
    parent.add(p);
    return p;
  };

  // ---- A crackling arc from a spell to its target: a jittered polyline rebuilt as it goes, bright core over glow ----
  // The ribbon faces the camera (`face`), so a stretch that drops steeply keeps its width; `aU` runs along it in world
  // units, for the dashes of an attack.
  const FACE = { x: 0, y: 0.756, z: 0.655 };
  function ribbonGeo(pts, w, face) {
    const n = pts.length, pos = new Float32Array(n * 6), us = new Float32Array(n * 2), vs = new Float32Array(n * 2), idx = [];
    let len = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], r = pts[Math.max(0, i - 1)];
      if (i) len += p.distanceTo(pts[i - 1]);
      const d = tmp.copy(q).sub(r).normalize(), side = new T.Vector3().crossVectors(d, face).normalize().multiplyScalar(w * (0.3 + 0.7 * Math.sin((i / (n - 1)) * Math.PI)));
      pos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
      us.set([len, len], i * 2); vs.set([1, -1], i * 2);
      if (i < n - 1) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setAttribute("aU", new T.BufferAttribute(us, 1)); g.setAttribute("aV", new T.BufferAttribute(vs, 1)); g.setIndex(idx);
    return g;
  }
  // An attack's core: a sparse train of hot white-gold pulses of uneven length with long, uneven gaps, travelling toward
  // the defender. Each pulse is hot at its head and tails off behind, soft across its width: a bolt in flight, not a
  // painted dash. Additive, brighter than white only a little.
  const DASH_V = `attribute float aU; attribute float aV; varying float vU; varying float vV; void main() { vU = aU; vV = aV; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const DASH_F = `
    uniform vec3 uColor; uniform float uOpacity; uniform float uPhase; varying float vU; varying float vV;
    void main() {
      float x = vU / 0.9 - uPhase, seg = floor(x), k = fract(x);
      float h = fract(sin(seg * 12.9898) * 43758.5453), on = 0.2 + 0.25 * h;
      float a = smoothstep(0.0, on, k) * (1.0 - smoothstep(on, on + 0.05, k)) * step(0.45, h);   // tail ... head; about half the slots stay dark
      a *= 1.0 - vV * vV;
      gl_FragColor = vec4(uColor * (0.6 + 0.6 * a), a * uOpacity);
    }`;
  //   A spell's arc follows `curve` (k → point) when it is given: up beside its target and down behind it, so the card
  //   hides where it lands; it is a thin line of light whose bloom stays close. An attack (`ink`) is drawn in its seat's
  //   ink, laid on the page like a stroke of the pen rather than shone onto it (pale light on tan paper washes out): a
  //   saturated band of the seat's colour over a dark edge, and in it a sparse train of white-gold pulses (`dash`), with a
  //   flare where it leaves the attacker (`source`) and one where it lands (`flare`). `delay` (s) holds it dark until a
  //   spell flying in has arrived.
  FX.arc = (from, to, colors, { width = 0.06, sag = 0.9, curve = null, jitter = 0.22, ink = false, dash = false, flare = false, source = false, drips = 70, delay = 0 } = {}) => {
    const cols = FX.colors(colors), col = new T.Color(cols[0]), col2 = new T.Color(cols[1 % cols.length]);
    const grp = new T.Group(), N = curve ? 48 : 36, face = new T.Vector3(FACE.x, FACE.y, FACE.z), born = now;
    const mat = (c, o, normal) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: normal ? T.NormalBlending : T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    // A spell's core is its own colour lifted toward white, not white: it reads as whose fire it is and never washes a card
    // out. An attack's pulses are white-gold, hot, over the seat's ink.
    const coreCol = ink ? new T.Color("#fff0c0").multiplyScalar(2.2) : col.clone().lerp(new T.Color(1, 1, 1), 0.35).multiplyScalar(HDR * 0.45);
    const core = new T.Mesh(new T.BufferGeometry(), dash
      ? new T.ShaderMaterial({ uniforms: { uColor: { value: coreCol }, uOpacity: { value: 1 }, uPhase: { value: 0 } }, vertexShader: DASH_V, fragmentShader: DASH_F, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })
      : mat(coreCol, 0.95));
    const glow = new T.Mesh(new T.BufferGeometry(), ink ? mat(col, 0.8, true) : mat(col.clone().multiplyScalar(HDR * 0.42), 0.7));
    const glow2 = new T.Mesh(new T.BufferGeometry(), ink ? mat(col, 0.22, true) : mat(col2.clone().multiplyScalar(0.6), 0.25));
    core.renderOrder = glow.renderOrder = glow2.renderOrder = 21;
    const edge = ink ? new T.Mesh(new T.BufferGeometry(), new T.MeshBasicMaterial({ color: 0x140a04, transparent: true, opacity: 0.45, depthWrite: false, side: T.DoubleSide, toneMapped: false })) : null;
    if (edge) { edge.renderOrder = 20; grp.add(edge); }
    const dr = emitter({ n: drips, colors: cols, size: 7, rise: -1.1, spread: 0.06, speed: 0.75, turb: 0.05, sprite: "streak", start: () => new T.Vector3(), dir: () => new T.Vector3(0, -1, 0) });
    const dripStart = dr.geometry.attributes.aStart;
    grp.add(glow2, glow, core, dr);
    // Where it leaves and where it lands: a small hot pool of its light on the ground and a few sparks thrown up.
    const flares = [];
    const flareAt = (at, big) => {
      const pool = new T.Mesh(new T.PlaneGeometry(width * big, width * big * 0.7), new T.MeshBasicMaterial({ map: SPR.pool, color: col.clone().lerp(new T.Color(1, 0.85, 0.6), 0.25).multiplyScalar(1.8), transparent: true, opacity: 0.8, blending: T.AdditiveBlending, depthWrite: false, toneMapped: false }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(at.x, at.y + 0.03, at.z); pool.renderOrder = 21;
      const sparks = emitter({ n: big > 8 ? 22 : 12, colors: [cols[0], "#fff4d8"], size: 4.5, rise: 0.6, spread: 0.1, speed: 1.1, turb: 0.05, sprite: "streak", hdr: HDR * 0.85,
        start: () => new T.Vector3(at.x + (rand() - 0.5) * width * 1.5, at.y + 0.06, at.z + (rand() - 0.5) * width * 1.5), dir: () => new T.Vector3(rand() - 0.5, 1.6, rand() - 0.5).normalize() });
      grp.add(pool, sparks); flares.push({ pool, sparks });
    };
    if (flare) flareAt(to, ink ? 11 : 5);            // an attack's lane is thin: its landing on the page edge still reads
    if (source) flareAt(from, ink ? 7 : 4);
    let last = -1, pts = [];
    const build = () => {
      pts = [];
      for (let i = 0; i <= N; i++) { const k = i / N; if (curve) pts.push(curve(k)); else { const p = from.clone().lerp(to, k); p.y += Math.sin(k * Math.PI) * sag; pts.push(p); } }
      const disp = (a, b, amt) => { if (b - a < 2) return; const m = (a + b) >> 1; pts[m].add(new T.Vector3(rand() - 0.5, (rand() - 0.5) * 0.6, rand() - 0.5).multiplyScalar(amt)); disp(a, m, amt * 0.55); disp(m, b, amt * 0.55); };
      disp(0, N, jitter);
      for (let i = 1; i < N; i++) pts[i].y = Math.max(0.05, pts[i].y);
      core.geometry.dispose(); glow.geometry.dispose(); glow2.geometry.dispose();
      core.geometry = ribbonGeo(pts, width * (dash ? 0.75 : 0.3), face); glow.geometry = ribbonGeo(pts, width, face); glow2.geometry = ribbonGeo(pts, width * (ink ? 1.8 : 1.6), face);
      if (edge) { edge.geometry.dispose(); edge.geometry = ribbonGeo(pts.map(p => new T.Vector3(p.x, p.y - 0.01, p.z)), width * 1.3, face); }
      for (let i = 0; i < dripStart.count; i++) { const p = pts[Math.floor(rand() * N)]; dripStart.setXYZ(i, p.x, p.y, p.z); }
      dripStart.needsUpdate = true;
    };
    build();
    const hdr = dr.material.uniforms.uHdr.value;
    grp.userData.fx = { tick(t) {
      const on = delay ? Math.max(0, Math.min(1, (t - born - delay) / 0.25)) : 1;
      if (t - last > 0.06) { last = t; build(); }
      if (dash) { core.material.uniforms.uPhase.value = t * 2.2; core.material.uniforms.uOpacity.value = (0.85 + 0.15 * rand()) * on; }
      else core.material.opacity = (0.7 + 0.3 * rand()) * on;
      glow.material.opacity = (ink ? 0.8 + 0.08 * Math.sin(t * 9) : 0.55 + 0.2 * Math.sin(t * 9)) * on; glow2.material.opacity = (ink ? 0.22 : 0.25) * on;
      dr.material.uniforms.uHdr.value = hdr * on;
      if (edge) edge.material.opacity = 0.45 * on;
      flares.forEach(({ pool, sparks }, i) => { pool.material.opacity = (0.65 + 0.3 * Math.sin(t * 7 + i * 2)) * on; sparks.material.uniforms.uHdr.value = HDR * 0.85 * on; });
    } };
    grp.userData.fx.tick(now);
    live.add(grp);
    return grp;
  };

  FX.tick = ms => { now = ms / 1000; live.forEach(o => { if (!attached(o)) { live.delete(o); return; } o.userData.fx.tick(now); }); };
  FX.clear = () => { live.forEach(o => { if (o.parent) o.parent.remove(o); }); live.clear(); };
})();
