// Main-thread side of the parser worker. Both custom panes ask for the same
// file set, so one parse is shared; its ImageBitmaps are released when a
// different file set replaces it.
import { disposeCustomScene, type CustomScene } from "./customScene";
import type { WorkerRequest, WorkerResponse } from "./parser.worker";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (scene: CustomScene) => void; reject: (error: Error) => void }>();
let current: { files: readonly File[]; promise: Promise<CustomScene> } | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./parser.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const reply = event.data;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      if (reply.ok) entry.resolve(reply.scene);
      else entry.reject(new Error(reply.error));
    };
    worker.onerror = (event) => {
      for (const entry of pending.values()) entry.reject(new Error(event.message || "The parser worker failed."));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Parse a file set with our own parsers in the worker; repeated calls with the same array share one result. */
export function loadCustomScene(files: readonly File[]): Promise<CustomScene> {
  if (current?.files === files) return current.promise;
  const previous = current;
  const promise = (async () => {
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })));
    const id = nextId++;
    return new Promise<CustomScene>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      getWorker().postMessage({ id, files: inputs } satisfies WorkerRequest, inputs.map((input) => input.data));
    });
  })();
  current = { files, promise };
  previous?.promise.then(disposeCustomScene, () => {});
  return promise;
}
