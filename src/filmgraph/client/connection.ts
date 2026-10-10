/**
 * Starts the in-browser backend and gives the explorer a fetch() that goes
 * through it. Normally that is the real fetch(): the service worker intercepts
 * /projects/film-graph/api/* and forwards each request here, and we hand it to
 * the backend worker. If service workers are unavailable (no HTTPS, a private
 * window that blocks them, or a hard reload that bypasses them), requests go
 * to the worker directly with the same Request/Response objects.
 */
import { SW_SCOPE, SW_URL } from "../config";
import type { RequestTrace } from "../api/server";
import type { BootStatus, WireRequest, WireResponse, WorkerInbound, WorkerOutbound } from "../protocol";

export type TransportMode = "service-worker" | "direct";

export interface Connection {
  mode: TransportMode;
  /** Why the service worker is not in use, when mode is "direct". */
  fallbackReason: string | null;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  trace(requestId: string | null): Promise<RequestTrace | null>;
  reset(): Promise<void>;
}

function waitForController(timeoutMs: number): Promise<boolean> {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
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

async function setUpServiceWorker(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return "This browser does not support service workers.";
  if (!window.isSecureContext) return "Service workers need HTTPS or localhost.";
  try {
    await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    await navigator.serviceWorker.ready;
    const controlled = await waitForController(4000);
    return controlled ? null : "The page is not controlled by the service worker (a hard reload bypasses it).";
  } catch (error) {
    return `The service worker could not start: ${(error as Error).message}`;
  }
}

export async function connect(onStatus: (status: BootStatus) => void): Promise<Connection> {
  const worker = new Worker(new URL("../worker/backend.worker.ts", import.meta.url), {
    type: "module",
    name: "film-graph-backend",
  });
  const post = (message: WorkerInbound, transfer: Transferable[] = []) => worker.postMessage(message, transfer);

  const traces = new Map<string, RequestTrace>();
  const waiters = new Map<string, (trace: RequestTrace) => void>();
  let resetDone: (() => void) | null = null;

  worker.addEventListener("message", (event: MessageEvent<WorkerOutbound>) => {
    const message = event.data;
    if (message.type === "status") onStatus(message.status);
    if (message.type === "trace") {
      traces.set(message.trace.requestId, message.trace);
      waiters.get(message.trace.requestId)?.(message.trace);
      waiters.delete(message.trace.requestId);
    }
    if (message.type === "reset-done") resetDone?.();
  });
  worker.addEventListener("error", (event) => {
    onStatus({ phase: "error", detail: event.message || "The backend worker failed to start.", elapsedMs: 0 });
  });

  // The service worker forwards API requests to this page; pass them to the worker.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data as { type?: string; request?: WireRequest } | null;
      if (data?.type !== "filmgraph:request" || !data.request || !event.ports[0]) return;
      const transfer: Transferable[] = [event.ports[0]];
      if (data.request.body) transfer.push(data.request.body);
      post({ type: "request", request: data.request }, transfer);
    });
    navigator.serviceWorker.startMessages();
  }

  const fallbackReason = await setUpServiceWorker();
  const mode: TransportMode = fallbackReason ? "direct" : "service-worker";

  async function direct(url: string, init: RequestInit = {}): Promise<Response> {
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
    trace(requestId) {
      if (!requestId) return Promise.resolve(null);
      const known = traces.get(requestId);
      if (known) return Promise.resolve(known);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiters.delete(requestId);
          resolve(null);
        }, 2000);
        waiters.set(requestId, (trace) => {
          clearTimeout(timer);
          resolve(trace);
        });
      });
    },
    reset() {
      return new Promise<void>((resolve) => {
        resetDone = resolve;
        post({ type: "reset" });
      });
    },
  };
}
