import { describe, expect, it } from "vitest";
import { baseRequest, runThroughPipeline } from "./helpers";
import { ReplayModel } from "./replay-model";
import { DEFAULT_MODEL_ID } from "../../src/demos/agent-trace/brains/models";
import { WebLLMBrain, type EngineLike } from "../../src/demos/agent-trace/brains/webllm";
import { decide } from "../../src/demos/agent-trace/brains/scripted";
import { BUGS, projectFiles } from "../../src/demos/agent-trace/agent/tasks/format-duration/files";
import { APP, GEN_AI } from "../../src/demos/agent-trace/tracing/attrs";
import { buildViewSpans } from "../../src/demos/agent-trace/viewer/model";
import { buildActivity, fileTree, lineDiff, modelCall, projectAt, stepOf } from "../../src/demos/agent-trace/viewer/details";
import { parseUrlState, serializeUrlState } from "../../src/demos/agent-trace/viewer/url-state";
import { NO_FILTERS } from "../../src/demos/agent-trace/viewer/model";

const views = async (...args: Parameters<typeof runThroughPipeline>) => {
  const c = await runThroughPipeline(...args);
  const index = c.store.index(c.runId)!;
  return { c, index, spans: buildViewSpans(index) };
};

describe("scripted policy decisions", () => {
  it("replies with a tool call only and reports the rule that fired", () => {
    const first = decide([]);
    expect(JSON.parse(first.text)).toEqual({ tool: "run_tests", args: {} });
    expect(first.decision).toEqual({ rule: "no tool result yet → run_tests", condition: "The conversation has no tool result yet." });
  });

  it("puts the matched values in the condition", async () => {
    const { spans } = await views(baseRequest());
    const calls = spans.filter((s) => s.op === "chat").map(modelCall);
    expect(calls.map((c) => c.policy?.rule)).toEqual([
      "no tool result yet → run_tests",
      "tests fail → read the module of the first failing suite",
      "known buggy line found → edit_file with its known fix",
      "edit applied → run_tests",
      "all tests pass → finish",
    ]);
    expect(calls[1].policy!.condition).toContain('failed=1, first failure "formatDuration > rounds fractional seconds into the next minute"');
    expect(calls[2].policy!.condition).toContain(JSON.stringify(BUGS.rounding.buggy));
    // No prose reasoning: the reply text has no thought field.
    for (const c of calls) expect(c.parsed?.ok && c.parsed.call.thought).toBeFalsy();
  });
});

describe("activity feed", () => {
  it("lists each step with its decision, tool call, result and outcome", async () => {
    const { spans } = await views(baseRequest());
    const a = buildActivity(spans);
    expect(a.outcome).toBe("finished");
    expect(a.steps.map((s) => [s.index, s.calls.length, s.tools.map((t) => t.tool).join(), s.outcome])).toEqual([
      [1, 1, "run_tests", "test_failure"],
      [2, 1, "read_file", "ok"],
      [3, 1, "edit_file", "ok"],
      [4, 1, "run_tests", "ok"],
      [5, 1, "finish", "finished"],
    ]);
    const firstTests = a.steps[0].tools[0];
    expect(firstTests.tests).toMatchObject({ passed: 5, failed: 1 });
    expect(firstTests.tests!.failures[0].message).toBe('expected "1:60" to be "1:00"');
    expect(firstTests.errorType).toBe("test_failure");
    expect(stepOf(a, firstTests.span.id)?.index).toBe(1);
    expect(stepOf(a, a.steps[2].calls[0].span.id)?.index).toBe(3);
  });

  it("shows a real model's thought verbatim and keeps the raw reply", async () => {
    const thought = "The test for 59.6 s fails, so start by reading the module.";
    const reply = JSON.stringify({ thought, tool: "read_file", args: { path: "src/formatDuration.js" } });
    const model = new ReplayModel(DEFAULT_MODEL_ID, [
      { content: reply, finish_reason: "stop" },
      { content: '{"tool":"finish","args":{"summary":"x"}}', finish_reason: "stop" },
    ]);
    const { spans } = await views(baseRequest(), { model });
    const call = buildActivity(spans).steps[0].calls[0];
    expect(call.output).toBe(reply);
    expect(call.parsed).toMatchObject({ ok: true, call: { thought, tool: "read_file" } });
    expect(call.policy).toBeUndefined();
  });

  it("shows malformed output as recorded, with the validator's error", async () => {
    const { spans } = await views(baseRequest({ faults: { malformedOutput: true } }));
    const step = buildActivity(spans).steps[1];
    expect(step.calls).toHaveLength(2);
    const bad = step.calls[0];
    expect(bad.fault).toBe("malformed_output");
    expect(bad.parsed?.ok).toBe(false);
    expect(bad.output!.length).toBeGreaterThan(0);
    expect(step.calls[1].parsed?.ok).toBe(true);
  });

  it("follows the playback position", async () => {
    const { index, spans } = await views(baseRequest());
    const edit = spans.find((s) => s.tool === "edit_file")!;
    const atEdit = buildActivity(buildViewSpans(index, edit.startMs));
    expect(atEdit.steps).toHaveLength(3);
    expect(atEdit.steps[2].tools[0].open).toBe(true);
    expect(atEdit.outcome).toBeUndefined();
  });
});

