import { BasicTracerProvider, type IdGenerator, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { Tracer } from "@opentelemetry/api";

export const SERVICE_NAME = "agent-trace-viewer";
export const SCOPE_NAME = "agent-trace-viewer/agent";
export const SCOPE_VERSION = "1.0.0";

export interface TracingOptions {
  processors: SpanProcessor[];
  /** Only tests pass a seeded generator; the product uses the SDK's random IDs. */
  idGenerator?: IdGenerator;
  /** Where the agent ran, e.g. "browser" or "node". */
  host: string;
}

/**
 * One tracer provider per run, created without registering globals, so runs never
 * share state. Context is passed explicitly (no zone.js in a worker).
 */
export function createTracing(options: TracingOptions): { provider: BasicTracerProvider; tracer: Tracer } {
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": SERVICE_NAME,
      "app.host": options.host,
    }),
    spanProcessors: options.processors,
    ...(options.idGenerator ? { idGenerator: options.idGenerator } : {}),
  });
  return { provider, tracer: provider.getTracer(SCOPE_NAME, SCOPE_VERSION) };
}

/** Deterministic IDs for golden and determinism tests. */
export class SeededIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly seed = 1) {}
  private hex(len: number): string {
    this.n += 1;
    let x = (this.seed * 2654435761 + this.n * 40503) >>> 0;
    let out = "";
    while (out.length < len) {
      x = (x * 1103515245 + 12345) >>> 0;
      out += x.toString(16).padStart(8, "0");
    }
    return out.slice(0, len);
  }
  generateTraceId(): string {
    return this.hex(32);
  }
  generateSpanId(): string {
    return this.hex(16);
  }
}
