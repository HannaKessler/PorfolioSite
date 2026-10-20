import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { JsonTraceSerializer } from "@opentelemetry/otlp-transformer";

/** Envelope posted over the MessagePort. `json` is a standard OTLP-JSON ExportTraceServiceRequest. */
export interface OtlpBatchMessage {
  type: "otlp";
  json: string;
  /** Epoch ms when the batch was posted, for measuring live latency. */
  postedAt: number;
}

/**
 * Posts spans when they start (open, endTimeUnixNano "0") and again when they
 * end, so the viewer can draw running spans. Batches are flushed every
 * `flushMs` and serialized with the SDK's standard OTLP-JSON serializer.
 */
export class LivePortSpanProcessor implements SpanProcessor {
  private pending: ReadableSpan[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly post: (message: OtlpBatchMessage) => void,
    private readonly flushMs = 50,
    private readonly now: () => number = () => performance.timeOrigin + performance.now(),
  ) {}

  onStart(span: Span, _parentContext: Context): void {
    // Freeze the span as it is now, so the open state is sent even if the span
    // ends before the next flush.
    const ctx = span.spanContext();
    const open: ReadableSpan = {
      name: span.name,
      kind: span.kind,
      spanContext: () => ctx,
      parentSpanContext: span.parentSpanContext,
      startTime: span.startTime,
      endTime: [0, 0],
      status: { ...span.status },
      attributes: { ...span.attributes },
      links: [...span.links],
      events: [...span.events],
      duration: [0, 0],
      ended: false,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    };
    this.enqueue(open);
  }

  onEnd(span: ReadableSpan): void {
    this.enqueue(span);
  }

  private enqueue(span: ReadableSpan) {
    this.pending.push(span);
    this.timer ??= setTimeout(() => this.flush(), this.flushMs);
  }

  /** Serializes and posts everything queued, in order: a span's open copy precedes its ended copy. */
  flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length === 0) return;
    const spans = this.pending;
    this.pending = [];
    const json = this.decoder.decode(JsonTraceSerializer.serializeRequest(spans));
    this.post({ type: "otlp", json, postedAt: this.now() });
  }

  forceFlush(): Promise<void> {
    this.flush();
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.flush();
    return Promise.resolve();
  }
}
