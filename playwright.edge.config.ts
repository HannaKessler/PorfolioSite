import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.FILM_GRAPH_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "tests",
  testMatch: /e2e[\\/].*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "msedge", use: { ...devices["Desktop Edge"], channel: "msedge" } }],
  webServer: process.env.FILM_GRAPH_BASE_URL
    ? undefined
    : { command: "npx astro preview --port 4321", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
