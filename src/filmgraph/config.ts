/** Paths and header names shared by the page, the service worker and the backend. */
export const DEMO_PATH = "/projects/film-graph";
export const API_BASE = `${DEMO_PATH}/api`;
export const GRAPHQL_URL = `${API_BASE}/graphql`;
export const REST_BASE = `${API_BASE}/rest`;
/** The service worker script lives in /projects/ so its scope can be "/projects/film-graph". */
export const SW_URL = "/projects/film-graph-sw.js";
export const SW_SCOPE = DEMO_PATH;
export const BATCHING_HEADER = "x-filmgraph-batching";
export const PERSISTED_ONLY_HEADER = "x-filmgraph-persisted-only";
