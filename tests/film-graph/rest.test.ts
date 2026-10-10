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
    expect(first.body.page.total).toBe(732);
    let cursor = first.body.page.nextCursor;
    const seen = new Set(first.body.data.map((film: { id: string }) => film.id));
    let last = first;
    while (cursor) {
      last = await api.rest(`/studios/126399/films?limit=100&cursor=${encodeURIComponent(cursor)}`);
      for (const film of last.body.data) seen.add(film.id);
      cursor = last.body.page.nextCursor;
    }
    expect(last.body.data).toHaveLength(32);
    expect(seen.size).toBe(732);
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

describe("REST name search", () => {
  test("/people?search=&role= ranks matches and embeds a known-for film", async () => {
    const result = await api.rest("/people?search=nolan&role=director&limit=3");
    expect(result.status).toBe(200);
    expect(result.body.data[0]).toMatchObject({ name: "Christopher Nolan", birthYear: 1970 });
    expect(result.body.data[0].knownFor.href).toMatch(/\/films\/\d+$/);
    expect(Number(result.headers.get("x-db-queries"))).toBeLessThanOrEqual(3);
  });

  test("/studios?search= returns film counts", async () => {
    const result = await api.rest("/studios?search=warner&limit=2");
    expect(result.body.data[0].name).toBe("Warner Bros. Entertainment");
    expect(result.body.data[0].filmCount).toBeGreaterThan(100);
    expect(result.body.page.nextCursor).toBeTruthy();
  });

  test("bad role and missing search are 400s", async () => {
    expect((await api.rest("/people?search=tom&role=gaffer")).status).toBe(400);
    expect((await api.rest("/studios")).status).toBe(400);
  });
});
