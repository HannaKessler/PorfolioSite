import { MESSAGE_TYPE, SW_SCOPE, SW_URL } from "../config";
import type { WorkerInbound, WireRequest, WireResponse } from "../protocol";

export type TransportMode = "service-worker" | "direct";

export interface Connection {
  mode: TransportMode;
  fallbackReason: string | null;
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

function waitForController(timeoutMs: number) {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(!!navigator.serviceWorker.controller), timeoutMs);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

const timeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

async function setUpServiceWorker() {
  if (!("serviceWorker" in navigator)) return "This browser does not support service workers.";
  if (!window.isSecureContext) return "Service workers need HTTPS or localhost.";
  if (!location.pathname.startsWith(SW_SCOPE)) return "This page is outside the service worker's scope.";
  try {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    const ready = await timeout(navigator.serviceWorker.ready, 8000);
    if (!ready) return "The service worker did not start in time.";
    const controlled = await waitForController(4000);
    return controlled ? null : "The page is not controlled by the service worker (a hard reload bypasses it).";
  } catch (error) {
    return `The service worker could not start: ${(error as Error).message}`;
  }
}

export async function connect(): Promise<Connection> {
  const worker = new Worker(new URL("../worker/backend.worker.ts", import.meta.url), {
    type: "module",
    name: "catalog-profile-backend",
  });
  const post = (message: WorkerInbound, transfer: Transferable[] = []) => worker.postMessage(message, transfer);

  const workerReady = new Promise<void>((resolve, reject) => {
    worker.addEventListener("message", (event) => {
      if (event.data?.type === "ready") resolve();
      if (event.data?.type === "error") reject(new Error(event.data.detail));
    });
    worker.addEventListener("error", (event) => reject(new Error(event.message || "The profile worker failed to start.")));
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data as { type?: string; request?: WireRequest } | null;
      if (data?.type !== MESSAGE_TYPE || !data.request || !event.ports[0]) return;
      const transfer: Transferable[] = [event.ports[0]];
      if (data.request.body) transfer.push(data.request.body);
      post({ type: "request", request: data.request }, transfer);
    });
    navigator.serviceWorker.startMessages();
  }

  const fallbackReason = await setUpServiceWorker();
  const mode: TransportMode = fallbackReason ? "direct" : "service-worker";
  await workerReady;

  async function direct(url: string, init: RequestInit = {}) {
    const request = new Request(new URL(url, location.href), init);
    const body = request.method === "GET" || request.method === "HEAD" ? null : await request.arrayBuffer();
    const channel = new MessageChannel();
    const reply = new Promise<WireResponse>((resolve) => {
      channel.port1.onmessage = (event) => resolve(event.data);
    });
    const transfer: Transferable[] = [channel.port2];
    if (body) transfer.push(body);
    post({ type: "request", request: { url: request.url, method: request.method, headers: [...request.headers], body } }, transfer);
    const result = await reply;
    const nullBody = result.status === 204 || result.status === 304;
    return new Response(nullBody ? null : result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    });
  }

  return {
    mode,
    fallbackReason,
    fetch: (url, init) => (mode === "service-worker" ? fetch(url, init) : direct(url, init)),
  };
}
