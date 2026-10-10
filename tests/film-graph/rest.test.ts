import { beforeAll, describe, expect, test } from "vitest";
import { setup, type TestApi } from "./helpers";

let api: TestApi;
beforeAll(async () => {
  api = await setup();
});

describe("REST", () => {
  test("film resource with embedded genres and studios", async () => {
    const result = await api.rest("/films/47703");
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toMatch(/application\/json/);
    expect(result.body).toMatchObject({ id: 47703, title: "The Godfather", wikidataId: "Q47703" });
    expect(result.body.genres.length).toBeGreaterThan(0);
    expect(result.body.links.credits).toBe("/projects/film-graph/api/rest/films/47703/credits");
  });

  test("ETag and If-None-Match give a 304 with no body", async () => {
    const first = await api.rest("/films/47703/credits?role=actor");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);
    const again = await api.rest("/films/47703/credits?role=actor", { "If-None-Match": etag! });
    expect(again.status).toBe(304);
    expect(again.body).toBeNull();
    expect(again.headers.get("etag")).toBe(etag);
    const weak = await api.rest("/films/47703/credits?role=actor", { "If-None-Match": `W/${etag}` });
    expect(weak.status).toBe(304);
    const other = await api.rest("/films/47703/credits?role=actor", { "If-None-Match": '"0000"' });
    expect(other.status).toBe(200);
  });

  test("lists page with nextCursor and report totals", async () => {
    const first = await api.rest("/studios/126399/films?limit=100");
    expect(first.body.data).toHaveLength(100);
    expect(first.body.page.total).toBe(188);
    const second = await api.rest(`/studios/126399/films?limit=100&cursor=${encodeURIComponent(first.body.page.nextCursor)}`);
    expect(second.body.data).toHaveLength(88);
    expect(second.body.page.nextCursor).toBeNull();
  });

  test("errors are typed JSON with the right status", async () => {
    expect((await api.rest("/films/1")).status).toBe(404);
    expect((await api.rest("/films/1")).body.error.code).toBe("NOT_FOUND");
    expect((await api.rest("/films/abc")).body.error.code).toBe("BAD_USER_INPUT");
    expect((await api.rest("/films?limit=500")).status).toBe(400);
    expect((await api.rest("/films/47703/credits?role=gaffer")).status).toBe(400);
    expect((await api.rest("/nope")).status).toBe(404);
    const post = await api.rest("/films", {}, "POST");
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  test("responses report database work in headers", async () => {
    const result = await api.rest("/people/2263/films?role=actor");
    expect(Number(result.headers.get("x-db-queries"))).toBe(result.trace.sql.length);
    expect(result.headers.get("server-timing")).toMatch(/^db;dur=/);
  });
});