describe("virtual project", () => {
  it("records the start snapshot and each edit's before and after", async () => {
    const { spans } = await views(baseRequest());
    const root = spans[0];
    expect(JSON.parse(String(root.span.attrs[APP.vfsFiles]))).toEqual(projectFiles("rounding"));
    const edit = spans.find((s) => s.tool === "edit_file")!;
    expect(edit.span.attrs[APP.fileBefore]).toBe(projectFiles("rounding")["src/formatDuration.js"]);
    expect(String(edit.span.attrs[APP.fileAfter])).toContain(BUGS.rounding.fixed);
    expect(edit.span.attrs[APP.editMatches]).toBe(1);
  });

  it("rebuilds the files at any point from the recorded data", async () => {
    const { index, spans } = await views(baseRequest());
    const edit = spans.find((s) => s.tool === "edit_file")!;
    const initial = projectFiles("rounding");
    const before = projectAt(spans, edit.startMs);
    expect(before.files).toEqual(initial);
    expect(before.changed.size).toBe(0);
    const after = projectAt(spans);
    expect(after.changed).toEqual(new Set(["src/formatDuration.js"]));
    expect(after.files["src/formatDuration.js"]).toContain(BUGS.rounding.fixed);
    expect(after.files["src/formatDuration.js"]).not.toContain(BUGS.rounding.buggy);
    // Playback clipping: while the edit is open, it is not applied.
    expect(projectAt(buildViewSpans(index, edit.startMs)).files).toEqual(initial);
    const d = lineDiff(initial["src/formatDuration.js"], after.files["src/formatDuration.js"]);
    expect(d.filter((l) => l.type === "del").map((l) => l.text)).toEqual([BUGS.rounding.buggy]);
    expect(d.filter((l) => l.type === "add").map((l) => l.text)).toEqual([BUGS.rounding.fixed]);
  });

  it("keeps what a failed edit attempted and why it failed", async () => {
    const model = new ReplayModel(DEFAULT_MODEL_ID, [
      { content: '{"tool":"edit_file","args":{"path":"/src/formatDuration.js","find":"1:60","replace":"1:00"}}', finish_reason: "stop" },
      { content: '{"tool":"finish","args":{"summary":"x"}}', finish_reason: "stop" },
    ]);
    const { spans } = await views(baseRequest(), { model });
    const state = projectAt(spans);
    expect(state.edits).toHaveLength(1);
    const e = state.edits[0];
    expect(e).toMatchObject({ path: "src/formatDuration.js", find: "1:60", replace: "1:00", applied: false, matches: 0, error: "find string not found" });
    expect(e.before).toBe(projectFiles("rounding")["src/formatDuration.js"]);
    expect(e.after).toBeUndefined();
    expect(state.changed.size).toBe(0);
  });

  it("says when a trace has no file snapshot", async () => {
    const { spans } = await views(baseRequest());
    delete spans[0].span.attrs[APP.vfsFiles];
    expect(projectAt(spans)).toMatchObject({ available: false, truncated: false });
  });

  it("builds a sorted tree, folders first", () => {
    expect(fileTree(["src/b.js", "README.md", "src/a.js", "test/x.test.js"])).toEqual([
      { name: "src", path: "src", children: [{ name: "a.js", path: "src/a.js" }, { name: "b.js", path: "src/b.js" }] },
      { name: "test", path: "test", children: [{ name: "x.test.js", path: "test/x.test.js" }] },
      { name: "README.md", path: "README.md" },
    ]);
  });

  it("diffs lines with old and new line numbers", () => {
    expect(lineDiff("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { type: "same", text: "a", oldNo: 1, newNo: 1 },
      { type: "del", text: "b", oldNo: 2 },
      { type: "add", text: "B", newNo: 2 },
      { type: "same", text: "c", oldNo: 3, newNo: 3 },
      { type: "add", text: "d", newNo: 4 },
    ]);
  });
});

