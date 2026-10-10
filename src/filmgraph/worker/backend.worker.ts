/**
 * Dedicated worker that hosts the whole backend: PGlite (Postgres in WASM,
 * with a snapshot persisted to IndexedDB), GraphQL Yoga and the REST router.
 *
 * Why not inside the service worker? Browsers stop idle service workers after
 * about 30 seconds, which would mean re-initialising Postgres from IndexedDB on
 * almost every visit, and module service workers cannot lazy-load code. A
 * dedicated worker lives as long as the page, keeps Postgres warm in memory and
 * keeps all the heavy code off every other page of the site.
 */
import { PGlite } from "@electric-sql/pglite";
import manifest from "../../data/film-graph/manifest.json";
import { SCHEMA_VERSION } from "../db/schema";
import { beginSeed, finishSeed, isSeeded, loadSeedPart } from "../db/database";
import { createBackend, type Backend } from "../api/server";
import { PERSISTED_DOCUMENTS } from "../operations";
import type { SeedManifest, SeedPart } from "../seed-format";

// Hashed URLs of the seed parts (emitted as static assets at build time).
const partUrls = import.meta.glob("../../data/film-graph/part-*.json", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;
const seedManifest = manifest as SeedManifest;
import type { BootStatus, WireRequest, WireResponse, WorkerInbound, WorkerOutbound } from "../protocol";

interface WorkerScope {
  postMessage(message: WorkerOutbound, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerInbound>) => void): void;
}
const scope = self as unknown as WorkerScope;

const SNAPSHOT_DB = "film-graph";
const SNAPSHOT_STORE = "snapshots";
const started = performance.now();
const status = (value: Omit<BootStatus, "elapsedMs">) =>
  scope.postMessage({ type: "status", status: { ...value, elapsedMs: performance.now() - started } });

/*
 * Persistence: Postgres runs fully in memory (fast: no file system sync after
 * every query). After the first seed, the worker saves a gzipped snapshot of
 * the Postgres data directory to IndexedDB; later visits start Postgres from
 * that snapshot instead of downloading and loading the seed again.
 */
function openSnapshots(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SNAPSHOT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readSnapshot(key: string): Promise<Blob | null> {
  try {
    const db = await openSnapshots();
    return await new Promise((resolve) => {
      const request = db.transaction(SNAPSHOT_STORE).objectStore(SNAPSHOT_STORE).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => resolve(null);
    }).finally(() => db.close()) as Blob | null;
  } catch {
    return null;
  }
}

async function writeSnapshot(key: string, blob: Blob): Promise<void> {
  const db = await openSnapshots();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, "readwrite");
    const store = tx.objectStore(SNAPSHOT_STORE);
    store.clear(); // keep only the snapshot for the current seed
    store.put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

let pg: PGlite | null = null;

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/** Downloads one part, reporting bytes as they stream in. */
async function download(url: string, onBytes: (bytes: number) => void): Promise<SeedPart> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Seed download failed (HTTP ${response.status})`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    onBytes(value.byteLength);
  }
  return JSON.parse(await new Blob(chunks as BlobPart[]).text()) as SeedPart;
}

/**
 * Downloads the seed parts in order and loads each one as soon as it arrives,
 * while the next one downloads. Returns the total bytes downloaded.
 */
async function seedFromParts(db: PGlite, seedKey: string): Promise<number> {
  const parts = seedManifest.parts;
  const total = parts.reduce((sum, part) => sum + part.bytes, 0);
  let received = 0;
  let loaded = 0;
  const report = (phase: "download" | "seed", detail: string) =>
    status({ phase, detail, progress: (received / total + loaded / parts.length) / 2 });
  const urlOf = (file: string) => {
    const url = partUrls[`../../data/film-graph/${file}`];
    if (!url) throw new Error(`Seed part ${file} is missing from the build`);
    return url;
  };
  const fetchPart = (index: number) =>
    download(urlOf(parts[index].file), (bytes) => {
      received += bytes;
      report("download", `Downloading film data: ${mb(received)} of ${mb(total)}`);
    });

  await beginSeed(db);
  let pending = fetchPart(0);
  for (let index = 0; index < parts.length; index += 1) {
    const part = await pending;
    if (index + 1 < parts.length) pending = fetchPart(index + 1);
    await loadSeedPart(db, part, (step) => report("seed", `Loading ${step}, part ${index + 1} of ${parts.length}`));
    loaded += 1;
  }
  await finishSeed(db, seedKey, (step) => status({ phase: "seed", detail: `Building ${step}`, progress: 0.98 }));
  return received;
}

async function boot(): Promise<Backend> {
  // A new seed (generatedAt) or schema version rebuilds any saved copy.
  const seedKey = `${seedManifest.generatedAt}#seed${seedManifest.version}#schema${SCHEMA_VERSION}`;
  status({ phase: "engine", detail: "Starting Postgres (WASM)" });
  const snapshot = await readSnapshot(seedKey);
  let seeded = false;
  let seedBytes: number | undefined;
  if (snapshot) {
    try {
      pg = await PGlite.create({ loadDataDir: snapshot });
      if (!(await isSeeded(pg, seedKey))) throw new Error("stale snapshot");
    } catch {
      await pg?.close().catch(() => undefined);
      pg = null;
    }
  }
  if (!pg) {
    pg = await PGlite.create();
    seedBytes = await seedFromParts(pg, seedKey);
    seeded = true;
  }
  const counts = (
    await pg.query<{ films: number; people: number; credits: number }>(
      `SELECT (SELECT count(*) FROM film)::int AS films, (SELECT count(*) FROM person)::int AS people,
              (SELECT count(*) FROM credit)::int AS credits`,
    )
  ).rows[0];
  const backend = await createBackend(pg, PERSISTED_DOCUMENTS);
  status({ phase: "ready", seeded, seedBytes, counts });
  if (seeded) {
    // Save the snapshot after reporting ready; failures only cost a re-seed next visit.
    const db = pg;
    setTimeout(() => {
      db.dumpDataDir("gzip")
        .then((blob) => writeSnapshot(seedKey, blob))
        .catch((error) => console.warn("Film Data Query: could not save the database snapshot", error));
    }, 1500);
  }
  return backend;
}

const ready = boot().catch((error: Error) => {
  status({ phase: "error", detail: error.message });
  throw error;
});

async function handle(wire: WireRequest, port: MessagePort) {
  let reply: WireResponse;
  try {
    const backend = await ready;
    const request = new Request(wire.url, {
      method: wire.method,
      headers: wire.headers,
      body: wire.body && wire.method !== "GET" && wire.method !== "HEAD" ? wire.body : undefined,
    });
    const { response, trace } = await backend.handle(request);
    const body = response.body ? await response.arrayBuffer() : null;
    reply = { status: response.status, statusText: response.statusText, headers: [...response.headers], body };
    scope.postMessage({ type: "trace", trace });
  } catch (error) {
    const body = new TextEncoder().encode(
      JSON.stringify({ error: { code: "BACKEND_UNAVAILABLE", message: (error as Error).message } }),
    ).buffer as ArrayBuffer;
    reply = { status: 503, statusText: "Service Unavailable", headers: [["content-type", "application/json"]], body };
  }
  port.postMessage(reply, reply.body ? [reply.body] : []);
}

async function reset() {
  try {
    await ready.catch(() => undefined);
    await pg?.close();
  } finally {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(SNAPSHOT_DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    scope.postMessage({ type: "reset-done" });
  }
}

scope.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "request" && event.ports[0]) void handle(message.request, event.ports[0]);
  if (message.type === "reset") void reset();
});
