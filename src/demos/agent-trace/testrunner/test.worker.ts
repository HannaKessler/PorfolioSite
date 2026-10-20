/// <reference lib="webworker" />
import type { TestRequest, TestResponse } from "./protocol";
import { runSuite } from "./suite";

// One worker per test run: spawned, used once, then terminated by the runner.
self.onmessage = async (event: MessageEvent<TestRequest>) => {
  const request = event.data;
  if (request.hang) {
    // Fault injection: block the thread for real. Only worker.terminate() ends this.
    for (;;) {
      /* spin */
    }
  }
  const urls: string[] = [];
  try {
    const result = await runSuite(
      request,
      (code) => {
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        urls.push(url);
        return url;
      },
      (url) => import(/* @vite-ignore */ url),
      self as unknown as Record<string, unknown>,
    );
    (self as DedicatedWorkerGlobalScope).postMessage({ ok: true, result } satisfies TestResponse);
  } catch (e) {
    (self as DedicatedWorkerGlobalScope).postMessage({ ok: false, error: String(e) } satisfies TestResponse);
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
  }
};
