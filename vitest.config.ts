import { defineConfig } from "vitest/config";

// Unit and contract tests for Film Graph. Each test file boots its own
// in-memory PGlite and loads the real seed, so allow a generous timeout.
export default defineConfig({
  test: {
    include: ["tests/film-graph/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
