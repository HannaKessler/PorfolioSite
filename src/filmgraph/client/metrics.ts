import type { LogEntry } from "./api";

export interface RunMetrics {
  api: "GraphQL" | "REST";
  requests: number;
  /** Request bodies sent (GraphQL POST bodies; REST GETs have none). */
  requestBytes: number;
  /** Response bodies received over the wire (a 304 has no body). */
  responseBytes: number;
  dbQueries: number;
  /** Wall-clock time for the whole run, including client-side work. */
  ms: number;
  /** Responses answered with 304 Not Modified. */
  revalidated: number;
  /** JSON size of every response payload the client had to handle (including ETag-cached ones). */
  payloadBytes: number;
  /** JSON size of the data the view actually needs. */
  usefulBytes: number;
  fieldsReceived: number;
  fieldsUsed: number;
}

const encoder = new TextEncoder();
export const jsonBytes = (value: unknown) => (value === undefined ? 0 : encoder.encode(JSON.stringify(value)).byteLength);

/** Counts leaf values (strings, numbers, booleans, nulls) in a JSON value. */
export function countLeaves(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + countLeaves(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum: number, item) => sum + countLeaves(item), 0);
  }
  return 1;
}

export function summarize(
  api: "GraphQL" | "REST",
  entries: LogEntry[],
  payloads: unknown[],
  data: unknown,
  ms: number,
): RunMetrics {
  return {
    api,
    requests: entries.length,
    requestBytes: entries.reduce((sum, entry) => sum + entry.requestBytes, 0),
    responseBytes: entries.reduce((sum, entry) => sum + entry.responseBytes, 0),
    dbQueries: entries.reduce((sum, entry) => sum + entry.dbQueries, 0),
    ms,
    revalidated: entries.filter((entry) => entry.cache === "revalidated").length,
    payloadBytes: payloads.reduce((sum: number, payload) => sum + jsonBytes(payload), 0),
    usefulBytes: jsonBytes(data),
    fieldsReceived: payloads.reduce((sum: number, payload) => sum + countLeaves(payload), 0),
    fieldsUsed: data === undefined ? 0 : countLeaves(data),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export const formatCount = (value: number) => value.toLocaleString("en-US");
