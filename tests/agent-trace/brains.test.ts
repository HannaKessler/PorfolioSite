import { describe, expect, it } from "vitest";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { mapReportedUsage, toWebLLMMessages } from "../../src/demos/agent-trace/brains/webllm";
import { usageToAttributes } from "../../src/demos/agent-trace/tracing/attrs";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, resolveModel } from "../../src/demos/agent-trace/brains/models";
import { checkWebGPU } from "../../src/demos/agent-trace/brains/capability";
import { ReplayModel, type RecordedResponse } from "./replay-model";
import { baseRequest, runThroughPipeline } from "./helpers";
import { structuralKeys, validateSpans } from "../../src/demos/agent-trace/tracing/schema";
import { BUGS } from "../../src/demos/agent-trace/agent/tasks/format-duration/files";

// Synthetic fixture values for unit tests only; they never appear in the product or samples.
const usage = (extra: Record<string, number>) => ({ prompt_tokens: 11, completion_tokens: 3, total_tokens: 14, extra });
const fullExtra = { e2e_latency_s: 1, prefill_tokens_per_s: 2, decode_tokens_per_s: 3, time_to_first_token_s: 4, time_per_output_token_s: 5 };

describe("reported usage mapping", () => {
  it("maps WebLLM usage field by field", () => {
    expect(mapReportedUsage(usage({ ...fullExtra, grammar_init_s: 6 }) as never)).toEqual({
      inputTokens: 11, outputTokens: 3, e2eLatencyS: 1, prefillTokensPerS: 2, decodeTokensPerS: 3, timeToFirstTokenS: 4, timePerOutputTokenS: 5, grammarInitS: 6,
    });
  });

  it("leaves missing fields absent and never defaults them to 0", () => {
    const { decode_tokens_per_s, ...partial } = fullExtra;
    const mapped = mapReportedUsage(usage(partial) as never)!;
    expect(mapped).not.toHaveProperty("decodeTokensPerS");
    expect(mapped).not.toHaveProperty("grammarInitS");
    const attrs = usageToAttributes(mapped);
    expect(attrs).not.toHaveProperty("app.llm.decode_tokens_per_s");
    expect(attrs["gen_ai.usage.input_tokens"]).toBe(11);
    expect(mapReportedUsage(undefined)).toBeUndefined();
    expect(usageToAttributes(undefined)).toEqual({});
    expect(usageToAttributes({ inputTokens: Number.NaN })).toEqual({});
  });

  it("sends tool results to WebLLM as user turns", () => {
    expect(toWebLLMMessages([{ role: "tool", toolName: "run_tests", toolCallId: "call_1", content: "{}" }])[0]).toEqual({
      role: "user",
      content: "Tool result for run_tests (call_1):\n{}",
    });
  });
});

describe("identical pipeline for both brains", () => {
  const script: RecordedResponse[] = [
    { content: '{"thought":"run","tool":"run_tests","args":{}}', finish_reason: "stop", usage: usage(fullExtra) },
    { content: '{"tool":"read_file","args":{"path":"src/formatDuration.js"}}', finish_reason: "stop", usage: usage(fullExtra) },
    { content: '{"tool":"edit_file","args":{"path":"src/formatDuration.js"', finish_reason: "length", usage: usage(fullExtra) },
    {
      content: JSON.stringify({ tool: "edit_file", args: { path: "src/formatDuration.js", find: BUGS.rounding.buggy, replace: BUGS.rounding.fixed } }),
      finish_reason: "stop",
      usage: usage({ e2e_latency_s: 1 }),
    },
    { content: '{"tool":"run_tests","args":{}}', finish_reason: "stop" },
    { content: '{"tool":"finish","args":{"summary":"Rounded once."}}', finish_reason: "stop", usage: usage(fullExtra) },
  ];

  it("replayed WebLLM spans and scripted spans share one schema", async () => {
    const replay = await runThroughPipeline(baseRequest(), { model: new ReplayModel(DEFAULT_MODEL_ID, script) });
    const scripted = await runThroughPipeline(baseRequest());
    const rs = replay.store.index(replay.runId)!.spans;
    const ss = scripted.store.index(scripted.runId)!.spans;
    expect(replay.result.outcome).toBe("finished");
    expect(validateSpans(rs)).toEqual([]);
    expect(validateSpans(ss)).toEqual([]);
    // Same span names (modulo model and numbers), kinds and parent types per operation.
    const shape = (spans: typeof rs) => {
      const byId = new Map(spans.map((x) => [x.spanId, x]));
      const tuples = spans.map((x) =>
        JSON.stringify([x.name.replace(/^chat .*/, "chat MODEL").replace(/\d+/g, "N"), x.kind, x.parentSpanId ? byId.get(x.parentSpanId)!.attrs["app.span.type"] : null]),
      );
      return [...new Set(tuples)].sort();
    };
    expect(shape(rs)).toEqual(shape(ss));
    const keysR = structuralKeys(rs);
    const keysS = structuralKeys(ss);
    for (const op of ["invoke_agent", "step", "execute_tool"]) expect(keysR[op]).toEqual(keysS[op]);
    // chat differs only by fault/error keys from the replay's malformed reply.
    expect(keysR.chat.filter((k) => k !== "error.type")).toEqual(keysS.chat);
  });

  it("copies only reported usage onto chat spans", async () => {
    const replay = await runThroughPipeline(baseRequest(), { model: new ReplayModel(DEFAULT_MODEL_ID, script) });
    const chats = replay.store.index(replay.runId)!.spans.filter((s) => s.name.startsWith("chat "));
    expect(chats[0].attrs["gen_ai.usage.input_tokens"]).toBe(11);
    expect(chats[0].attrs["app.llm.decode_tokens_per_s"]).toBe(3);
    expect(chats[3].attrs).not.toHaveProperty("app.llm.decode_tokens_per_s");
    expect(chats[3].attrs["app.llm.e2e_latency_s"]).toBe(1);
    expect(chats[4].attrs).not.toHaveProperty("gen_ai.usage.input_tokens");
    expect(chats[2].attrs["error.type"]).toBe("malformed_output");
  });
});

describe("model catalogue and capability", () => {
  it("keeps VRAM figures in sync with WebLLM's prebuilt config", () => {
    for (const m of MODEL_OPTIONS) {
      for (const [id, vram] of [[m.id, m.vramMB], [m.f32Id, m.f32VramMB]] as const) {
        const rec = prebuiltAppConfig.model_list.find((r) => r.model_id === id);
        expect(rec, id).toBeDefined();
        expect(Math.round(rec!.vram_required_MB!)).toBe(vram);
      }
    }
    expect(MODEL_OPTIONS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true);
  });

  it("falls back to the q4f32 build without shader-f16", () => {
    const qwen = MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID)!;
    expect(resolveModel(qwen, true).modelId).toBe(DEFAULT_MODEL_ID);
    expect(resolveModel(qwen, false)).toEqual({ modelId: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC", vramMB: 1889 });
  });

  it("reports why WebGPU is unavailable", async () => {
    expect(await checkWebGPU({})).toMatchObject({ ok: false });
    expect(await checkWebGPU({ gpu: { requestAdapter: async () => null } })).toMatchObject({ ok: false });
    expect(await checkWebGPU({ gpu: { requestAdapter: async () => ({ features: new Set(["shader-f16"]) }) } })).toEqual({ ok: true, shaderF16: true });
  });
});
