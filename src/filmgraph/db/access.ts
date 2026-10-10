/**
 * Shared data-access layer. Both the GraphQL resolvers and the REST router
 * call these functions, so the two APIs read the same rows with the same SQL.
 */
import type { Db } from "./database";

export type Role = "actor" | "director" | "writer";
export type FilmOrder = "popularity" | "year" | "title";

export interface FilmRow {
  id: number;
  title: string;
  year: number;
  runtime: number | null;
  country: string | null;
  description: string | null;
  popularity: number;
  wikidataId: string;
}
export interface PersonRow {
  id: number;
  name: string;
  birthYear: number | null;
  wikidataId: string;
}
export interface CreditRow {
  filmId: number;
  personId: number;
  role: Role;
  character: string | null;
  billingOrder: number | null;
}
export interface NamedRow {
  id: number;
  name: string;
  wikidataId: string;
}
export interface LinkedNamedRow extends NamedRow {
  filmId: number;
}
export interface Page<T> {
  rows: T[];
  hasNextPage: boolean;
  endCursor: string | null;
  cursors: string[];
}
export interface FilmFilter {
  search?: string | null;
  genreId?: number | null;
  studioId?: number | null;
  yearFrom?: number | null;
  yearTo?: number | null;
}
export interface PathStep {
  fromId: number;
  filmId: number;
  toId: number;
}

export type ApiErrorCode = "BAD_USER_INPUT" | "NOT_FOUND";

/** Errors with a stable code. GraphQL puts it in extensions.code, REST maps it to a status. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get status() {
    return this.code === "NOT_FOUND" ? 404 : 400;
  }
}

export const MAX_PAGE = 100;
export const MAX_HOPS = 3;

const FILM_COLUMNS = `f.id, f.title, f.year, f.runtime, f.country, f.description, f.popularity, f.wikidata_id AS "wikidataId"`;
const PERSON_COLUMNS = `p.id, p.name, p.birth_year AS "birthYear", p.wikidata_id AS "wikidataId"`;
const CREDIT_COLUMNS = `c.film_id AS "filmId", c.person_id AS "personId", c.role::text AS role, c.character, c.billing_order AS "billingOrder"`;

// ---------- cursors ----------

const toBase64 = (text: string) =>
  btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64 = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"));

export function encodeCursor(values: (string | number)[]): string {
  return toBase64(JSON.stringify(values));
}

export function decodeCursor(cursor: string, shape: ("string" | "number")[]): (string | number)[] {
  try {
    const values = JSON.parse(fromBase64(cursor));
    if (
      Array.isArray(values) &&
      values.length === shape.length &&
      values.every((value, index) => typeof value === shape[index])
    ) {
      return values;
    }
  } catch {
    // fall through
  }
  throw new ApiError("BAD_USER_INPUT", "The cursor is not valid for this list.");
}

export function checkPageSize(first: number | null | undefined, fallback = 20): number {
  const size = first ?? fallback;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) {
    throw new ApiError("BAD_USER_INPUT", `Page size must be between 1 and ${MAX_PAGE}.`);
  }
  return size;
}

/** Builds a prefix tsquery ("star war" -> "star:* & war:*") from free text, safely. */
export function toPrefixQuery(text: string): string | null {
  const words = text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((word) => `${word}:*`).join(" & ") : null;
}

// ---------- lookups by id (DataLoader batch functions call these) ----------

export function filmsByIds(db: Db, ids: readonly number[]) {
  return db.many<FilmRow>(`SELECT ${FILM_COLUMNS} FROM film f WHERE f.id = ANY($1::int[])`, [ids]);
}

export function peopleByIds(db: Db, ids: readonly number[]) {
  return db.many<PersonRow>(`SELECT ${PERSON_COLUMNS} FROM person p WHERE p.id = ANY($1::int[])`, [ids]);
}

export function studiosByIds(db: Db, ids: readonly number[]) {
  return db.many<NamedRow>(
    `SELECT s.id, s.name, s.wikidata_id AS "wikidataId" FROM studio s WHERE s.id = ANY($1::int[])`,
    [ids],
  );
}

