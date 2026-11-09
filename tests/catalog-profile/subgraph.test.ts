import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import { typeDefs } from "../../src/catalog-profile/schema";

describe("federation subgraph schema", () => {
  it("builds with @apollo/subgraph in Node without loading that package in the shop client", async () => {
    const { buildSubgraphSchema } = await import("@apollo/subgraph");
    const schema = buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers: {} }]);
    expect(schema).toBeTruthy();
    expect(typeDefs).toContain("extend schema @link");
    expect(typeDefs).toContain('@key(fields: "id")');
  });
});
