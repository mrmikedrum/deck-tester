// The Grimoire's materials, made from noise: vellum with fibres, stains and foxing; bronze with patina; the sprites
// the particles are drawn with; and a parchment the HTML overlays share. Everything is generated once, at boot.
(function () {
  const W = window.SeatWorld = {};

  // ---- Value noise and fbm, fast enough for a few 1024² fields at boot ------------------------------------------------
  const PERM = new Uint8Array(512); { let s = 1337; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y) => { switch (h & 3) { case 0: return x + y; case 1: return -x + y; case 2: return x - y; default: return -x - y; } };
  function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y), A = PERM[X] + Y, B = PERM[X + 1] + Y;
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(grad(PERM[A], x, y), grad(PERM[B], x - 1, y), u), l(grad(PERM[A + 1], x, y - 1), grad(PERM[B + 1], x - 1, y - 1), u), v);
  }
  W.fbm = (x, y, oct = 5, lac = 2.1, gain = 0.5) => { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); f *= lac; a *= gain; } return s; };
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

  // A canvas painted per pixel from a function (x, y, u, v) → [r, g, b, a?], plus a height field for the normal map.
  function paint(size, fn, heightOut) {
    const cv = document.createElement("canvas"); cv.width = cv.height = size;
    const x = cv.getContext("2d"), img = x.createImageData(size, size), d = img.data;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4, c = fn(i, j, i / size, j / size);
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3] == null ? 255 : c[3];
      if (heightOut) heightOut[j * size + i] = c[4] || 0;
    }
    x.putImageData(img, 0, 0);
    return cv;
  }
  W.normalFrom = (h, size, strength = 2) => paint(size, (i, j) => {
    const at = (a, b) => h[((b + size) % size) * size + ((a + size) % size)];
    const dx = (at(i + 1, j) - at(i - 1, j)) * strength, dy = (at(i, j + 1) - at(i, j - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });

  // ---- Vellum: skin, not paper. Fibres, a mottle, stains that pool at the edges, foxing, a darker rim. ---------------
  //   tone: the base colour; wear: 0..1 how aged. Returns { map, normal } canvases.
  W.vellum = (size = 1024, { tone = "#d8c59c", wear = 0.6, repeat = 1 } = {}) => {
    const base = hex(tone), h = new Float32Array(size * size);
    let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const stains = Array.from({ length: 9 }, () => [r(), r(), 0.05 + r() * 0.22, 0.25 + r() * 0.5]);
    const map = paint(size, (i, j, u, v) => {
      const uu = u * repeat, vv = v * repeat;
      const mottle = W.fbm(uu * 6, vv * 6, 5);                    // large soft variation
      const grain = W.fbm(uu * 90, vv * 90, 3, 2.3, 0.55);         // the skin's grain
      const fibre = Math.abs(W.fbm(uu * 14 + 11, vv * 2 + 3, 2)) < 0.012 ? 0.14 : 0;   // long faint fibres
      let stain = 0;
      for (const [sx, sy, sr, sa] of stains) { const d = Math.hypot(u - sx, v - sy) / sr; if (d < 1) stain += sa * 0.5 * (0.3 + 0.7 * Math.pow(d, 4)) * clamp((1 - d) * 6); }
      const fox = W.fbm(uu * 30 + 50, vv * 30 + 50, 2) > 0.3 ? 0.22 : 0;
      const light = 1 + mottle * 0.18 + grain * 0.1 - fibre * 0.4 - stain * wear * 0.45 - fox * wear;
      const warm = stain * wear * 0.3 + fox * 0.2;
      const rgb = base.map((c, k) => clamp(c * light * (k === 2 ? 1 - warm : k === 0 ? 1 + warm * 0.2 : 1), 0, 255));
      return [rgb[0], rgb[1], rgb[2], 255, grain * 0.5 + mottle * 0.3 + fibre - stain * 0.2];
    }, h);
    return { map, normal: W.normalFrom(h, size, 1.6) };
  };

  // ---- Bronze: brushed, with verdigris creeping in from the edges and pits. ------------------------------------------
  W.bronze = (size = 512, { patina = 0.5 } = {}) => {
    const h = new Float32Array(size * size);
    const map = paint(size, (i, j, u, v) => {
      const brush = W.fbm(u * 4, v * 160, 3, 2, 0.6) * 0.5;
      const pit = W.fbm(u * 50, v * 50, 3) > 0.3 ? -0.5 : 0;
      const green = clamp((W.fbm(u * 7 + 3, v * 7 + 9, 4) + 0.1) * patina * 2.2);
      const b = [150 + brush * 40 + pit * 50, 110 + brush * 30 + pit * 40, 60 + brush * 20 + pit * 20];
      const g = [70, 120, 100];
      return [mix(b[0], g[0], green), mix(b[1], g[1], green), mix(b[2], g[2], green), 255, brush + pit * 0.5 - green * 0.3];
    }, h);
    const rough = paint(size, (i, j, u, v) => { const g = clamp((W.fbm(u * 7 + 3, v * 7 + 9, 4) + 0.1) * patina * 2.2); const r = (0.35 + g * 0.55) * 255; return [r, r, r]; });
    return { map, normal: W.normalFrom(h, size, 2.5), roughness: rough };
  };

  // ---- Card frames: one tile per colour, matte and quiet, so the name and numbers carry. -----------------------------
  //   W marble, U rippled slate, B cracked dark leather, R rough red stone, G mottled leaf, C brushed pewter,
  //   M (gold) brushed brass, L (land) packed earth, T (token) rough paper.
  const FRAMES = {
    W: (u, v) => { const vein = Math.abs(W.fbm(u * 5 + 2, v * 5, 4)) < 0.03 ? -0.18 : 0; const m = W.fbm(u * 3, v * 3, 3) * 0.08; return [226 + m * 60 + vein * 90, 218 + m * 60 + vein * 90, 196 + m * 50 + vein * 80]; },
    U: (u, v) => { const r = Math.sin((v * 14 + W.fbm(u * 4, v * 4, 3) * 2.2) * Math.PI) * 0.5; const m = W.fbm(u * 6, v * 6, 3) * 0.1; return [78 + r * 14 + m * 60, 104 + r * 16 + m * 60, 138 + r * 18 + m * 60]; },
    B: (u, v) => { const crack = Math.abs(W.fbm(u * 7, v * 7, 4)) < 0.02 ? 0.25 : 0; const m = W.fbm(u * 5, v * 5, 4) * 0.12; return [48 + m * 60 + crack * 50, 40 + m * 50 + crack * 40, 44 + m * 50 + crack * 40]; },
    R: (u, v) => { const g = W.fbm(u * 18, v * 18, 3) * 0.14, m = W.fbm(u * 4, v * 4, 3) * 0.1; return [150 + (g + m) * 80, 66 + (g + m) * 50, 48 + (g + m) * 40]; },
    G: (u, v) => { const m = W.fbm(u * 5, v * 5, 4) * 0.14, leaf = W.fbm(u * 12 + 7, v * 12, 3) > 0.2 ? 0.08 : 0; return [62 + (m + leaf) * 70, 104 + (m + leaf) * 80, 66 + (m + leaf) * 60]; },
    C: (u, v) => { const b = W.fbm(u * 3, v * 120, 3, 2, 0.6) * 0.12, m = W.fbm(u * 5, v * 5, 3) * 0.06; return [150 + (b + m) * 70, 152 + (b + m) * 70, 150 + (b + m) * 70]; },
    M: (u, v) => { const b = W.fbm(u * 3, v * 120, 3, 2, 0.6) * 0.12, m = W.fbm(u * 5, v * 5, 3) * 0.08; return [184 + (b + m) * 80, 150 + (b + m) * 70, 84 + (b + m) * 50]; },
    L: (u, v) => { const g = W.fbm(u * 16, v * 16, 3) * 0.1, m = W.fbm(u * 4, v * 4, 3) * 0.1; return [138 + (g + m) * 70, 112 + (g + m) * 60, 82 + (g + m) * 50]; },
    T: (u, v) => { const g = W.fbm(u * 40, v * 40, 2) * 0.06, m = W.fbm(u * 5, v * 5, 3) * 0.08; return [206 + (g + m) * 50, 196 + (g + m) * 50, 170 + (g + m) * 50]; },
  };
  W.frame = (key, size = 256) => paint(size, (i, j, u, v) => FRAMES[key](u, v).map(c => clamp(c, 0, 255)));

  // ---- Sprites for particles ---------------------------------------------------------------------------------------------
  // An ember: a hot white core, a coloured body, soft edge with a little noise so no two look stamped.
  W.emberSprite = (size = 64) => paint(size, (i, j, u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2, n = W.fbm(u * 6, v * 6, 2) * 0.25;
    const a = clamp(1 - d - n) ** 1.6, core = clamp(1 - d * 2.4) ** 2;
    const c = 255 * (0.5 + core * 0.5);
    return [c, c, c, a * 255];
  });
  // A streak: the same, stretched, for the crackle around a spell and the drips off an arc.
  W.streakSprite = (size = 64) => paint(size, (i, j, u, v) => {
    const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2 * 4, d = Math.hypot(dx, dy);
    const a = clamp(1 - d) ** 1.4, core = clamp(1 - d * 2.5) ** 2, c = 255 * (0.55 + core * 0.45);
    return [c, c, c, a * 255];
  });
  // A basin: the stain a land soaks into the page, a card's size, its edge soft and a little ragged. A tapped well is this.
  W.basinSprite = (size = 128) => paint(size, (i, j, u, v) => {
    const qx = Math.max(0, Math.abs(u - 0.5) * 2 - 0.45), qy = Math.max(0, Math.abs(v - 0.5) * 2 - 0.5);
    const d = Math.hypot(qx / 0.55, qy / 0.5) + W.fbm(u * 6, v * 6, 3) * 0.25;
    const a = clamp(1 - d) ** 1.3;
    return [255, 255, 255, a * 255];
  });

  // A well's light: a pool the card lies in, not a rim round it. Full under the card (the middle 1/1.5 × 1/1.4 of the
  // square, the card's own footprint on a 1.5 × 1.4 plane) and soft past its edge, gone just inside the border, with the
  // edge wandering a little so no two pools are stamped alike.
  W.wellGlowSprite = (size = 128) => paint(size, (i, j, u, v) => {
    const ax = 1 / 1.5, ay = 1 / 1.4, qx = Math.max(0, Math.abs(u - 0.5) * 2 - ax) / (1 - ax), qy = Math.max(0, Math.abs(v - 0.5) * 2 - ay) / (1 - ay);
    const d = Math.hypot(qx, qy) * 1.1 + W.fbm(u * 4 + 4, v * 4 + 1, 3) * 0.25;
    const a = clamp(1 - d) ** 0.9;
    return [255, 255, 255, a * 255];
  });

  // Ash: where a creature was cast, the vellum round its foot is singed. Heat spreads from the foot: the browning deepens
  // gradually outward to its darkest umber at a wandering radius, then falls off over a soft tan haze. No edge anywhere,
  // only low, slow noise, so it reads as a scorch in the skin, never as a ring or strokes drawn round the card.
  W.ashSprite = (size = 256) => paint(size, (i, j, u, v) => {
    const a0 = Math.atan2(v - 0.5, u - 0.5), ca = Math.cos(a0), sa = Math.sin(a0);
    const d = Math.hypot(u - 0.5, v - 0.5) * 2 + W.fbm(u * 3 + 5, v * 3 + 1, 3) * 0.14;
    const r0 = 0.56 + W.fbm(ca * 1.2 + 7, sa * 1.2, 2) * 0.16, out = 0.2 + 0.1 * clamp(W.fbm(ca * 1.6 + 3, sa * 1.6 + 5, 2) + 0.5);
    const heat = d < r0 ? clamp(d / r0) ** 2.4 : Math.exp(-(((d - r0) / out) ** 2));
    const mottle = 0.82 + W.fbm(u * 7, v * 7, 2) * 0.36;
    const k = clamp(heat * mottle);
    return [mix(150, 52, k), mix(98, 26, k), mix(50, 10, k), k * 0.62 * 255];
  });

  // ---- The parchment the HTML uses: a tile as a data URL, set on :root as --parchment and --parchment-dark. -----------
  W.cssParchment = () => {
    const light = W.vellum(256, { tone: "#e6d6ae", wear: 0.5, repeat: 1 }).map;
    const dark = paint(256, (i, j, u, v) => { const m = W.fbm(u * 5, v * 5, 4) * 0.2, g = W.fbm(u * 60, v * 60, 2) * 0.08; const k = 1 + m + g; return [34 * k, 24 * k, 16 * k]; });
    document.documentElement.style.setProperty("--parchment", `url(${light.toDataURL("image/jpeg", 0.85)})`);
    document.documentElement.style.setProperty("--leather", `url(${dark.toDataURL("image/jpeg", 0.85)})`);
  };
})();