export function genresByIds(db: Db, ids: readonly number[]) {
  return db.many<NamedRow>(
    `SELECT g.id, g.name, g.wikidata_id AS "wikidataId" FROM genre g WHERE g.id = ANY($1::int[])`,
    [ids],
  );
}

/** Credits for many films, cast in billing order first, then directors and writers. */
export function creditsByFilmIds(db: Db, ids: readonly number[]) {
  return db.many<CreditRow>(
    `SELECT ${CREDIT_COLUMNS} FROM credit c
     WHERE c.film_id = ANY($1::int[])
     ORDER BY c.film_id, c.role, c.billing_order NULLS LAST, c.person_id`,
    [ids],
  );
}

/** Credits for many people, oldest film first. */
export function creditsByPersonIds(db: Db, ids: readonly number[]) {
  return db.many<CreditRow>(
    `SELECT ${CREDIT_COLUMNS} FROM credit c JOIN film f ON f.id = c.film_id
     WHERE c.person_id = ANY($1::int[])
     ORDER BY c.person_id, f.year, f.id, c.role`,
    [ids],
  );
}

export function genresByFilmIds(db: Db, ids: readonly number[]) {
  return db.many<LinkedNamedRow>(
    `SELECT fg.film_id AS "filmId", g.id, g.name, g.wikidata_id AS "wikidataId"
     FROM film_genre fg JOIN genre g ON g.id = fg.genre_id
     WHERE fg.film_id = ANY($1::int[]) ORDER BY fg.film_id, g.name`,
    [ids],
  );
}

export function studiosByFilmIds(db: Db, ids: readonly number[]) {
  return db.many<LinkedNamedRow>(
    `SELECT fs.film_id AS "filmId", s.id, s.name, s.wikidata_id AS "wikidataId"
     FROM film_studio fs JOIN studio s ON s.id = fs.studio_id
     WHERE fs.film_id = ANY($1::int[]) ORDER BY fs.film_id, s.name`,
    [ids],
  );
}

// ---------- lists ----------

function filmWhere(filter: FilmFilter, params: unknown[]): string[] {
  const where: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (filter.search != null) {
    const query = toPrefixQuery(filter.search);
    if (!query) throw new ApiError("BAD_USER_INPUT", "Search needs at least one letter or number.");
    where.push(`to_tsvector('simple', f.title) @@ to_tsquery('simple', ${add(query)})`);
  }
  if (filter.genreId != null) {
    where.push(`EXISTS (SELECT 1 FROM film_genre fg WHERE fg.film_id = f.id AND fg.genre_id = ${add(filter.genreId)})`);
  }
  if (filter.studioId != null) {
    where.push(`EXISTS (SELECT 1 FROM film_studio fs WHERE fs.film_id = f.id AND fs.studio_id = ${add(filter.studioId)})`);
  }
  for (const [key, op] of [["yearFrom", ">="], ["yearTo", "<="]] as const) {
    const year = filter[key];
    if (year == null) continue;
    if (!Number.isInteger(year) || year < 1800 || year > 2100) {
      throw new ApiError("BAD_USER_INPUT", `${key} must be a year between 1800 and 2100.`);
    }
    where.push(`f.year ${op} ${add(year)}`);
  }
  if (filter.yearFrom != null && filter.yearTo != null && filter.yearFrom > filter.yearTo) {
    throw new ApiError("BAD_USER_INPUT", "yearFrom must not be after yearTo.");
  }
  return where;
}

const FILM_ORDERS: Record<FilmOrder, { sql: string; key: (f: FilmRow) => (string | number)[]; shape: ("string" | "number")[]; after: (a: string, b: string) => string }> = {
  popularity: {
    sql: "f.popularity DESC, f.id ASC",
    key: (f) => [f.popularity, f.id],
    shape: ["number", "number"],
    after: (a, b) => `(f.popularity < ${a} OR (f.popularity = ${a} AND f.id > ${b}))`,
  },
  year: {
    sql: "f.year ASC, f.id ASC",
    key: (f) => [f.year, f.id],
    shape: ["number", "number"],
    after: (a, b) => `(f.year, f.id) > (${a}, ${b})`,
  },
  title: {
    sql: "f.title ASC, f.id ASC",
    key: (f) => [f.title, f.id],
    shape: ["string", "number"],
    after: (a, b) => `(f.title, f.id) > (${a}::text, ${b})`,
  },
};

