/*
 * Film Data Query service worker.
 *
 * Scope is /projects/film-graph, and it only answers requests under
 * /projects/film-graph/api/. Every other request (including the rest of the
 * portfolio) goes to the network untouched. API requests are forwarded to the
 * page that made them, which hands them to the dedicated worker running
 * PGlite, GraphQL Yoga and the REST router. The reply comes straight back here
 * on a MessageChannel and becomes a real Response, so DevTools shows normal
 * HTTP traffic with status codes and headers.
 */
const API_PREFIX = "/projects/film-graph/api/";
const TIMEOUT_MS = 60000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(API_PREFIX)) return;
  event.respondWith(forward(event));
});

function errorResponse(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function forward(event) {
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  if (!client) {
    return errorResponse(503, "NO_CLIENT", "The Film Data Query API runs inside the demo page. Open the page to use it.");
  }
  const request = event.request;
  const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
  const channel = new MessageChannel();
  const reply = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    channel.port1.onmessage = (message) => {
      clearTimeout(timer);
      resolve(message.data);
    };
  });
  client.postMessage(
    {
      type: "filmgraph:request",
      request: { url: request.url, method: request.method, headers: [...request.headers], body },
    },
    body ? [channel.port2, body] : [channel.port2],
  );
  try {
    const result = await reply;
    const nullBody = result.status === 204 || result.status === 304 || request.method === "HEAD";
    return new Response(nullBody ? null : result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  } catch {
    return errorResponse(504, "BACKEND_TIMEOUT", "The in-browser backend did not answer in time.");
  }
}
