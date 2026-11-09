import { CLIENT_TIMEOUT_MS } from "./config";
import type { FallbackReason } from "./types";

export interface TimedResult<T> {
  value: T | null;
  elapsedMs: number;
  fallback: Exclude<FallbackReason, "ok"> | null;
}

/** Measures wall time around work and aborts it when `budgetMs` elapses. */
export async function withBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  budgetMs = CLIENT_TIMEOUT_MS,
): Promise<TimedResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const value = await work(controller.signal);
    return { value, elapsedMs: performance.now() - started, fallback: null };
  } catch (error) {
    const elapsedMs = performance.now() - started;
    if (controller.signal.aborted) {
      return { value: null, elapsedMs, fallback: "timeout" };
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
