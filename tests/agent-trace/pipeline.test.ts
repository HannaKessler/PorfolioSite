import { describe, expect, it } from "vitest";
import { baseRequest, runThroughPipeline } from "./helpers";
import { Collector } from "../../src/demos/agent-trace/collector/collector";
import { TraceStore } from "../../src/demos/agent-trace/store/trace-store";
import { IngestError, parseOtlp } from "../../src/demos/agent-trace/collector/ingest";
import { normalizeId, normalizeNanos } from "../../src/demos/agent-trace/collector/normalize";

describe("transport, collector and store", () => {
  it("posts spans on start (open) and again on end", async () => {
    const c = await runThroughPipeline();
    const seen = new Map<string, string[]>();
    for (const b of c.batches) {
      for (const rs of JSON.parse(b.json).resourceSpans)
        for (const ss of rs.scopeSpans)
          for (const s of ss.spans) seen.set(s.spanId, [...(seen.get(s.spanId) ?? []), s.endTimeUnixNano === "0" ? "open" : "ended"]);
    }
    const root = c.store.index(c.runId)!.roots[0];
    expect(seen.get(root.spanId)![0]).toBe("open");
    expect(seen.get(root.spanId)!.at(-1)).toBe("ended");
    expect(c.store.index(c.runId)!.open).toBe(0);
  });

  it("export → ingest → export round-trips to an identical document", async () => {
    const c = await runThroughPipeline();
    const first = c.store.exportOtlp(c.runId);
    const store2 = new TraceStore();
    const [id2] = new Collector(store2).ingest(JSON.stringify(first), { source: "upload", sourceId: "upload-abc" }).runIds;
    expect(id2).toBe("upload-abc");
    expect(store2.exportOtlp(id2)).toEqual(first);
    expect(first.resourceSpans[0].resource?.attributes?.find((a) => a.key === "service.name")?.value?.stringValue).toBe("agent-trace-viewer");
  });

  it("never replaces an ended span with an older open copy", () => {
    const store = new TraceStore();
    const col = new Collector(store);
    const span = (end: string) => ({
      resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "a".repeat(32), spanId: "b".repeat(16), name: "x", startTimeUnixNano: "100", endTimeUnixNano: end }] }] }],
    });
    const [id] = col.ingest(span("200"), { source: "live" }).runIds;
    col.ingest(span("0"), { source: "live" });
    expect(store.get(id)!.spans.get("b".repeat(16))!.endNs).toBe(200n);
  });

  it("normalizes IDs and timestamps from other OTLP producers", () => {
    expect(normalizeId("AAECAwQFBgcICQoLDA0ODw==", 16)).toBe("000102030405060708090a0b0c0d0e0f");
    expect(normalizeId("ABCDEF0123456789", 8)).toBe("abcdef0123456789");
    expect(normalizeNanos(1700000000000000000)).toBe("1700000000000000000");
    expect(normalizeNanos({ low: 1, high: 1 })).toBe(String(2 ** 32 + 1));
  });

  it("rejects documents that are not OTLP trace exports, and bad spans individually", () => {
    expect(() => parseOtlp("{not json")).toThrow(IngestError);
    expect(() => parseOtlp({ foo: 1 })).toThrow(IngestError);
    const parsed = parseOtlp({ resourceSpans: [{ scopeSpans: [{ spans: [{ traceId: "zz", spanId: "b".repeat(16), name: "x", startTimeUnixNano: "1" }] }] }] });
    expect(parsed.spans).toHaveLength(0);
    expect(parsed.rejected[0].reason).toBe("invalid traceId");
  });

  it("assigns stable run IDs: live from the trace ID, samples and uploads from their source", async () => {
    const c = await runThroughPipeline(baseRequest());
    expect(c.runId).toBe(`live-${c.store.get(c.runId)!.traceId.slice(0, 16)}`);
  });
});
