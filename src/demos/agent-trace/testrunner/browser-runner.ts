import type { TestRequest, TestResponse, TestRunner } from "./protocol";
import { TestTimeoutError } from "./protocol";
import type { TestRunResult } from "./mini-expect";

/** Spawns a fresh module worker per run and terminates it on finish, timeout or abort. */
export const browserTestRunner: TestRunner = {
  run(request: TestRequest, deadlineMs: number, signal?: AbortSignal): Promise<TestRunResult> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./test.worker.ts", import.meta.url), { type: "module" });
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        worker.terminate();
        fn();
      };
      const timer = setTimeout(() => finish(() => reject(new TestTimeoutError(deadlineMs))), deadlineMs);
      const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.onmessage = (e: MessageEvent<TestResponse>) =>
        finish(() => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error))));
      worker.onerror = (e) => finish(() => reject(new Error(e.message || "Test worker failed")));
      worker.postMessage(request);
    });
  },
};
