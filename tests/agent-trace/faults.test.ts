import { describe, expect, it } from "vitest";
import { baseRequest, runThroughPipeline } from "./helpers";
import { validateSpans } from "../../src/demos/agent-trace/tracing/schema";

const spansOf = (c: Awaited<ReturnType<typeof runThroughPipeline>>) => c.store.index(c.runId)!.spans;

describe("fault injection", () => {
  it("flaky test: the first run_tests fails one extra test, chosen by the seed", async () => {
    const c = await runThroughPipeline(baseRequest({ faults: { flakyTest: true } }));
    const runs = spansOf(c).filter((s) => s.name === "execute_tool run_tests");
    expect(runs[0].attrs["app.fault.injected"]).toBe("flaky_test");
    expect(String(runs[0].attrs["gen_ai.tool.call.result"])).toContain("Injected flaky failure");
    expect(runs.at(-1)!.attrs["app.test.failed"]).toBe(0);
    expect(c.result.outcome).toBe("finished");
    expect(validateSpans(spansOf(c))).toEqual([]);
  });

  it("malformed output: the corrupted reply fails validation and is retried", async () => {
    const c = await runThroughPipeline(baseRequest({ faults: { malformedOutput: true } }));
    const chats = spansOf(c).filter((s) => s.name.startsWith("chat "));
    const bad = chats.find((s) => s.attrs["app.fault.injected"] === "malformed_output")!;
    expect(bad.status.code).toBe(2);
    expect(bad.attrs["error.type"]).toBe("malformed_output");
    expect(bad.events.map((e) => e.name)).toContain("validation_error");
    const retry = chats.find((s) => s.events.some((e) => e.name === "retry"))!;
    expect(retry.attrs["app.attempt"]).toBe(2);
    expect(retry.parentSpanId).toBe(bad.parentSpanId);
    expect(c.result.outcome).toBe("finished");
    expect(validateSpans(spansOf(c))).toEqual([]);
  });

  it("tool timeout: the blocked tool is aborted at its deadline and retried once", async () => {
    const c = await runThroughPipeline(baseRequest({ faults: { toolTimeout: "read_file" } }), { deadlines: { read_file: 30 }, fake: false });
    const reads = spansOf(c).filter((s) => s.name === "execute_tool read_file");
    expect(reads[0].attrs["error.type"]).toBe("timeout");
    expect(reads[0].attrs["app.fault.injected"]).toBe("tool_timeout");
    const ms = Number(reads[0].endNs! - reads[0].startNs) / 1e6;
    expect(ms).toBeGreaterThanOrEqual(25);
    expect(reads[1].events.map((e) => e.name)).toEqual(["retry"]);
    expect(reads[1].status.code).not.toBe(2);
    expect(c.result.outcome).toBe("finished");
    expect(validateSpans(spansOf(c))).toEqual([]);
  });

  it("run_tests timeout: a hanging test run is stopped by the wall-clock deadline", async () => {
    const c = await runThroughPipeline(baseRequest({ faults: { toolTimeout: "run_tests" } }), { deadlines: { run_tests: 40 }, fake: false });
    const runs = spansOf(c).filter((s) => s.name === "execute_tool run_tests");
    expect(runs[0].attrs["error.type"]).toBe("timeout");
    expect(runs[1].attrs["app.test.failed"]).toBe(1);
    expect(c.result.outcome).toBe("finished");
  });
});