describe("prompts and raw replies", () => {
  it("records the full message list of every call, untruncated", async () => {
    const model = new ReplayModel(DEFAULT_MODEL_ID, [{ content: '{"tool":"read_file","args":{"path":"src/formatDuration.js"}}', finish_reason: "stop" }]);
    const { spans } = await views(baseRequest({ maxSteps: 12 }), { model });
    const calls = spans.filter((s) => s.op === "chat").map(modelCall);
    expect(calls).toHaveLength(12);
    const last = calls[11];
    expect(last.truncated).toBe(false);
    expect(String(last.span.span.attrs[GEN_AI.inputMessages]).length).toBeGreaterThan(8 * 1024);
    expect(last.messages!.map((m) => m.role).slice(0, 4)).toEqual(["system", "user", "assistant", "tool"]);
    expect(last.messages).toHaveLength(2 + 11 * 2);
    expect(last.messages![3].toolCallId).toBe("call_1");
    expect(last.messages![3].text).toContain("export function formatDuration");
  });

  it("records the exact request body a WebLLM engine received", async () => {
    let received: Record<string, unknown> | undefined;
    const engine: EngineLike = {
      resetChat: async () => {},
      interruptGenerate: () => {},
      chat: {
        completions: {
          create: async (body) => {
            received = body;
            return { choices: [{ message: { content: '{"tool":"finish","args":{"summary":"x"}}' }, finish_reason: "stop" }] };
          },
        },
      },
    };
    const brain = new WebLLMBrain(DEFAULT_MODEL_ID, "Qwen", engine);
    const completion = await brain.complete({
      messages: [{ role: "system", content: "s" }, { role: "tool", toolName: "run_tests", toolCallId: "call_1", content: "{}" }],
      tools: [],
      signal: new AbortController().signal,
    });
    expect(JSON.parse(completion.request!)).toEqual(received);
    expect((received!.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
    expect(completion.decision).toBeUndefined();
  });

  it("puts prompts and tool arguments on the open copy, so live views show them", async () => {
    const c = await runThroughPipeline(baseRequest());
    const open = new Map<string, Record<string, unknown>>();
    for (const b of c.batches)
      for (const rs of JSON.parse(b.json).resourceSpans)
        for (const ss of rs.scopeSpans)
          for (const s of ss.spans)
            if (s.endTimeUnixNano === "0" && !open.has(s.name)) open.set(s.name, Object.fromEntries(s.attributes.map((a: { key: string }) => [a.key, true])));
    const chat = [...open.entries()].find(([n]) => n.startsWith("chat "))![1];
    const tool = [...open.entries()].find(([n]) => n.startsWith("execute_tool "))![1];
    const root = [...open.entries()].find(([n]) => n.startsWith("invoke_agent "))![1];
    expect(chat[GEN_AI.inputMessages]).toBe(true);
    expect(tool[GEN_AI.toolCallArguments]).toBe(true);
    expect(root[APP.vfsFiles]).toBe(true);
  });

  it("keeps the selected detail view in the URL", () => {
    const state = { run: "sample-scripted-clean", filters: NO_FILTERS, view: "files" as const };
    expect(serializeUrlState(state)).toBe("?run=sample-scripted-clean&v=files");
    expect(parseUrlState("?v=files").view).toBe("files");
    expect(parseUrlState("?v=activity").view).toBeUndefined();
    expect(parseUrlState("?v=nope").view).toBeUndefined();
  });
});
