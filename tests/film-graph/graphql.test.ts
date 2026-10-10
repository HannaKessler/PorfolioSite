import { beforeAll, describe, expect, test } from "vitest";
import { setup, type TestApi } from "./helpers";
import { SIX_DEGREES, DIRECTOR_WITH_CAST } from "../../src/filmgraph/operations";
import { sha256Hex } from "../../src/filmgraph/hash";
import { PERSISTED_ONLY_HEADER } from "../../src/filmgraph/config";

let api: TestApi;
beforeAll(async () => {
  api = await setup();
});

describe("resolvers", () => {
  test("film by numeric or Q-prefixed id, with nested fields", async () => {
    const query = `query ($id: ID!) { film(id: $id) { id title year wikidataId directors { name } genres { name } studios { name } } }`;
    const plain = await api.graphql(query, { id: "47703" });
    const prefixed = await api.graphql(query, { id: "Q47703" });
    expect(plain.status).toBe(200);
    expect(plain.body.data.film).toMatchObject({ title: "The Godfather", year: 1972, wikidataId: "Q47703" });
    expect(plain.body.data.film.directors).toEqual([{ name: "Francis Ford Coppola" }]);
    expect(prefixed.body).toEqual(plain.body);
  });

  test("unknown ids are null, malformed ids are typed errors", async () => {
    const missing = await api.graphql(`{ film(id: "1") { title } }`);
    expect(missing.body).toEqual({ data: { film: null } });
    const bad = await api.graphql(`{ film(id: "abc") { title } }`);
    expect(bad.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
    const hops = await api.graphql(`{ actorPath(from: "3454165", to: "4616", maxHops: 5) { hops } }`);
    expect(hops.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
  });

  test("validation errors come back from Yoga as GraphQL errors", async () => {
    // With Accept: application/json, Yoga follows GraphQL over HTTP and answers 200.
    const result = await api.graphql(`{ film(id: "47703") { nope } }`);
    expect(result.status).toBe(200);
    expect(result.body.data).toBeUndefined();
    expect(result.body.errors[0].message).toMatch(/nope/);
  });

  test("connections paginate and count", async () => {
    const query = `query ($after: String) { films(first: 3, after: $after, filter: { genre: "471839" }) {
      totalCount pageInfo { hasNextPage endCursor } edges { cursor node { id } } } }`;
    const first = await api.graphql(query);
    const second = await api.graphql(query, { after: first.body.data.films.pageInfo.endCursor });
    expect(first.body.data.films.totalCount).toBeGreaterThan(50);
    expect(first.body.data.films.edges).toHaveLength(3);
    const ids = new Set(first.body.data.films.edges.map((edge: any) => edge.node.id));
    for (const edge of second.body.data.films.edges) expect(ids.has(edge.node.id)).toBe(false);
  });

  test("creditsByDecade groups in order", async () => {
    const result = await api.graphql(`{ person(id: "2263") { creditsByDecade(role: ACTOR) { decade credits { film { year } } } } }`);
    const groups = result.body.data.person.creditsByDecade;
    expect(groups.map((g: any) => g.decade)).toEqual([...groups.map((g: any) => g.decade)].sort());
    for (const group of groups) {
      for (const credit of group.credits) expect(Math.floor(credit.film.year / 10) * 10).toBe(group.decade);
    }
  });
});

describe("DataLoader batching (N+1)", () => {
  test("batching cuts six-degrees from 100+ queries to a handful with identical data", async () => {
    const off = await api.graphql(SIX_DEGREES, { id: "104123" }, api.batchingOff);
    const on = await api.graphql(SIX_DEGREES, { id: "104123" });
    expect(off.trace.sql.length).toBeGreaterThan(100);
    expect(on.trace.sql.length).toBeLessThanOrEqual(6);
    expect(Number(on.headers.get("x-db-queries"))).toBe(on.trace.sql.length);
    expect(on.body).toEqual(off.body);
  });
});

describe("persisted queries", () => {
  test("a preset can be sent as a hash alone", async () => {
    const hash = await sha256Hex(DIRECTOR_WITH_CAST);
    const byHash = await api.graphqlRaw({
      variables: { id: "25191" },
      extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
    });
    const byText = await api.graphql(DIRECTOR_WITH_CAST, { id: "25191" });
    expect(byHash.status).toBe(200);
    expect(byHash.body).toEqual(byText.body);
    expect(byHash.trace.persisted).toBe(true);
  });

  test("unknown hashes are rejected", async () => {
    const result = await api.graphqlRaw({
      extensions: { persistedQuery: { version: 1, sha256Hash: await sha256Hex("{ genres { name } }") } },
    });
    expect(result.body.errors[0].message).toMatch(/PersistedQueryNotFound/i);
  });

  test("persisted-only mode rejects full query text", async () => {
    const result = await api.graphql(`{ genres { name } }`, {}, { [PERSISTED_ONLY_HEADER]: "on" });
    expect(result.body.errors[0].message).toMatch(/PersistedQueryOnly/i);
    const allowed = await api.graphql(`{ genres { name } }`);
    expect(allowed.body.data.genres.length).toBeGreaterThan(10);
  });
});
