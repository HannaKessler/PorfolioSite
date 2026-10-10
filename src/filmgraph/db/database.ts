import type { Seed, SeedPart } from "../seed-format";
import { ROLE_NAMES } from "../seed-format";
import { INDEX_SQL, SCHEMA_SQL } from "./schema";

/** The small slice of the PGlite API the app uses, so Node tests and the browser share code. */
export interface PgLike {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction?<T>(fn: (tx: PgLike) => Promise<T>): Promise<T>;
}

export interface SqlEvent {
  sql: string;
  params: unknown[];
  rows: number;
  /** Time from sending the query to getting rows, including any wait in PGlite's queue. */
  ms: number;
  /** performance.now() when the query was sent. */
  at: number;
}

/** Wall-clock time the database was busy, merging overlapping queries. */
export function busyMs(events: SqlEvent[]): number {
  const spans = events.map((event) => [event.at, event.at + event.ms]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of spans) {
    if (stop <= end) continue;
    total += stop - Math.max(start, end);
    end = stop;
  }
  return total;
}

/**
 * A thin query wrapper. Each API request gets its own traced copy so the
 * explorer can show exactly which SQL a request ran and how long it took.
 */
export class Db {
  constructor(
    private readonly pg: PgLike,
    private readonly trace?: SqlEvent[],
  ) {}

  withTrace(trace: SqlEvent[]): Db {
    return new Db(this.pg, trace);
  }

  async many<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const start = performance.now();
    const result = await this.pg.query<T>(sql, params);
    this.trace?.push({
      sql: sql.replace(/\s+/g, " ").trim(),
      params,
      rows: result.rows.length,
      ms: performance.now() - start,
      at: start,
    });
    return result.rows;
  }

  async one<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.many<T>(sql, params);
    return rows[0] ?? null;
  }
}

export async function isSeeded(pg: PgLike, version: string): Promise<boolean> {
  const table = await pg.query<{ exists: boolean }>(
    "SELECT to_regclass('public.meta') IS NOT NULL AS exists",
  );
  if (!table.rows[0]?.exists) return false;
  const row = await pg.query<{ value: string }>("SELECT value FROM meta WHERE key = 'seed'");
  return row.rows[0]?.value === version;
}

/** Drops everything and creates empty tables, ready for seed parts. */
export async function beginSeed(pg: PgLike): Promise<void> {
  await pg.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await pg.exec(SCHEMA_SQL);
}

/**
 * Loads whichever tables a seed part holds, one set-based INSERT per table
 * (the rows travel as a single JSON parameter). Parts must arrive in
 * dependency order: films and lookups, then people, then credits.
 */
export async function loadSeedPart(pg: PgLike, part: SeedPart, onProgress?: (step: string) => void): Promise<void> {
  const insert = async (label: string, sql: string, rows: unknown[] | undefined) => {
    if (!rows?.length) return;
    onProgress?.(`${label} (${rows.length.toLocaleString("en-US")})`);
    await pg.query(sql, [JSON.stringify(rows)]);
  };
  await insert(
    "films",
    `INSERT INTO film (id, title, year, runtime, country, description, popularity)
     SELECT (r->>0)::int, r->>1, (r->>2)::smallint, (r->>3)::smallint, r->>4, r->>5, (r->>6)::int
     FROM json_array_elements($1::json) AS r`,
    part.films,
  );
  await insert(
    "studios",
    `INSERT INTO studio (id, name) SELECT (r->>0)::int, r->>1 FROM json_array_elements($1::json) AS r`,
    part.studios,
  );
  await insert(
    "studio links",
    `INSERT INTO film_studio (film_id, studio_id)
     SELECT (r->>0)::int, (r->>1)::int FROM json_array_elements($1::json) AS r`,
    part.filmStudios,
  );
  await insert(
    "genres",
    `INSERT INTO genre (id, name) SELECT (r->>0)::int, r->>1 FROM json_array_elements($1::json) AS r`,
    part.genres,
  );
  await insert(
    "genre links",
    `INSERT INTO film_genre (film_id, genre_id)
     SELECT (r->>0)::int, (r->>1)::int FROM json_array_elements($1::json) AS r`,
    part.filmGenres,
  );
  await insert(
    "people",
    `INSERT INTO person (id, name, birth_year)
     SELECT (r->>0)::int, r->>1, (r->>2)::smallint FROM json_array_elements($1::json) AS r`,
    part.people,
  );
  await insert(
    "credits",
    `INSERT INTO credit (film_id, person_id, role, character, billing_order)
     SELECT (r->>0)::int, (r->>1)::int, (r->>2)::credit_role, r->>3, (r->>4)::smallint
     FROM json_array_elements($1::json) AS r`,
    part.credits?.map(([film, person, role, character, order]) => [film, person, ROLE_NAMES[role], character, order]),
  );
}

/** Builds the secondary indexes, refreshes statistics and records the seed version. */
export async function finishSeed(pg: PgLike, version: string, onProgress?: (step: string) => void): Promise<void> {
  onProgress?.("indexes and statistics");
  await pg.exec(INDEX_SQL);
  await pg.exec("ANALYZE;");
  await pg.query("INSERT INTO meta (key, value) VALUES ('seed', $1)", [version]);
}

/** Loads a whole seed held in memory (tests, scripts). */
export async function loadSeed(pg: PgLike, seed: Seed, version: string, onProgress?: (step: string) => void): Promise<void> {
  await beginSeed(pg);
  await loadSeedPart(pg, seed, onProgress);
  await finishSeed(pg, version, onProgress);
}
