/**
 * Explorer-side API client. Measures every request (bytes, time, database
 * queries from the X-DB-Queries header) and keeps an ETag cache for REST so
 * repeat GETs send If-None-Match and get a 304 with an empty body.
 */
import { BATCHING_HEADER, GRAPHQL_URL, PERSISTED_ONLY_HEADER, REST_BASE } from "../config";
import type { SqlEvent } from "../db/database";
import { sha256Hex } from "../hash";
import type { Connection } from "./connection";

export type CacheStatus = "miss" | "revalidated" | "no-store";

export interface LogEntry {
  id: number;
  api: "GraphQL" | "REST";
  method: string;
  url: string;
  status: number;
  cache: CacheStatus;
  persisted: boolean;
  requestBytes: number;
  responseBytes: number;
  ms: number;
  dbQueries: number;
  sql: SqlEvent[];
  /** performance.now() when the request started, for the timeline. */
  startedAt: number;
}

export interface GraphQLOptions {
  batching: boolean;
  persisted: boolean;
  persistedOnly: boolean;
}

export interface GraphQLResult {
  status: number;
  body: { data?: unknown; errors?: { message: string; extensions?: { code?: string } }[] } | null;
  entry: LogEntry;
  /** Request body bytes if the full query text had been sent. */
  fullQueryBytes: number;
}

export interface RestResult {
  status: number;
  body: unknown;
  entry: LogEntry;
}

const encoder = new TextEncoder();

export function createApi(connection: Connection, onLog: (entry: LogEntry) => void) {
  let nextId = 1;
  const etags = new Map<string, { etag: string; body: unknown; bytes: number }>();

  async function finish(
    response: Response,
    partial: Omit<LogEntry, "id" | "status" | "responseBytes" | "ms" | "dbQueries" | "sql">,
    bodyBytes: number,
  ): Promise<LogEntry> {
    const trace = await connection.trace(response.headers.get("x-request-id"));
    const entry: LogEntry = {
      ...partial,
      id: nextId++,
      status: response.status,
      responseBytes: bodyBytes,
      ms: performance.now() - partial.startedAt,
      dbQueries: Number(response.headers.get("x-db-queries") ?? trace?.sql.length ?? 0),
      sql: trace?.sql ?? [],
      persisted: partial.persisted || !!trace?.persisted,
    };
    onLog(entry);
    return entry;
  }

  async function graphql(
    query: string,
    variables: Record<string, unknown>,
    options: GraphQLOptions,
  ): Promise<GraphQLResult> {
    const full = JSON.stringify({ query, variables });
    const payload = options.persisted
      ? JSON.stringify({
          variables,
          extensions: { persistedQuery: { version: 1, sha256Hash: await sha256Hex(query) } },
        })
      : full;
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (!options.batching) headers[BATCHING_HEADER] = "off";
    if (options.persistedOnly) headers[PERSISTED_ONLY_HEADER] = "on";
    const startedAt = performance.now();
    const response = await connection.fetch(GRAPHQL_URL, { method: "POST", headers, body: payload });
    const buffer = await response.arrayBuffer();
    const entry = await finish(
      response,
      {
        api: "GraphQL",
        method: "POST",
        url: GRAPHQL_URL,
        cache: "no-store",
        persisted: options.persisted,
        requestBytes: encoder.encode(payload).byteLength,
        startedAt,
      },
      buffer.byteLength,
    );
    let body: GraphQLResult["body"] = null;
    try {
      body = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      body = { errors: [{ message: `HTTP ${response.status} with a non-JSON body` }] };
    }
    return { status: response.status, body, entry, fullQueryBytes: encoder.encode(full).byteLength };
  }

  /** GET a REST path (relative to the REST base). Uses If-None-Match when useEtags is on. */
  async function rest(path: string, useEtags: boolean): Promise<RestResult> {
    const url = `${REST_BASE}${path}`;
    const cached = useEtags ? etags.get(url) : undefined;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cached) headers["If-None-Match"] = cached.etag;
    const startedAt = performance.now();
    const response = await connection.fetch(url, { headers });
    const buffer = await response.arrayBuffer();
    let body: unknown;
    if (response.status === 304 && cached) {
      body = cached.body;
    } else {
      body = buffer.byteLength ? JSON.parse(new TextDecoder().decode(buffer)) : null;
      const etag = response.headers.get("etag");
      if (useEtags && etag && response.ok) etags.set(url, { etag, body, bytes: buffer.byteLength });
    }
    const entry = await finish(
      response,
      {
        api: "REST",
        method: "GET",
        url,
        cache: response.status === 304 ? "revalidated" : "miss",
        persisted: false,
        requestBytes: 0,
        startedAt,
      },
      buffer.byteLength,
    );
    return { status: response.status, body, entry };
  }

  return { graphql, rest, clearEtags: () => etags.clear() };
}

export type Api = ReturnType<typeof createApi>;
