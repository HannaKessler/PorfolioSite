import { createBackend, type Backend } from "../server";
import { ProfileStore, type PersistedProfile } from "../store";
import type { WorkerInbound, WorkerOutbound, WireRequest, WireResponse } from "../protocol";

const DB_NAME = "catalog-profile";
const STORE_NAME = "state";
const STATE_KEY = "profile";

interface WorkerScope {
  postMessage(message: WorkerOutbound): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerInbound>) => void): void;
}
const scope = self as unknown as WorkerScope;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadState(): Promise<PersistedProfile | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve((request.result as PersistedProfile) ?? null);
      request.onerror = () => resolve(null);
    }).finally(() => db.close());
  } catch {
    return null;
  }
}

async function saveState(data: PersistedProfile) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(data, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Persistence is best-effort; the in-memory store still works for this page.
  }
}

const store = new ProfileStore();
let backend: Backend | null = null;

const ready = (async () => {
  const saved = await loadState();
  if (saved) store.restore(saved);
  backend = await createBackend(store);
  scope.postMessage({ type: "ready" });
  return backend;
})().catch((error: Error) => {
  scope.postMessage({ type: "error", detail: error.message });
  throw error;
});

async function handle(wire: WireRequest, port: MessagePort) {
  let reply: WireResponse;
  try {
    const server = await ready;
    const request = new Request(wire.url, {
      method: wire.method,
      headers: wire.headers,
      body: wire.body && wire.method !== "GET" && wire.method !== "HEAD" ? wire.body : undefined,
    });
    const { response } = await server.handle(request);
    const body = response.body ? await response.arrayBuffer() : null;
    reply = { status: response.status, statusText: response.statusText, headers: [...response.headers], body };
    await saveState(store.snapshot());
  } catch (error) {
    const body = new TextEncoder().encode(JSON.stringify({ errors: [{ message: (error as Error).message }] })).buffer as ArrayBuffer;
    reply = { status: 503, statusText: "Service Unavailable", headers: [["content-type", "application/json"]], body };
  }
  port.postMessage(reply, reply.body ? [reply.body] : []);
}

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "request" && event.ports[0]) void handle(message.request, event.ports[0]);
});