/** Keyset (cursor) pagination over films with optional filters. */
export async function listFilms(
  db: Db,
  filter: FilmFilter,
  options: { first?: number | null; after?: string | null; orderBy?: FilmOrder } = {},
): Promise<Page<FilmRow>> {
  const size = checkPageSize(options.first);
  const order = FILM_ORDERS[options.orderBy ?? "popularity"];
  const params: unknown[] = [];
  const where = filmWhere(filter, params);
  if (options.after) {
    const [a, b] = decodeCursor(options.after, order.shape);
    params.push(a, b);
    where.push(order.after(`$${params.length - 1}`, `$${params.length}`));
  }
  params.push(size + 1);
  const rows = await db.many<FilmRow>(
    `SELECT ${FILM_COLUMNS} FROM film f
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${order.sql} LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, size);
  const cursors = page.map((film) => encodeCursor(order.key(film)));
  return { rows: page, hasNextPage: rows.length > size, endCursor: cursors.at(-1) ?? null, cursors };
}

export async function countFilms(db: Db, filter: FilmFilter): Promise<number> {
  const params: unknown[] = [];
  const where = filmWhere(filter, params);
  const row = await db.one<{ count: number }>(
    `SELECT count(*)::int AS count FROM film f ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`,
    params,
  );
  return row?.count ?? 0;
}

/** Name search over people or studios, ordered by name with a keyset cursor. */
export async function searchNamed<T extends "person" | "studio">(
  db: Db,
  table: T,
  search: string,
  options: { first?: number | null; after?: string | null } = {},
): Promise<Page<T extends "person" ? PersonRow : NamedRow>> {
  const size = checkPageSize(options.first, 10);
  const query = toPrefixQuery(search);
  if (!query) throw new ApiError("BAD_USER_INPUT", "Search needs at least one letter or number.");
  const params: unknown[] = [query];
  let after = "";
  if (options.after) {
    const [name, id] = decodeCursor(options.after, ["string", "number"]);
    params.push(name, id);
    after = `AND (t.name, t.id) > ($2::text, $3)`;
  }
  params.push(size + 1);
  const columns =
    table === "person"
      ? `t.id, t.name, t.birth_year AS "birthYear", t.wikidata_id AS "wikidataId"`
      : `t.id, t.name, t.wikidata_id AS "wikidataId"`;
  const rows = await db.many<PersonRow & NamedRow>(
    `SELECT ${columns} FROM ${table} t
     WHERE to_tsvector('simple', t.name) @@ to_tsquery('simple', $1) ${after}
     ORDER BY t.name, t.id LIMIT $${params.length}`,
    params,
  );
  const page = rows.slice(0, size);
  const cursors = page.map((row) => encodeCursor([row.name, row.id]));
  return {
    rows: page as never,
    hasNextPage: rows.length > size,
    endCursor: cursors.at(-1) ?? null,
    cursors,
  };
}

export function allGenres(db: Db) {
  return db.many<NamedRow & { filmCount: number }>(
    `SELECT g.id, g.name, g.wikidata_id AS "wikidataId", count(fg.film_id)::int AS "filmCount"
     FROM genre g LEFT JOIN film_genre fg ON fg.genre_id = g.id
     GROUP BY g.id ORDER BY g.name`,
  );
}

// ---------- purpose-built queries ----------

/** Films both people are credited on (any role unless one is given), oldest first. */
export function sharedFilms(db: Db, personA: number, personB: number, role: Role | null = "actor") {
  return db.many<FilmRow>(
    `SELECT ${FILM_COLUMNS} FROM film f
     WHERE f.id IN (
       SELECT film_id FROM credit WHERE person_id = $1 AND ($3::credit_role IS NULL OR role = $3::credit_role)
       INTERSECT
       SELECT film_id FROM credit WHERE person_id = $2 AND ($3::credit_role IS NULL OR role = $3::credit_role)
     )
     ORDER BY f.year, f.id`,
    [personA, personB, role],
  );
}

export interface GenreDecadeCount {
  decade: number;
  genreId: number;
  genreName: string;
  count: number;
}

/** How many of a studio's films fall in each genre, per decade. */
export function studioGenreBreakdown(db: Db, studioId: number) {
  return db.many<GenreDecadeCount>(
    `SELECT (f.year / 10) * 10 AS decade, g.id AS "genreId", g.name AS "genreName", count(*)::int AS count
     FROM film_studio fs
     JOIN film f ON f.id = fs.film_id
     JOIN film_genre fg ON fg.film_id = f.id
     JOIN genre g ON g.id = fg.genre_id
     WHERE fs.studio_id = $1
     GROUP BY 1, g.id, g.name
     ORDER BY 1, count DESC, g.name COLLATE "C"`,
    [studioId],
  );
}

export function studioFilmCount(db: Db, studioId: number) {
  return db
    .one<{ count: number }>(`SELECT count(*)::int AS count FROM film_studio WHERE studio_id = $1`, [studioId])
    .then((row) => row?.count ?? 0);
}

/**
 * Shortest chain of co-starring actors between two people, at most maxHops
 * films long. Bidirectional breadth-first search: each hop is one SQL query
 * that expands the smaller frontier, so the worst case is maxHops queries.
 * When several films link the same pair, the most notable film wins.
 */
export async function actorPath(db: Db, fromId: number, toId: number, maxHops = MAX_HOPS): Promise<PathStep[] | null> {
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_HOPS) {
    throw new ApiError("BAD_USER_INPUT", `maxHops must be between 1 and ${MAX_HOPS}.`);
  }
  if (fromId === toId) return [];

  type Parent = { via: number; filmId: number } | null;
  const sides = [
    { parents: new Map<number, Parent>([[fromId, null]]), frontier: [fromId] },
    { parents: new Map<number, Parent>([[toId, null]]), frontier: [toId] },
  ];

  for (let hop = 0; hop < maxHops; hop += 1) {
    const index = sides[0].frontier.length <= sides[1].frontier.length ? 0 : 1;
    const side = sides[index];
    const other = sides[1 - index];
    if (side.frontier.length === 0) return null;
    const rows = await db.many<{ src: number; dst: number; filmId: number }>(
      `SELECT DISTINCT ON (c2.person_id) c1.person_id AS src, c2.person_id AS dst, c1.film_id AS "filmId"
       FROM credit c1
       JOIN credit c2 ON c2.film_id = c1.film_id AND c2.role = 'actor' AND c2.person_id <> c1.person_id
       JOIN film f ON f.id = c1.film_id
       WHERE c1.role = 'actor' AND c1.person_id = ANY($1::int[]) AND NOT (c2.person_id = ANY($2::int[]))
       ORDER BY c2.person_id, f.popularity DESC, f.id`,
      [side.frontier, [...side.parents.keys()]],
    );
    const next: number[] = [];
    let meet: number | null = null;
    for (const row of rows) {
      side.parents.set(row.dst, { via: row.src, filmId: row.filmId });
      next.push(row.dst);
      if (meet === null && other.parents.has(row.dst)) meet = row.dst;
    }
    side.frontier = next;
    if (meet !== null) {
      const walk = (parents: Map<number, Parent>, start: number) => {
        const steps: PathStep[] = [];
        let current = start;
        let parent = parents.get(current);
        while (parent) {
          steps.push({ fromId: parent.via, filmId: parent.filmId, toId: current });
          current = parent.via;
          parent = parents.get(current);
        }
        return steps;
      };
      const fromSide = walk(sides[0].parents, meet).reverse();
      const toSide = walk(sides[1].parents, meet).map((step) => ({
        fromId: step.toId,
        filmId: step.filmId,
        toId: step.fromId,
      }));
      return [...fromSide, ...toSide];
    }
  }
  return null;
}

/** Groups rows by a key, keeping every key requested (empty arrays for misses). */
export function groupBy<T, K>(keys: readonly K[], rows: T[], keyOf: (row: T) => K): T[][] {
  const map = new Map<K, T[]>(keys.map((key) => [key, []]));
  for (const row of rows) map.get(keyOf(row))?.push(row);
  return keys.map((key) => map.get(key) ?? []);
}

export function byId<T extends { id: number }>(keys: readonly number[], rows: T[]): (T | null)[] {
  const map = new Map(rows.map((row) => [row.id, row]));
  return keys.map((key) => map.get(key) ?? null);
}
