import js from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

// The layering and determinism rules of docs/game-client-architecture.md ("Layers", "The frame").
const layers = [
  "platform",
  "protocol",
  "transport",
  "model",
  "layout",
  "play",
  "narrative",
  "theme",
  "scene",
  "chrome",
  "input",
  "app",
  "fixtures",
];
const coreRenderer = ["protocol", "model", "layout", "play", "narrative", "theme", "input", "platform"];
const allowed = {
  platform: [],
  protocol: [],
  transport: ["protocol", "platform"],
  model: ["protocol"],
  layout: ["protocol", "model"],
  play: ["protocol", "model", "layout"],
  narrative: ["protocol", "model", "layout"],
  theme: [],
  scene: coreRenderer,
  chrome: coreRenderer,
  input: ["platform"],
  app: layers,
  fixtures: ["protocol", "model"],
};

const policies = layers.map((from) => ({
  from: { element: { type: from } },
  allow: { to: { element: { types: [...new Set([from, ...allowed[from]])] } } },
}));

// Anything that reads or schedules time, or randomness, belongs to platform/ (the recorder replaces these).
const nondeterministic = [
  "Date",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "performance",
  "MessageChannel",
  "Worker",
  "queueMicrotask",
].map((name) => ({ name, message: "Time and scheduling go through platform/clock; see game-client-architecture.md." }));
const domGlobals = ["document", "window", "navigator", "localStorage", "sessionStorage", "location", "self"].map(
  (name) => ({ name, message: "The pure core has no DOM; platform/ and the renderers own it." }),
);
const globalObjects = ["globalThis", "window", "self"];
const bannedProps = (extra) => [
  { object: "Math", property: "random", message: "Random goes through platform/rng." },
  { object: "performance", property: "now", message: "Time goes through platform/clock." },
  ...globalObjects.flatMap((object) =>
    [...nondeterministic.map((g) => g.name), ...extra].map((property) => ({
      object,
      property,
      message: "Time, scheduling and randomness go through platform/.",
    })),
  ),
];

const hooks = {
  name: "preact/hooks",
  importNames: ["useEffect", "useLayoutEffect"],
  message: "Effects live only in chrome/frame/, stepped by the app's commit.",
};
const threePattern = { regex: "^three(/.*)?$", message: "three.js is imported only from scene/three/." };
const compat = { name: "preact/compat", message: "There is no React dependency to bridge." };
const restrictedImports = (opts) => ["error", opts];

const pureCore = ["protocol", "model", "layout", "play", "narrative"].map((d) => `client/src/${d}/**`);

export default tseslint.config(
  { ignores: ["client/dist/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { project: "tsconfig.json" } },
      "boundaries/elements": layers.map((type) => ({ type, pattern: `client/src/${type}` })),
    },
    rules: {
      "boundaries/dependencies": [2, { default: "disallow", policies }],
      "no-restricted-globals": ["error", ...nondeterministic],
      "no-restricted-properties": ["error", ...bannedProps([])],
      "no-restricted-imports": restrictedImports({ paths: [hooks, compat], patterns: [threePattern] }),
    },
  },
  {
    files: ["client/src/scene/three/**"],
    rules: { "no-restricted-imports": restrictedImports({ paths: [hooks, compat] }) },
  },
  {
    files: ["client/src/chrome/frame/**"],
    rules: { "no-restricted-imports": restrictedImports({ paths: [compat], patterns: [threePattern] }) },
  },
  {
    files: pureCore.map((p) => `${p}/*.{ts,tsx}`),
    rules: {
      "no-restricted-globals": ["error", ...nondeterministic, ...domGlobals],
      "no-restricted-properties": ["error", ...bannedProps(["document"])],
    },
  },
  {
    // platform/ is the one place time, scheduling and the DOM enter.
    files: ["client/src/platform/**"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" },
  },
);
