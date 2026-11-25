// Eases for the chrome's own motion, evaluated at the commit's time (never by CSS timers, so a frame shows the same
// thing however it is reached).

/** A CSS cubic-bezier(x1, y1, x2, y2) as a function of progress in [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 1 + 3 * x1 - 3 * x2, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 + 3 * y1 - 3 * y2, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const x = (s: number): number => ((ax * s + bx) * s + cx) * s;
  const dx = (s: number): number => (3 * ax * s + 2 * bx) * s + cx;
  const y = (s: number): number => ((ay * s + by) * s + cy) * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t, d = dx(s);
      if (Math.abs(err) < 1e-6) return y(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 30; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

/** CSS `ease-out`: the old fan's settle (`hand-settle`, WAAPI easing "ease-out"). */
export const easeOut = cubicBezier(0, 0, 0.58, 1);

export const clamp01 = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
