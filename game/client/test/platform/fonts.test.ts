// The fonts gate: every face the client draws with is loaded by name (a face the page has not used yet, like the hand
// labels' Barlow Condensed 700, would otherwise be measured and painted in a fallback), then the page's fonts settle.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FONT_FACES, fontsReady } from "../../src/platform";

afterEach(() => vi.unstubAllGlobals());

function fakeFonts(fail: (font: string) => boolean = () => false) {
  const loaded: string[] = [];
  let settled = false;
  const fonts = {
    load: vi.fn((font: string) => {
      loaded.push(font);
      return fail(font) ? Promise.reject(new Error("no such face")) : Promise.resolve([]);
    }),
    get ready() {
      return Promise.resolve().then(() => void (settled = true));
    },
  };
  vi.stubGlobal("document", { fonts });
  return { loaded, settled: () => settled };
}

describe("fontsReady", () => {
  it("loads each face the client uses, the hand labels' Barlow Condensed 700 among them", async () => {
    const f = fakeFonts();
    await fontsReady();
    expect(f.loaded).toHaveLength(FONT_FACES.length);
    expect(f.loaded).toContain('700 16px "Barlow Condensed"');
    for (const w of [400, 500, 600, 700]) expect(f.loaded).toContain(`${w} 16px "Barlow"`);
    expect(f.loaded).toContain('italic 400 16px "IM Fell English"');
    expect(f.settled()).toBe(true);
  });
  it("a face that fails to load does not hold the gate shut", async () => {
    const f = fakeFonts((font) => font.includes("IM Fell"));
    await expect(fontsReady()).resolves.toBeUndefined();
    expect(f.settled()).toBe(true);
  });
  it("resolves at once where there is no document", async () => {
    vi.stubGlobal("document", undefined);
    await expect(fontsReady()).resolves.toBeUndefined();
  });
});

describe("FONT_FACES", () => {
  it("names exactly the faces the app imports", () => {
    const main = readFileSync(resolve(import.meta.dirname, "../../src/app/main.ts"), "utf8");
    const family: Record<string, string> = { barlow: "Barlow", "barlow-condensed": "Barlow Condensed", "im-fell-english": "IM Fell English" };
    const imported = [...main.matchAll(/@fontsource\/([a-z-]+)\/(\d+)(-italic)?\.css/g)].map(
      ([, fam, w, it]) => `${it ? "italic " : ""}${w} 16px "${family[fam!] ?? fam}"`,
    );
    expect(imported.length).toBeGreaterThan(0);
    expect([...FONT_FACES].sort()).toEqual(imported.sort());
  });
});
