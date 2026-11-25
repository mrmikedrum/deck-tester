// Canvas helpers the painters share: the context type, a rounded rectangle path, a seeded generator, and the key
// function that turns a plain description into a cache key.

export type Ctx = CanvasRenderingContext2D;
export type Canvas = HTMLCanvasElement;

/** A rounded-rectangle path (arcs, so it is the same shape in every browser). */
export function rr(x: Ctx, X: number, Y: number, W: number, H: number, r: number): void {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + W, Y, X + W, Y + H, r);
  x.arcTo(X + W, Y + H, X, Y + H, r);
  x.arcTo(X, Y + H, X, Y, r);
  x.arcTo(X, Y, X + W, Y, r);
  x.closePath();
}

/** Size a canvas and take its 2D context; the painters draw into whatever canvas they are given. */
export function begin(canvas: Canvas, w: number, h: number): Ctx {
  canvas.width = w;
  canvas.height = h;
  const x = canvas.getContext("2d");
  if (!x) throw new Error("no 2d context");
  return x;
}

/** A small seeded generator (park-miller): the painters' only randomness, so a painting is the same every time. */
export function seeded(seed: number): () => number {
  let s = (seed >>> 0) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** A stable seed for a string (FNV-1a). */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** JSON with sorted keys: equal descriptions give equal strings whatever order their fields were built in. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}
