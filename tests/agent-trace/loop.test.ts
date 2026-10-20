import { describe, expect, it } from "vitest";
import { baseRequest, runThroughPipeline } from "./helpers";
import { validateSpans } from "../../src/demos/agent-trace/tracing/schema";
import { REPORTED_ONLY_KEYS } from "../../src/demos/agent-trace/tracing/attrs";
import { BUGS, MODULE_PATH } from "../../src/demos/agent-trace/agent/tasks/format-duration/files";

const names = (c: Awaited<ReturnType<typeof runThroughPipeline>>) => c.store.index(c.runId)!.spans.map((s) => s.name);

describe("agent loop with the scripted brain", () => {
  for (const variant of ["rounding", "padding"] as const) {
    it(`fixes the ${variant} bug and finishes with all tests passing`, async () => {
      const c = await runThroughPipeline(baseRequest({ variant }));
      expect(c.result.outcome).toBe("finished");
      expect(c.result.lastTests).toMatchObject({ failed: 0, passed: 6 });
      expect(c.result.files[MODULE_PATH]).toContain(BUGS[variant].fixed);
      expect(c.result.summary).toBe(BUGS[variant].description);
      expect(names(c).filter((n) => n.startsWith("execute_tool"))).toEqual([
        "execute_tool run_tests",
        "execute_tool read_file",
        "execute_tool edit_file",
        "execute_tool run_tests",
        "execute_tool finish",
      ]);
      expect(validateSpans(c.store.index(c.runId)!.spans)).toEqual([]);
      expect(c.store.isComplete(c.runId)).toBe(true);
    });
  }

  it("records no token counts, runtime stats or cost for the scripted brain", async () => {
    const c = await runThroughPipeline();
    for (const s of c.store.index(c.runId)!.spans) {
      for (const key of Object.keys(s.attrs)) {
        expect(REPORTED_ONLY_KEYS).not.toContain(key);
        expect(key).not.toMatch(/^gen_ai\.usage\.|^app\.llm\.|cost/);
      }
    }
  });

  it("really runs the tests: the first run reports the planted bug", async () => {
    const c = await runThroughPipeline();
    const firstTests = c.store.index(c.runId)!.spans.find((s) => s.name === "execute_tool run_tests")!;
    expect(firstTests.attrs["app.test.failed"]).toBe(1);
    expect(String(firstTests.attrs["gen_ai.tool.call.result"])).toContain('expected \\"1:60\\" to be \\"1:00\\"');
    expect(firstTests.status.code).toBe(2);
    expect(firstTests.attrs["error.type"]).toBe("test_failure");
  });

  it("stops at the step cap", async () => {
    const c = await runThroughPipeline(baseRequest({ maxSteps: 2 }));
    expect(c.result.outcome).toBe("step_cap");
    const root = c.store.index(c.runId)!.roots[0];
    expect(root.attrs["app.run.outcome"]).toBe("step_cap");
    expect(root.attrs["error.type"]).toBe("step_cap");
  });
});
