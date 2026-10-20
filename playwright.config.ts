import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (Film Graph, Agent Trace Viewer). They run against the built site (npm run build)
// served by `astro preview` on localhost, where service workers are allowed.
// Set FILM_GRAPH_BASE_URL to test a site that is already running.
const baseURL = process.env.FILM_GRAPH_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "tests",
  testMatch: /e2e[\\/].*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.FILM_GRAPH_BASE_URL
    ? undefined
    : { command: "npx astro preview --port 4321", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
