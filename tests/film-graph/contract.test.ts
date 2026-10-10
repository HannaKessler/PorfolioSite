/**
 * Contract tests: for every explorer preset, the GraphQL query and the REST
 * plan (the exact code the explorer runs) must produce identical data.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { setup, type TestApi } from "./helpers";
import { ALL_PRESETS } from "../../src/filmgraph/client/presets";

let api: TestApi;
beforeAll(async () => {
  api = await setup();
});

describe("GraphQL and REST return the same data", () => {
  for (const preset of ALL_PRESETS) {
    test(preset.label, async () => {
      const graphql = await api.graphql(preset.query, preset.variables);
      expect(graphql.body.errors).toBeUndefined();
      const rest = await preset.rest(api.restFetch, preset.variables);
      expect(rest).toEqual(graphql.body.data);
      expect(JSON.stringify(graphql.body.data).length).toBeGreaterThan(100);
    });
  }
});
