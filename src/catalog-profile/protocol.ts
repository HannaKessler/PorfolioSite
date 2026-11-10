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

export type WorkerInbound =
  | { type: "request"; request: WireRequest }
  | { type: "persist-ack" };

export type WorkerOutbound =
  | { type: "ready" }
  | { type: "error"; detail: string };
