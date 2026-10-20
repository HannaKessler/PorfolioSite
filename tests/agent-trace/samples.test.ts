import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Collector } from "../../src/demos/agent-trace/collector/collector";
import { TraceStore } from "../../src/demos/agent-trace/store/trace-store";
import { spanType, validateSpans } from "../../src/demos/agent-trace/tracing/schema";
import { GEN_AI, REPORTED_ONLY_KEYS } from "../../src/demos/agent-trace/tracing/attrs";
import { parseUrlState, serializeUrlState } from "../../src/demos/agent-trace/viewer/url-state";
import { NO_FILTERS } from "../../src/demos/agent-trace/viewer/model";

const dir = join(__dirname, "../../src/demos/agent-trace/samples");
const files = readdirSync(dir).filter((f) => f.endsWith(".otlp.json"));

function load(file: string) {
  const store = new TraceStore();
  const name = file.replace(/\.otlp\.json$/, "");
  const [runId] = new Collector(store).ingest(readFileSync(join(dir, file), "utf8"), { source: "sample", sourceId: `sample-${name}` }).runIds;
  return [...store.get(runId)!.spans.values()];
}

describe("bundled samples", () => {
  it("includes the planned set", () => {
    expect(files.sort()).toEqual(["scripted-clean.otlp.json", "scripted-flaky.otlp.json", "scripted-malformed.otlp.json", "webllm-qwen2.5-1.5b.otlp.json"]);
  });

  it.each(files)("%s ingests, is complete and passes the span schema", (file) => {
    const spans = load(file);
    expect(spans.length).toBeGreaterThan(0);
    expect(validateSpans(spans)).toEqual([]);
  });

  it.each(files)("%s can be linked to from the URL", (file) => {
    const run = `sample-${file.replace(/\.otlp\.json$/, "")}`;
    expect(parseUrlState(serializeUrlState({ run, cmp: run, filters: NO_FILTERS })).run).toBe(run);
  });

  it.each(files.filter((f) => f.startsWith("scripted-")))("%s carries no usage figures", (file) => {
    for (const s of load(file)) for (const k of REPORTED_ONLY_KEYS) expect(s.attrs[k]).toBeUndefined();
  });

  it("the WebLLM sample carries runtime-reported usage on chat spans only", () => {
    const spans = load("webllm-qwen2.5-1.5b.otlp.json");
    const chats = spans.filter((s) => spanType(s) === "chat");
    expect(chats.length).toBeGreaterThan(0);
    for (const c of chats) {
      expect(typeof c.attrs[GEN_AI.usageInputTokens]).toBe("number");
      expect(typeof c.attrs[GEN_AI.usageOutputTokens]).toBe("number");
    }
    for (const s of spans.filter((s) => spanType(s) !== "chat")) for (const k of REPORTED_ONLY_KEYS) expect(s.attrs[k]).toBeUndefined();
  });
});
