/** Messages between the page, the service worker and the backend worker. */
import type { RequestTrace } from "./api/server";

export interface WireRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export interface WireResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export type BootPhase = "engine" | "download" | "seed" | "ready" | "error";

export interface BootStatus {
  phase: BootPhase;
  detail?: string;
  /** Milliseconds since the worker started. */
  elapsedMs: number;
  /** True when the database was built from the seed on this visit. */
  seeded?: boolean;
  seedBytes?: number;
  /** 0 to 1 while downloading and loading the seed. */
  progress?: number;
  counts?: { films: number; people: number; credits: number };
}

export type WorkerInbound =
  | { type: "request"; request: WireRequest }
  | { type: "reset" };

export type WorkerOutbound =
  | { type: "status"; status: BootStatus }
  | { type: "trace"; trace: RequestTrace }
  | { type: "reset-done" };
