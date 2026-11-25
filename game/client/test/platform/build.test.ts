/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clientBuild } from "../../src/platform";

const GAME = resolve(import.meta.dirname, "../../..");
const SRC = join(GAME, "client/src");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );

describe("clientBuild", () => {
  it("is the build stamp's content hash", () => {
    expect(clientBuild).toMatch(/^[0-9a-f]{12}$/);
  });

  it("hashes every input the bundle globs, so a fixture-only change is a new build", () => {
    const config = readFileSync(join(GAME, "vite.config.mts"), "utf8");
    const inputs = [...(/const BUILD_INPUTS = \[([^\]]*)\]/.exec(config)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    expect(inputs).toContain("client/src");
    const globbed = sources(SRC).flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/import\.meta\.glob[^(]*\(\s*"([^"]+)"/g)].map((m) =>
        relative(GAME, resolve(f, "..", m[1]!)).split("\\").join("/"),
      ),
    );
    expect(globbed.length).toBeGreaterThan(0);
    for (const g of globbed) expect(inputs.some((i) => g === i || g.startsWith(i + "/")), g).toBe(true);
  });
});
