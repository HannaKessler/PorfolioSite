import type { TestRequest, TestRunner } from "./protocol";
import { TestTimeoutError } from "./protocol";
import { runSuite } from "./suite";
import type { TestRunResult } from "./mini-expect";

/**
 * Runs the suite in-process from data: URLs. Used by Vitest and the sample
 * recorder, where Web Workers are unavailable. The tests still really execute.
 * A hang is modelled as an operation that never settles, so the same wall-clock
 * deadline stops it (the browser runner blocks a worker thread for real).
 */
let runCounter = 0;

export const nodeTestRunner: TestRunner = {
  run(request: TestRequest, deadlineMs: number, signal?: AbortSignal): Promise<TestRunResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new TestTimeoutError(deadlineMs)), deadlineMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      }, { once: true });
      if (request.hang) return;
      runSuite(
        request,
        // A unique suffix defeats Node's module cache, so every run re-executes the tests.
        (code) => `data:text/javascript;base64,${Buffer.from(`${code}\n// run ${++runCounter}`).toString("base64")}`,
        (url) => import(/* @vite-ignore */ url),
        globalThis as unknown as Record<string, unknown>,
      ).then(
        (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  },
};
