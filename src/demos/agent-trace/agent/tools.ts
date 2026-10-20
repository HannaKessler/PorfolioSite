import type { ToolDef } from "../brains/types";
import type { TestRunner } from "../testrunner/protocol";
import { TestTimeoutError } from "../testrunner/protocol";
import type { TestRunResult } from "../testrunner/mini-expect";
import type { ToolName } from "./protocol";
import type { Vfs } from "./vfs";

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Read a file from the project.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "edit_file",
    description: "Replace the only occurrence of `find` in a file with `replace`.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" } },
      required: ["path", "find", "replace"],
    },
  },
  {
    name: "run_tests",
    description: "Run the project's test suite and report passes and failures.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "finish",
    description: "End the run with a one-sentence summary of the fix.",
    parameters: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  },
];

export const DEFAULT_DEADLINES_MS: Record<ToolName, number> = {
  read_file: 1000,
  edit_file: 1000,
  run_tests: 3000,
  finish: 1000,
};

export interface ToolContext {
  vfs: Vfs;
  testRunner: TestRunner;
  deadlineMs: number;
  signal: AbortSignal;
  /** Fault injection for this call only. */
  fault?: { hang?: boolean; forceFailPick?: number };
}

export type ToolErrorType = "tool_error" | "test_failure" | "timeout";

export interface ToolOutcome {
  /** JSON-serialisable result returned to the model. */
  result: unknown;
  errorType?: ToolErrorType;
  errorMessage?: string;
  tests?: TestRunResult;
  finished?: boolean;
  /** edit_file only: the file before the call, after it (when the edit applied), and the match count. */
  file?: { path: string; before?: string; after?: string; matches?: number };
}

class ToolTimeoutError extends Error {
  constructor(ms: number) {
    super(`Tool did not finish within ${ms} ms and was aborted`);
  }
}

/** Resolves when `signal` aborts; used to really block a tool until its deadline. */
const blockUntilAborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

async function runTool(name: ToolName, args: Record<string, string>, ctx: ToolContext, signal: AbortSignal): Promise<ToolOutcome> {
  if (ctx.fault?.hang && name !== "run_tests") await blockUntilAborted(signal);
  switch (name) {
    case "read_file": {
      const contents = ctx.vfs.read(args.path);
      if (contents === undefined) {
        const message = `File not found: ${args.path}. Files: ${ctx.vfs.list().join(", ")}`;
        return { result: { error: message }, errorType: "tool_error", errorMessage: message };
      }
      return { result: { path: args.path, contents } };
    }
    case "edit_file": {
      const contents = ctx.vfs.read(args.path);
      if (contents === undefined) {
        const message = `File not found: ${args.path}`;
        return { result: { error: message }, errorType: "tool_error", errorMessage: message, file: { path: args.path } };
      }
      const n = countOccurrences(contents, args.find);
      if (n !== 1) {
        const message = n === 0 ? "find string not found" : `find string is ambiguous (${n} matches)`;
        return { result: { error: message }, errorType: "tool_error", errorMessage: message, file: { path: args.path, before: contents, matches: n } };
      }
      const after = contents.replace(args.find, () => args.replace);
      ctx.vfs.write(args.path, after);
      return { result: { ok: true, path: args.path }, file: { path: args.path, before: contents, after, matches: 1 } };
    }
    case "run_tests": {
      try {
        const tests = await ctx.testRunner.run(
          { files: ctx.vfs.snapshot(), options: { forceFailPick: ctx.fault?.forceFailPick }, hang: ctx.fault?.hang },
          ctx.deadlineMs,
          signal,
        );
        const result = tests.error
          ? { passed: 0, failed: 0, failures: [], error: tests.error }
          : { passed: tests.passed, failed: tests.failed, failures: tests.failures };
        if (tests.error) return { result, tests, errorType: "test_failure", errorMessage: tests.error };
        if (tests.failed > 0) return { result, tests, errorType: "test_failure", errorMessage: `${tests.failed} test(s) failed` };
        return { result, tests };
      } catch (e) {
        if (e instanceof TestTimeoutError) throw new ToolTimeoutError(ctx.deadlineMs);
        throw e;
      }
    }
    case "finish":
      return { result: { ok: true }, finished: true };
  }
}

/**
 * Executes one tool call under a wall-clock deadline. Tool errors come back as
 * results for the model; only timeouts and aborts are distinguished here.
 */
export async function executeTool(name: ToolName, args: Record<string, string>, ctx: ToolContext): Promise<ToolOutcome> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(ctx.signal.reason);
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new ToolTimeoutError(ctx.deadlineMs);
      controller.abort(err);
      reject(err);
    }, ctx.deadlineMs);
  });
  try {
    return await Promise.race([runTool(name, args, ctx, controller.signal), deadline]);
  } catch (e) {
    if (e instanceof ToolTimeoutError) {
      return { result: { error: e.message }, errorType: "timeout", errorMessage: e.message };
    }
    throw e;
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
