import { beforeAll, describe, expect, test } from "vitest";
import { setup, seed, type TestApi } from "./helpers";
import {
  ApiError,
  actorPath,
  countFilms,
  decodeCursor,
  encodeCursor,
  listFilms,
  foldName,
  searchNames,
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
    expect(seed.films.length).toBeGreaterThanOrEqual(15000);
  });

  test("every film has a director and at least two billed actors", async () => {
    const { rows } = await api.pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM film f WHERE
         (SELECT count(*) FROM credit c WHERE c.film_id = f.id AND c.role = 'actor') < 2
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
    expect(films.map((film) => film.title)).toEqual(["The Godfather Part II", "Heat", "Righteous Kill", "The Irishman"]);
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

  test("people search pages through a stable ranking", async () => {
    const first = await searchNames(api.db, "person", "tom", { first: 5 });
    expect(first.rows).toHaveLength(5);
    expect(first.hasNextPage).toBe(true);
    const second = await searchNames(api.db, "person", "tom", { first: 5, after: first.endCursor });
    const firstIds = first.rows.map((person) => person.id);
    expect(second.rows.some((person) => firstIds.includes(person.id))).toBe(false);
  });
});

describe("name search", () => {
  const names = async (table: "person" | "studio", text: string, role?: "actor" | "director") =>
    (await searchNames(api.db, table, text, { role, first: 5 })).rows.map((row) => row.name);

  test("prefix matches every word and ranks the best match first", async () => {
    expect((await names("person", "nolan", "director"))[0]).toBe("Christopher Nolan");
    expect((await names("person", "tom h", "actor"))[0]).toBe("Tom Hanks");
    expect((await names("person", "kevin bacon", "actor"))[0]).toBe("Kevin Bacon");
  });

  test("role filters to people with credits in that role", async () => {
    const directors = await names("person", "chris", "director");
    const actors = await names("person", "chris", "actor");
    expect(directors).toContain("Christopher Nolan");
    expect(actors).not.toContain("Christopher Nolan");
    expect(actors).toContain("Christian Bale");
  });

  test("ignores case and accents", async () => {
    expect(foldName("Penélope CRUZ")).toBe("penelope cruz");
    expect((await names("person", "PENELOPE cruz"))[0]).toBe("Penélope Cruz");
  });

  test("studios rank by their films' notability", async () => {
    expect((await names("studio", "warner"))[0]).toBe("Warner Bros. Entertainment");
    expect((await names("studio", "para"))[0]).toBe("Paramount Pictures");
  });

  test("text with nothing searchable is a typed error", async () => {
    await expect(searchNames(api.db, "person", "  -- ")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("dataset completeness (regressions)", () => {
  const RDJ = 165219;
  const EVANS = 178348;

  test("Robert Downey Jr. and Chris Evans share every Avengers film, including Infinity War and Endgame", async () => {
    // These were missing when the pipeline only accepted English labels: Wikidata
    // now keeps many titles only as a language-neutral "mul" label.
    const titles = (await sharedFilms(api.db, RDJ, EVANS, "actor")).map((film) => film.title);
    for (const title of ["The Avengers", "Avengers: Age of Ultron", "Captain America: Civil War", "Avengers: Infinity War", "Avengers: Endgame"]) {
      expect(titles).toContain(title);
    }
  });

  test("casts are complete, not capped at ten", async () => {
    const { rows } = await api.pg.query<{ actors: number }>(
      `SELECT count(*)::int AS actors FROM credit c JOIN film f ON f.id = c.film_id
       WHERE f.title = 'Avengers: Endgame' AND c.role = 'actor'`,
    );
    expect(rows[0].actors).toBeGreaterThan(20);
  });

  test("films labelled only in Wikidata's 'mul' language are included", async () => {
    const { rows } = await api.pg.query<{ title: string }>(`SELECT title FROM film WHERE id = 192724`);
    expect(rows[0]?.title).toBe("Iron Man");
  });
});
