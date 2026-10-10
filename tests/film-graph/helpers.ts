import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Db, loadSeed, type SqlEvent } from "../../src/filmgraph/db/database";
import { createBackend } from "../../src/filmgraph/api/server";
import { PERSISTED_DOCUMENTS } from "../../src/filmgraph/operations";
import type { Seed, SeedManifest, SeedPart } from "../../src/filmgraph/seed-format";
import { BATCHING_HEADER, GRAPHQL_URL, REST_BASE } from "../../src/filmgraph/config";

const dataDir = new URL("../../src/data/film-graph/", import.meta.url);
export const manifest: SeedManifest = JSON.parse(readFileSync(new URL("manifest.json", dataDir), "utf8"));

/** The whole seed, reassembled from its parts exactly as the browser loads them. */
export const seed: Seed = (() => {
  const whole: Seed = {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    source: manifest.source,
    films: [],
    people: [],
    credits: [],
    studios: [],
    filmStudios: [],
    genres: [],
    filmGenres: [],
  };
  for (const { file } of manifest.parts) {
    const part: SeedPart = JSON.parse(readFileSync(new URL(file, dataDir), "utf8"));
    for (const key of Object.keys(part) as (keyof SeedPart)[]) (whole[key] as unknown[]).push(...(part[key] as unknown[]));
  }
  return whole;
})();

const ORIGIN = "http://localhost";

/** One in-memory Postgres per test file, seeded exactly like the browser does it. */
export async function setup() {
  const pg = await PGlite.create();
  await loadSeed(pg, seed, "test");
  const backend = await createBackend(pg, PERSISTED_DOCUMENTS);
  const trace: SqlEvent[] = [];
  const db = new Db(pg).withTrace(trace);

  async function graphql(query: string, variables: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    const { response, trace: requestTrace } = await backend.handle(
      new Request(`${ORIGIN}${GRAPHQL_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ query, variables }),
      }),
    );
    return { status: response.status, headers: response.headers, body: (await response.json()) as any, trace: requestTrace };
  }

  async function graphqlRaw(body: unknown, headers: Record<string, string> = {}) {
    const { response, trace: requestTrace } = await backend.handle(
      new Request(`${ORIGIN}${GRAPHQL_URL}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, body: (await response.json()) as any, trace: requestTrace };
  }

  async function rest(path: string, headers: Record<string, string> = {}, method = "GET") {
    const { response, trace: requestTrace } = await backend.handle(
      new Request(`${ORIGIN}${REST_BASE}${path}`, { method, headers }),
    );
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, trace: requestTrace };
  }

  /** A fetch-like function over the backend, for the explorer's REST plans. */
  async function restFetch(path: string) {
    const result = await rest(path);
    if (result.status !== 200) throw new Error(`${path}: HTTP ${result.status}`);
    return result.body;
  }

  return { pg, db, trace, backend, graphql, graphqlRaw, rest, restFetch, batchingOff: { [BATCHING_HEADER]: "off" } };
}

export type TestApi = Awaited<ReturnType<typeof setup>>;
