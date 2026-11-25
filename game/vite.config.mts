import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const engine = "http://localhost:8765";
// Long polls hold a request open for tens of seconds: no proxy timeout.
const proxy = { target: engine, changeOrigin: true, timeout: 0, proxyTimeout: 0 };

// The build id: a content hash of the client's sources (no timestamps), compiled in as __CLIENT_BUILD__ and
// written to dist/build.json, which the bridge stamps on every snapshot so an old page can tell it is old. Everything
// the bundle takes in counts, the workbench's import.meta.glob inputs (the protocol corpus, a test catalog) included.
// deckmaster/game.py's STAMP_INPUTS is the same list (tests/test_game_bridge.py holds them together).
const BUILD_INPUTS = [
  "client/src",
  "client/index.html",
  "client/workbench.html",
  "client/public",
  "package-lock.json",
  "vite.config.mts",
  "../tests/fixtures/protocol",
  "client/test/model/catalog.json",
];

function files(path: string): string[] {
  if (!statSync(path, { throwIfNoEntry: false })) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .filter((name) => !name.startsWith("."))
    .flatMap((name) => files(join(path, name)));
}

function buildId(): string {
  const hash = createHash("sha256");
  const all = BUILD_INPUTS.flatMap((p) => files(resolve(import.meta.dirname, p)))
    .map(
      (f) =>
        [
          relative(import.meta.dirname, f)
            .split("\\")
            .join("/"),
          f,
        ] as const,
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, f] of all) hash.update(`${name}\0${statSync(f).size}\0`).update(readFileSync(f));
  return hash.digest("hex").slice(0, 12);
}

function buildStamp(): Plugin {
  const id = buildId();
  let outDir = "";
  return {
    name: "deckmaster-build-stamp",
    config: () => ({ define: { __CLIENT_BUILD__: JSON.stringify(id) } }),
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle: () => writeFileSync(join(outDir, "build.json"), JSON.stringify({ build: id }) + "\n"),
  };
}

export default defineConfig({
  plugins: [buildStamp()],
  root: "client",
  cacheDir: "../node_modules/.vite",
  base: "./",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "client/index.html"),
        workbench: resolve(import.meta.dirname, "client/workbench.html"),
      },
    },
  },
  server: { host: true, proxy: { "/api": proxy, "/cache": proxy } },
  preview: { host: true },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Some suites settle whole corpus games in the scene; on a loaded machine that runs past Vitest's 5 s default.
    testTimeout: 30_000,
  },
});
