/**
 * The "backend": takes a real Fetch API Request and returns a real Response.
 * In the browser it runs in a dedicated worker behind the service worker; in
 * tests it runs directly in Node. Nothing here knows which.
 */
import { Db, busyMs, type PgLike, type SqlEvent } from "../db/database";
import { createGraphQL } from "./graphql";
import { createRest } from "./rest";
import { API_BASE, BATCHING_HEADER } from "../config";
import { sha256Hex } from "../hash";

export interface RequestTrace {
  requestId: string;
  method: string;
  url: string;
  status: number;
  sql: SqlEvent[];
  dbMs: number;
  serverMs: number;
  batching: boolean;
  persisted: boolean;
}

export interface Backend {
  handle(request: Request): Promise<{ response: Response; trace: RequestTrace }>;
}

const encoder = new TextEncoder();

async function etagFor(body: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", body as BufferSource));
  const hex = [...digest.slice(0, 10)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `"${hex}"`;
}

/** If-None-Match can list several tags or *; weak tags compare equal for GET. */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag);
}

let counter = 0;
const nextId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;


export async function createBackend(pg: PgLike, persistedDocuments: string[]): Promise<Backend> {
  const db = new Db(pg);
  const persisted = new Map<string, string>();
  for (const document of persistedDocuments) persisted.set(await sha256Hex(document), document);
  const graphqlPath = `${API_BASE}/graphql`;
  const restBase = `${API_BASE}/rest`;
  const yoga = createGraphQL({ db, endpoint: graphqlPath, persisted });
  const rest = createRest(restBase);

  return {
    async handle(request) {
      const start = performance.now();
      const url = new URL(request.url);
      const trace: SqlEvent[] = [];
      const batching = request.headers.get(BATCHING_HEADER) !== "off";
      const requestId = nextId();
      let response: Response;

      let persistedRequest = false;
      if (url.pathname === graphqlPath) {
        if (request.method === "POST") {
          try {
            const params = JSON.parse(await request.clone().text());
            persistedRequest = !params.query && !!params.extensions?.persistedQuery;
          } catch {
            // Yoga reports the malformed body.
          }
        }
        const result = await yoga.fetch(request, { trace, batching });
        const body = new Uint8Array(await result.arrayBuffer());
        const headers = new Headers(result.headers);
        headers.set("Content-Length", String(body.byteLength));
        headers.set("Cache-Control", "no-store");
        response = new Response(body, { status: result.status, headers });
      } else if (url.pathname === restBase || url.pathname.startsWith(`${restBase}/`)) {
        const path = url.pathname.slice(restBase.length) || "/";
        const result = await rest.handle(db.withTrace(trace), request.method, path, url.searchParams);
        const body = encoder.encode(JSON.stringify(result.body));
        const headers = new Headers({
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        if ("allow" in result && result.allow) headers.set("Allow", result.allow);
        if (result.status === 200) {
          const etag = await etagFor(body);
          headers.set("ETag", etag);
          if (matchesEtag(request.headers.get("If-None-Match"), etag)) {
            response = new Response(null, { status: 304, headers });
          } else {
            headers.set("Content-Length", String(body.byteLength));
            response = new Response(request.method === "HEAD" ? null : body, { status: 200, headers });
          }
        } else {
          headers.set("Content-Length", String(body.byteLength));
          response = new Response(body, { status: result.status, headers });
        }
      } else {
        const body = encoder.encode(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unknown API path." } }));
        response = new Response(body, {
          status: 404,
          headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(body.byteLength) },
        });
      }

      const dbMs = busyMs(trace);
      const serverMs = performance.now() - start;
      response.headers.set("X-Request-Id", requestId);
      response.headers.set("X-DB-Queries", String(trace.length));
      response.headers.set("Server-Timing", `db;dur=${dbMs.toFixed(1)};desc="${trace.length} queries", app;dur=${serverMs.toFixed(1)}`);
      response.headers.set("Access-Control-Expose-Headers", "ETag, X-Request-Id, X-DB-Queries, Server-Timing");

      return {
        response,
        trace: {
          requestId,
          method: request.method,
          url: url.pathname + url.search,
          status: response.status,
          sql: trace,
          dbMs,
          serverMs,
          batching,
          persisted: persistedRequest,
        },
      };
    },
  };
}
