import { describe, expect, it } from "vitest";
import { align } from "../../src/demos/agent-trace/viewer/align";
import { parseUrlState, serializeUrlState } from "../../src/demos/agent-trace/viewer/url-state";
import { formatUsd, loadPrices, parsePrice, savePrices, whatIfCost } from "../../src/demos/agent-trace/viewer/cost";
import { buildViewSpans, p90, summarize, visibleRows, NO_FILTERS } from "../../src/demos/agent-trace/viewer/model";
import { defaultSpeed } from "../../src/demos/agent-trace/viewer/playback-clock";
import { baseRequest, runThroughPipeline } from "./helpers";
import { ReplayModel } from "./replay-model";
import { DEFAULT_MODEL_ID } from "../../src/demos/agent-trace/brains/models";

describe("sequence alignment", () => {
  it("aligns identical sequences one to one", () => {
    expect(align(["a", "b", "c"], ["a", "b", "c"], (x) => x)).toEqual([["a", "a"], ["b", "b"], ["c", "c"]]);
  });

  it("shows an extra step in one run as a gap in the other", () => {
    expect(align(["chat", "run_tests", "chat", "finish"], ["chat", "run_tests", "chat", "chat", "finish"], (x) => x)).toEqual([
      ["chat", "chat"],
      ["run_tests", "run_tests"],
      [null, "chat"],
      ["chat", "chat"],
      ["finish", "finish"],
    ]);
  });

  it("handles empty sequences", () => {
    expect(align([], ["a"], (x) => x)).toEqual([[null, "a"]]);
    expect(align<string>([], [], (x) => x)).toEqual([]);
  });
});

describe("URL state", () => {
  it("round-trips run, span, filters, compare target and playback time", () => {
    const state = parseUrlState("?run=sample-scripted-clean&span=0123456789abcdef&f=errors,slow&tool=run_tests&op=chat&q=1%3A60&cmp=live-abc&t=1.25");
    expect(state).toEqual({
      run: "sample-scripted-clean",
      span: "0123456789abcdef",
      cmp: "live-abc",
      t: 1.25,
      filters: { errors: true, slow: true, tool: "run_tests", op: "chat", q: "1:60" },
    });
    expect(parseUrlState(serializeUrlState(state))).toEqual(state);
  });

  it("ignores malformed values and omits defaults", () => {
    expect(parseUrlState("?run=<script>&t=-3")).toMatchObject({ run: undefined, t: undefined });
    expect(serializeUrlState({ filters: NO_FILTERS })).toBe("");
  });
});

describe("what-if cost", () => {
  it("multiplies the visitor's prices by reported token counts", () => {
    expect(whatIfCost(2_000_000, 500_000, { inputPerM: 0.5, outputPerM: 2 })).toBe(2);
    expect(formatUsd(0.00125)).toBe("$0.00125");
    expect(formatUsd(3)).toBe("$3.00");
  });

  it("has no default prices and shows nothing until both are entered", () => {
    expect(whatIfCost(100, 100, {})).toBeUndefined();
    expect(whatIfCost(100, 100, { inputPerM: 1 })).toBeUndefined();
    expect(loadPrices(undefined)).toEqual({});
    expect(parsePrice("")).toBeUndefined();
    expect(parsePrice("-1")).toBeUndefined();
    expect(parsePrice("0.15")).toBe(0.15);
  });

  it("saves prices to storage", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePrices({ inputPerM: 1, outputPerM: 4 }, storage);
    expect(loadPrices(storage)).toEqual({ inputPerM: 1, outputPerM: 4 });
  });
});

describe("viewer model", () => {
  it("summarizes a scripted run without any usage figures", async () => {
    const c = await runThroughPipeline(baseRequest());
    const s = summarize(buildViewSpans(c.store.index(c.runId)!));
    expect(s).toMatchObject({ outcome: "finished", steps: 5, llmCalls: 5, toolCalls: 5, retries: 0, tests: { passed: 6, failed: 0 }, brain: "Simulated brain" });
    expect(s.errorTypes).toEqual({ test_failure: 1 });
    for (const r of [s.inputTokens, s.outputTokens, s.ttftS, s.prefillTps, s.decodeTps]) expect(r).toEqual({ n: 0, m: 5, total: undefined, mean: undefined });
  });

  it("reports partial usage coverage as N of M calls", async () => {
    const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, extra: { e2e_latency_s: 1, prefill_tokens_per_s: 2, decode_tokens_per_s: 3, time_to_first_token_s: 4, time_per_output_token_s: 5 } };
    const model = new ReplayModel(DEFAULT_MODEL_ID, [
      { content: '{"tool":"run_tests","args":{}}', finish_reason: "stop", usage },
      { content: '{"tool":"finish","args":{"summary":"x"}}', finish_reason: "stop" },
    ]);
    const c = await runThroughPipeline(baseRequest(), { model });
    const s = summarize(buildViewSpans(c.store.index(c.runId)!));
    expect(s.inputTokens).toEqual({ n: 1, m: 2, total: 10, mean: 10 });
  });

  it("filters to errors while keeping their ancestors as context", async () => {
    const c = await runThroughPipeline(baseRequest({ faults: { malformedOutput: true } }));
    const spans = buildViewSpans(c.store.index(c.runId)!);
    const rows = visibleRows(spans, { ...NO_FILTERS, errors: true }, new Set());
    expect(rows.filter((r) => !r.context).every((r) => r.isError)).toBe(true);
    // The run itself succeeded, so the root is shown only as context for the failed call.
    expect(rows[0]).toMatchObject({ depth: 0, context: true });
    expect(rows.some((r) => r.op === "chat" && r.fault === "malformed_output")).toBe(true);
  });

  it("collapses subtrees and filters by tool and text", async () => {
    const c = await runThroughPipeline(baseRequest());
    const spans = buildViewSpans(c.store.index(c.runId)!);
    const root = spans[0];
    expect(visibleRows(spans, NO_FILTERS, new Set([root.id]))).toHaveLength(1);
    const tool = visibleRows(spans, { ...NO_FILTERS, tool: "read_file" }, new Set());
    expect(tool.filter((r) => !r.context).map((r) => r.span.name)).toEqual(["execute_tool read_file"]);
    const text = visibleRows(spans, { ...NO_FILTERS, q: "1:60" }, new Set());
    expect(text.filter((r) => !r.context).length).toBeGreaterThan(0);
    expect(p90(spans)).toBeGreaterThan(0);
  });

  it("playback clips the run to the playhead and reopens later-ending spans", async () => {
    const c = await runThroughPipeline(baseRequest());
    const index = c.store.index(c.runId)!;
    const all = buildViewSpans(index);
    const mid = all[Math.floor(all.length / 2)].startMs;
    const clipped = buildViewSpans(index, mid);
    expect(clipped.length).toBeLessThan(all.length);
    expect(clipped.every((s) => s.startMs <= mid)).toBe(true);
    expect(clipped[0].endMs).toBeNull();
    expect(defaultSpeed(20)).toBe(0.01);
    expect(defaultSpeed(60_000)).toBe(8);
  });
});
