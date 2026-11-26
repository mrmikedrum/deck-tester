import { describe, expect, it } from "vitest";
import { CH, CW, TH } from "../../src/layout/seat/geometry";
import {
  canonical,
  counterChip,
  counterKind,
  cssText,
  cssVariables,
  drawFace,
  faceKey,
  faceKeywords,
  faceSpec,
  frameKeyOf,
  materials,
  NO_SURFACES,
  paintPage,
  paintPrinted,
  shortName,
  shortType,
  tokens,
} from "../../src/theme";
import type { FaceEnv, FaceSpec } from "../../src/theme";

/** A recording 2D context: every call and assignment is logged, so a painting is comparable as data. */
function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (name in state) return state[name];
        if (name === "measureText") return (t: string) => ({ width: t.length * 14 });
        if (name === "createLinearGradient" || name === "createRadialGradient")
          return () => ({ addColorStop: (o: number, c: string) => log.push(`stop ${o} ${c}`) });
        if (name === "createPattern") return () => null;
        return (...a: unknown[]) =>
          void log.push(`${name}(${a.map((v) => (typeof v === "number" ? v.toFixed(2) : String(v))).join(",")})`);
      },
      set(_t, name: string, v) {
        state[name] = v;
        log.push(`${name}=${String(v)}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

class FakePath {
  constructor(readonly d?: string) {}
}
(globalThis as { Path2D?: unknown }).Path2D = FakePath;

const env: FaceEnv = { surfaces: NO_SURFACES, art: () => null };
const paint = (spec: FaceSpec): string[] => {
  const r = recorder();
  drawFace(r.ctx, spec, env);
  return r.log;
};

it("paints a lifted card at its decoded image size", () => {
  const { ctx, log } = recorder();
  const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
  const image = { width: 350, height: 488 } as HTMLImageElement;
  paintPrinted(canvas, image);
  expect([canvas.width, canvas.height]).toEqual([350, 488]);
  expect(log.find((call) => call.startsWith("drawImage("))).toMatch(/,0\.00,0\.00\)$/);
});

describe("tokens and css", () => {
  it("generates the custom properties the chrome stylesheet uses", () => {
    const vars = new Map(cssVariables());
    expect(vars.get("--sig-option")).toBe("#ff8a2a");
    expect(vars.get("--seat-near")).toBe(tokens.seat.near);
    expect(vars.get("--seat-ink-across")).toBe(tokens.seatInk.across);
    expect(vars.get("--card-edge")).toBe("#2a1f14");
    expect(vars.get("--t-hold")).toBe("380ms");
    expect(vars.get("--page-base")).toBe("#cdbb92");
  });
  it("has unique names and a stable text", () => {
    const names = cssVariables().map(([k]) => k);
    expect(new Set(names).size).toBe(names.length);
    expect(cssText()).toBe(cssText());
    expect(cssText().startsWith(":root {\n  --table: #1a110a;")).toBe(true);
  });
  it("keeps the card constants layout uses", () => {
    expect([materials.card.w, materials.card.h, materials.card.thickness]).toEqual([CW, CH, TH]);
  });
});

describe("face keys", () => {
  const base = faceSpec({
    name: "Herd Baloth",
    frame: "G",
    foot: { kind: "creature", power: 4, toughness: 4, basePower: 4, baseToughness: 4 },
  });
  it("is the same for equal looks whatever the field order", () => {
    const shuffled = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(base).reverse()))) as FaceSpec;
    expect(faceKey(shuffled)).toBe(faceKey(base));
  });
  it("changes with anything that changes the pixels", () => {
    const k = faceKey(base);
    const variants: FaceSpec[] = [
      { ...base, tapped: true },
      { ...base, far: true },
      { ...base, art: "cache/cards/art/x.jpg" },
      { ...base, gem: "lit" },
      { ...base, keywords: ["Trample"] },
      { ...base, tags: ["Copy"] },
      { ...base, foot: { kind: "creature", power: 5, toughness: 4, basePower: 4, baseToughness: 4 } },
      { ...base, owner: { label: "Ana's", colour: "#6b2a3a" } },
    ];
    for (const v of variants) expect(faceKey(v)).not.toBe(k);
    expect(new Set(variants.map(faceKey)).size).toBe(variants.length);
  });
  it("makes every face-down card of one tap state one key", () => {
    expect(faceKey({ ...base, down: true, name: "A" })).toBe(faceKey({ ...base, down: true, name: "B" }));
    expect(faceKey({ ...base, down: true, tapped: true })).not.toBe(faceKey({ ...base, down: true }));
  });
  it("canonical drops undefined and sorts keys", () => {
    expect(canonical({ b: 1, a: undefined, c: [2, { z: 1, y: 2 }] })).toBe('{"b":1,"c":[2,{"y":2,"z":1}]}');
  });
});

describe("painters", () => {
  const spec = faceSpec({
    name: "Meloku the Clouded Mirror",
    frame: "U",
    far: true,
    keywords: ["Flying"],
    foot: { kind: "creature", power: 2, toughness: 2, basePower: 2, baseToughness: 2 },
  });
  it("are deterministic: equal specs paint identical calls", () => {
    expect(paint(spec)).toEqual(paint({ ...spec }));
    expect(paint(spec).length).toBeGreaterThan(100);
  });
  it("paint differently for different specs", () => {
    expect(paint(spec)).not.toEqual(paint({ ...spec, tapped: true }));
    expect(paint(spec)).not.toEqual(paint({ ...spec, far: false }));
  });
  it("shortens the name it draws", () => {
    expect(paint(spec).some((l) => l.startsWith("fillText(Meloku,"))).toBe(true);
  });
  it("paints a page's ragged edge the same way each time", () => {
    const run = (): string[] => {
      const r = recorder();
      const canvas = { width: 0, height: 0, getContext: () => r.ctx } as unknown as HTMLCanvasElement;
      paintPage(canvas, { layer: "mask", w: 8.4, d: 12.2, ink: "#000", seed: 5 }, NO_SURFACES);
      return r.log;
    };
    expect(run()).toEqual(run());
  });
});

describe("face text rules", () => {
  it("shortens names like the old client", () => {
    expect(shortName("The Ur-Dragon")).toBe("Ur-Dragon");
    expect(shortName("Otawara, Soaring City")).toBe("Otawara");
    expect(shortName("Meloku the Clouded Mirror")).toBe("Meloku");
    expect(shortName("Jace of the Ages")).toBe("Jace");
    expect(shortName("Sol Ring")).toBe("Sol Ring");
  });
  it("names the type on a foot", () => {
    expect(shortType("Legendary Artifact — Equipment")).toBe("Equipment");
    expect(shortType("Snow Land")).toBe("Land");
    expect(shortType("Enchantment — Aura")).toBe("Aura");
  });
  it("picks frames", () => {
    expect(frameKeyOf({ token: true, land: false, colours: ["G"] })).toBe("T");
    expect(frameKeyOf({ token: false, land: true, colours: [] })).toBe("L");
    expect(frameKeyOf({ token: false, land: false, colours: ["W", "U"] })).toBe("M");
    expect(frameKeyOf({ token: false, land: false, colours: ["R"] })).toBe("R");
    expect(frameKeyOf({ token: false, land: false, colours: [] })).toBe("C");
  });
  it("orders keyword icons and drops the unknown", () => {
    expect(faceKeywords(["Lifelink", "Flying", "Banding"])).toEqual(["Flying", "Lifelink"]);
  });
});

describe("counter chips", () => {
  it("read the engine's counter names as the old client did: +1/+1 as \"+2\", loyalty on the face, others by name", () => {
    expect(counterChip("+1/+1", 2)).toMatchObject({ text: "+2", sub: null });
    expect(counterChip("-1/-1", 1)).toMatchObject({ text: "−1", sub: null });
    expect(counterChip("Charge", 7)).toMatchObject({ text: "7", sub: "charge" });
    expect(counterChip("P1P1", 3)).toMatchObject({ text: "+3", sub: null });
    expect(counterKind("Loyalty")).toBe("LOYALTY");
  });
});
