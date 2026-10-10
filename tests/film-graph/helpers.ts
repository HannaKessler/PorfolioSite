import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { Db, loadSeed, type SqlEvent } from "../../src/filmgraph/db/database";
import { createBackend } from "../../src/filmgraph/api/server";
import { PERSISTED_DOCUMENTS } from "../../src/filmgraph/operations";
import type { Seed } from "../../src/filmgraph/seed-format";
import { BATCHING_HEADER, GRAPHQL_URL, REST_BASE } from "../../src/filmgraph/config";

export const seed: Seed = JSON.parse(readFileSync(new URL("../../src/data/film-graph-seed.json", import.meta.url), "utf8"));

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
