import type { TraceStore, RunSource } from "../store/trace-store";
import { parseOtlp } from "./ingest";

export interface IngestOptions {
  source: RunSource;
  /** Stable ID for samples ("sample-…") and uploads ("upload-<hash>"). Live runs derive theirs from the trace ID. */
  sourceId?: string;
  label?: string;
}

export interface IngestResult {
  accepted: number;
  rejected: { index: number; reason: string }[];
  runIds: string[];
}

/**
 * The single entry point for spans: the live MessagePort, bundled samples and
 * uploaded files all go through ingest(), so every run is handled identically.
 */
export class Collector {
  constructor(private readonly store: TraceStore) {}

  ingest(otlp: unknown, options: IngestOptions): IngestResult {
    const batch = parseOtlp(otlp);
    const runIds = this.store.upsert(batch, options);
    return { accepted: batch.spans.length, rejected: batch.rejected, runIds };
  }

  /** Listens on a MessagePort for batches posted by LivePortSpanProcessor. */
  connectPort(port: MessagePort, onBatch?: (result: IngestResult, postedAt: number) => void): () => void {
    const handler = (e: MessageEvent) => {
      const msg = e.data as { type?: string; json?: string; postedAt?: number };
      if (msg?.type !== "otlp" || typeof msg.json !== "string") return;
      const result = this.ingest(msg.json, { source: "live" });
      onBatch?.(result, msg.postedAt ?? 0);
    };
    port.addEventListener("message", handler);
    port.start();
    return () => port.removeEventListener("message", handler);
  }
}
