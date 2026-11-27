// Chromium by default. Set BEHAVIOUR_BROWSERS=chromium,webkit to run both.
const { defineConfig } = require("@playwright/test");
const os = require("os"), path = require("path");

const LAUNCH = {
  chromium: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  webkit: {},
};
const browsers = (process.env.BEHAVIOUR_BROWSERS || "chromium").split(",").map(b => b.trim()).filter(Boolean);

module.exports = defineConfig({
  testDir: ".",
  testMatch: "*.spec.js",
  globalSetup: require.resolve("./global-setup.js"),
  globalTeardown: require.resolve("./global-teardown.js"),
  outputDir: path.join(os.tmpdir(), "deckmaster-behaviour-results"),
  timeout: 60000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BEHAVIOUR_BASE,   // set by globalSetup
    headless: true,
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  projects: browsers.map(name => ({ name, use: { browserName: name, launchOptions: LAUNCH[name] || {} } })),
});
