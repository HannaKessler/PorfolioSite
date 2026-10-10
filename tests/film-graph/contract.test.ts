/**
 * Contract tests: for every explorer preset, the GraphQL query and the REST
 * plan (the exact code the explorer runs) must produce identical data.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { setup, type TestApi } from "./helpers";
import { ALL_PRESETS, PRESETS, variablesFor, type BlankKind, type Choice } from "../../src/filmgraph/client/presets";
import {
  graphqlSearch,
  restSearchPath,
  suggestionsFromGraphQL,
  suggestionsFromRest,
} from "../../src/filmgraph/client/search";

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

describe("name search: GraphQL and REST suggest the same people and studios", () => {
  const cases: [BlankKind, string][] = [
    ["director", "chris"],
    ["actor", "tom h"],
    ["actor", "penelope"],
    ["studio", "warner"],
  ];
  for (const [kind, text] of cases) {
    test(`${kind}: "${text}"`, async () => {
      const { query, variables } = graphqlSearch(kind, text);
      const graphql = await api.graphql(query, variables);
      expect(graphql.body.errors).toBeUndefined();
      const fromGraphQL = suggestionsFromGraphQL(kind, graphql.body.data);
      const fromRest = suggestionsFromRest(kind, await api.restFetch(restSearchPath(kind, text)));
      expect(fromGraphQL.length).toBeGreaterThan(0);
      expect(fromRest).toEqual(fromGraphQL);
    });
  }
});

describe("the question builder: names typed into blanks drive both APIs", () => {
  /** What the builder does: search a name, take the top suggestion's id. */
  async function pick(kind: BlankKind, text: string): Promise<Choice> {
    const { query, variables } = graphqlSearch(kind, text);
    const [top] = suggestionsFromGraphQL(kind, (await api.graphql(query, variables)).body.data);
    return { id: top.id, name: top.name };
  }
  const typed: Record<string, Record<string, [BlankKind, string]>> = {
    director: { id: ["director", "spielberg"] },
    filmography: { id: ["actor", "harrison ford"] },
    shared: { a: ["actor", "tom hanks"], b: ["actor", "meg ryan"] },
    studio: { id: ["studio", "paramount"] },
    path: { from: ["actor", "audrey hepburn"], to: ["actor", "brad pitt"] },
  };
  for (const preset of PRESETS) {
    test(preset.id, async () => {
      const choices: Record<string, Choice> = {};
      for (const [variable, [kind, text]] of Object.entries(typed[preset.id])) choices[variable] = await pick(kind, text);
      const variables = variablesFor(preset, choices);
      const graphql = await api.graphql(preset.query, variables);
      expect(graphql.body.errors).toBeUndefined();
      expect(await preset.rest(api.restFetch, variables)).toEqual(graphql.body.data);
    });
  }
});
