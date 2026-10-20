import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Vfs } from "../../src/demos/agent-trace/agent/vfs";
import { executeTool } from "../../src/demos/agent-trace/agent/tools";
import { parseToolCall } from "../../src/demos/agent-trace/agent/protocol";
import { nodeTestRunner } from "../../src/demos/agent-trace/testrunner/node-runner";
import { linkModules } from "../../src/demos/agent-trace/testrunner/mini-expect";
import { BUGS, MODULE_PATH, TEST_PATH, projectFiles } from "../../src/demos/agent-trace/agent/tasks/format-duration/files";
import { TASK_TEXT } from "../../src/demos/agent-trace/agent/tasks/format-duration";

const ctx = (vfs: Vfs, deadlineMs = 1000) => ({ vfs, testRunner: nodeTestRunner, deadlineMs, signal: new AbortController().signal });

describe("virtual file system", () => {
  it("normalizes paths and snapshots files", () => {
    const vfs = new Vfs({ "src/a.js": "1" });
    expect(vfs.read("./src//a.js")).toBe("1");
    expect(vfs.read("src/x/../a.js")).toBe("1");
    vfs.write("b.js", "2");
    expect(vfs.list()).toEqual(["b.js", "src/a.js"]);
    expect(vfs.snapshot()).toEqual({ "b.js": "2", "src/a.js": "1" });
  });
});

describe("tools", () => {
  it("read_file returns contents or a not-found error", async () => {
    const vfs = new Vfs(projectFiles("rounding"));
    expect((await executeTool("read_file", { path: MODULE_PATH }, ctx(vfs))).result).toMatchObject({ path: MODULE_PATH });
    const missing = await executeTool("read_file", { path: "nope.js" }, ctx(vfs));
    expect(missing.errorType).toBe("tool_error");
    expect(missing.errorMessage).toContain("File not found");
  });

  it("edit_file rejects missing and ambiguous find strings", async () => {
    const vfs = new Vfs({ "a.js": "x x" });
    expect((await executeTool("edit_file", { path: "a.js", find: "y", replace: "z" }, ctx(vfs))).errorMessage).toBe("find string not found");
    expect((await executeTool("edit_file", { path: "a.js", find: "x", replace: "z" }, ctx(vfs))).errorMessage).toBe("find string is ambiguous (2 matches)");
    expect((await executeTool("edit_file", { path: "a.js", find: "x x", replace: "$&!" }, ctx(vfs))).result).toEqual({ ok: true, path: "a.js" });
    expect(vfs.read("a.js")).toBe("$&!");
  });

  it("run_tests really executes the project's tests", async () => {
    for (const variant of ["rounding", "padding"] as const) {
      const vfs = new Vfs(projectFiles(variant));
      const before = await executeTool("run_tests", {}, ctx(vfs));
      expect(before.tests!.failed).toBeGreaterThan(0);
      expect(before.errorType).toBe("test_failure");
      vfs.write(MODULE_PATH, vfs.read(MODULE_PATH)!.replace(BUGS[variant].buggy, BUGS[variant].fixed));
      const after = await executeTool("run_tests", {}, ctx(vfs));
      expect(after.tests).toMatchObject({ passed: 6, failed: 0 });
      expect(after.errorType).toBeUndefined();
    }
  });

  it("run_tests reports a module that does not load", async () => {
    const vfs = new Vfs({ [MODULE_PATH]: "export function formatDuration( {", [TEST_PATH]: projectFiles("rounding")[TEST_PATH] });
    const r = await executeTool("run_tests", {}, ctx(vfs));
    expect(r.errorType).toBe("test_failure");
    expect(r.result).toMatchObject({ passed: 0, failed: 0 });
    expect(String((r.result as { error: string }).error)).toMatch(/SyntaxError/);
  });

  it("aborts a hanging tool at its deadline", async () => {
    const vfs = new Vfs(projectFiles("rounding"));
    const r = await executeTool("run_tests", {}, { ...ctx(vfs, 20), fault: { hang: true } });
    expect(r.errorType).toBe("timeout");
  });

  it("links relative imports between modules", () => {
    const urls = linkModules({ "src/a.js": "export const a = 1;", "test/a.test.js": 'import { a } from "../src/a.js";' }, (c) => `url(${c})`);
    expect(urls["test/a.test.js"]).toBe('url(import { a } from "url(export const a = 1;)";)');
  });

  it("keeps the task text identical to task.md", () => {
    const md = readFileSync(new URL("../../src/demos/agent-trace/agent/tasks/format-duration/task.md", import.meta.url), "utf8");
    expect(TASK_TEXT).toBe(md.trim());
  });
});

describe("tool-call validator", () => {
  it("accepts a valid call, with or without a code fence", () => {
    expect(parseToolCall('{"tool":"read_file","args":{"path":"a.js"}}')).toEqual({ ok: true, call: { tool: "read_file", args: { path: "a.js" } } });
    expect(parseToolCall('```json\n{"tool":"run_tests","args":{},"thought":"go"}\n```')).toEqual({ ok: true, call: { tool: "run_tests", args: {}, thought: "go" } });
  });

  it("explains what is wrong with an invalid call", () => {
    expect(parseToolCall('{"tool":"read_file","args":{"pa')).toMatchObject({ ok: false, error: expect.stringContaining("not valid JSON") });
    expect(parseToolCall("[1]")).toEqual({ ok: false, error: "Reply must be a JSON object" });
    expect(parseToolCall('{"tool":"rm","args":{}}')).toMatchObject({ ok: false, error: expect.stringContaining('"tool" must be one of') });
    expect(parseToolCall('{"tool":"edit_file","args":{"path":"a","find":"x"}}')).toEqual({ ok: false, error: 'edit_file needs a string "replace" argument' });
    expect(parseToolCall('{"tool":"edit_file","args":{"path":"a","find":"","replace":"x"}}')).toMatchObject({ ok: false });
    expect(parseToolCall('{"tool":"run_tests","args":3}')).toEqual({ ok: false, error: '"args" must be an object' });
  });
});
