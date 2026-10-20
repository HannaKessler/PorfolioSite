import type { RunOptions, TestRunResult } from "./mini-expect";

/** Main → test worker. */
export interface TestRequest {
  files: Record<string, string>;
  options: RunOptions;
  /** Fault injection: the worker really blocks, so only the wall-clock timeout can stop it. */
  hang?: boolean;
}

/** Test worker → main. */
export type TestResponse = { ok: true; result: TestRunResult } | { ok: false; error: string };

/** Runs a project's tests in isolation. The browser runner uses a fresh Web Worker per call. */
export interface TestRunner {
  run(request: TestRequest, deadlineMs: number, signal?: AbortSignal): Promise<TestRunResult>;
}

export class TestTimeoutError extends Error {
  constructor(ms: number) {
    super(`Tests did not finish within ${ms} ms and were stopped`);
    this.name = "TestTimeoutError";
  }
}
