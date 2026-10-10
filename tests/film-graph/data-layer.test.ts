import { beforeAll, describe, expect, test } from "vitest";
import { setup, seed, type TestApi } from "./helpers";
import {
  ApiError,
  actorPath,
  countFilms,
  decodeCursor,
  encodeCursor,
  listFilms,
  searchNamed,
  sharedFilms,
  studioGenreBreakdown,
  toPrefixQuery,
} from "../../src/filmgraph/db/access";

let api: TestApi;
beforeAll(async () => {
  api = await setup();
});

const BACON = 3454165;
const MONROE = 4616;
const DE_NIRO = 36949;
const PACINO = 41163;
const DRAMA = 130232;

describe("seed", () => {
  test("loads every row from the seed file", async () => {
    const { rows } = await api.pg.query<{ films: number; people: number; credits: number; studios: number; genres: number }>(
      `SELECT (SELECT count(*) FROM film)::int AS films, (SELECT count(*) FROM person)::int AS people,
              (SELECT count(*) FROM credit)::int AS credits, (SELECT count(*) FROM studio)::int AS studios,
              (SELECT count(*) FROM genre)::int AS genres`,
    );
    expect(rows[0]).toEqual({
      films: seed.films.length,
      people: seed.people.length,
      credits: seed.credits.length,
      studios: seed.studios.length,
      genres: seed.genres.length,
    });
    expect(seed.films.length).toBeGreaterThanOrEqual(1500);
  });

  test("every film has a director and at least three billed actors", async () => {
    const { rows } = await api.pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM film f WHERE
         (SELECT count(*) FROM credit c WHERE c.film_id = f.id AND c.role = 'actor') < 3
         OR NOT EXISTS (SELECT 1 FROM credit c WHERE c.film_id = f.id AND c.role = 'director')`,
    );
    expect(rows[0].count).toBe(0);
  });
});

describe("listFilms", () => {
  test("cursor pagination visits every match exactly once", async () => {
    const total = await countFilms(api.db, { genreId: DRAMA });
    const seen = new Set<number>();
    let after: string | null = null;
    let pages = 0;
    do {
      const page = await listFilms(api.db, { genreId: DRAMA }, { first: 100, after });
      page.rows.forEach((film) => seen.add(film.id));
      after = page.hasNextPage ? page.endCursor : null;
      pages += 1;
    } while (after);
    expect(seen.size).toBe(total);
    expect(pages).toBe(Math.ceil(total / 100));
  });

  test("orders by year and filters by year range and title search", async () => {
    const page = await listFilms(api.db, { yearFrom: 1990, yearTo: 1999, search: "the" }, { first: 50, orderBy: "year" });
    expect(page.rows.length).toBeGreaterThan(5);
    for (const film of page.rows) {
      expect(film.year).toBeGreaterThanOrEqual(1990);
      expect(film.year).toBeLessThanOrEqual(1999);
      expect(film.title.toLowerCase()).toMatch(/\bthe/);
    }
    const years = page.rows.map((film) => film.year);
    expect([...years].sort((a, b) => a - b)).toEqual(years);
  });

  test("prefix search matches the start of each word", async () => {
    const page = await listFilms(api.db, { search: "godfa" }, { first: 10 });
    expect(page.rows.map((film) => film.title)).toContain("The Godfather");
  });

  test("rejects bad input with typed errors", async () => {
    await expect(listFilms(api.db, {}, { first: 0 })).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
    await expect(listFilms(api.db, {}, { first: 101 })).rejects.toBeInstanceOf(ApiError);
    await expect(listFilms(api.db, {}, { after: "not-a-cursor" })).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
    await expect(listFilms(api.db, { yearFrom: 2000, yearTo: 1990 })).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
    await expect(listFilms(api.db, { search: "!!!" })).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
  });
});

describe("helpers", () => {
  test("cursors round-trip and check their shape", () => {
    expect(decodeCursor(encodeCursor([12, 34]), ["number", "number"])).toEqual([12, 34]);
    expect(() => decodeCursor(encodeCursor(["x", 34]), ["number", "number"])).toThrow(ApiError);
  });

  test("search text cannot inject tsquery operators", () => {
    expect(toPrefixQuery("star wars")).toBe("star:* & wars:*");
    expect(toPrefixQuery("a' | b & !c:*")).toBe("a:* & b:* & c:*");
    expect(toPrefixQuery("  ")).toBeNull();
  });
});

describe("purpose-built queries", () => {
  test("shared films for De Niro and Pacino", async () => {
    const films = await sharedFilms(api.db, DE_NIRO, PACINO);
    expect(films.map((film) => film.title)).toEqual(["The Godfather Part II", "Heat", "The Irishman"]);
  });

  test("actor path is short, valid and bounded", async () => {
    const start = api.trace.length;
    const steps = await actorPath(api.db, BACON, MONROE, 3);
    expect(api.trace.length - start).toBeLessThanOrEqual(3);
    expect(steps).not.toBeNull();
    expect(steps!.length).toBeLessThanOrEqual(3);
    expect(steps![0].fromId).toBe(BACON);
    expect(steps!.at(-1)!.toId).toBe(MONROE);
    for (const [index, step] of steps!.entries()) {
      if (index > 0) expect(step.fromId).toBe(steps![index - 1].toId);
      const { rows } = await api.pg.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM credit WHERE film_id = $1 AND role = 'actor' AND person_id = ANY($2::int[])`,
        [step.filmId, [step.fromId, step.toId]],
      );
      expect(rows[0].count).toBe(2);
    }
    expect(await actorPath(api.db, BACON, BACON)).toEqual([]);
    await expect(actorPath(api.db, BACON, MONROE, 4)).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
  });

  test("studio genre breakdown counts match the links", async () => {
    const rows = await studioGenreBreakdown(api.db, 126399);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const { rows: check } = await api.pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM film_studio fs JOIN film_genre fg ON fg.film_id = fs.film_id WHERE fs.studio_id = 126399`,
    );
    expect(total).toBe(check[0].count);
  });

  test("people search pages by name", async () => {
    const first = await searchNamed(api.db, "person", "tom", { first: 5 });
    expect(first.rows).toHaveLength(5);
    expect(first.hasNextPage).toBe(true);
    const second = await searchNamed(api.db, "person", "tom", { first: 5, after: first.endCursor });
    expect(second.rows[0].name >= first.rows[4].name).toBe(true);
    expect(second.rows.map((p) => p.id)).not.toContain(first.rows[0].id);
  });
});
