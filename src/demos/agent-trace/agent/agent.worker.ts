/// <reference lib="webworker" />
import { LivePortSpanProcessor } from "../tracing/live-processor";
import { browserTestRunner } from "../testrunner/browser-runner";
import { isModelCached, removeModel, type LoadProgress } from "../brains/webllm";
import { createBrain, executeRun, forgetLoadedModel } from "./runner";
import type { FromAgent, ToAgent } from "./worker-protocol";

const post = (msg: FromAgent) => (self as DedicatedWorkerGlobalScope).postMessage(msg);

const hooks = {
  onModelProgress: (modelId: string, progress: LoadProgress) => post({ type: "model-progress", modelId, progress }),
  onModelReady: (modelId: string) => post({ type: "model-ready", modelId }),
};

let controller: AbortController | undefined;
let releaseStep: (() => void) | undefined;

self.onmessage = async (event: MessageEvent<ToAgent>) => {
  const msg = event.data;
  switch (msg.type) {
    case "run": {
      controller?.abort();
      const ctrl = new AbortController();
      controller = ctrl;
      const { request, port } = msg;
      try {
        const model = await createBrain(request.brain, hooks);
        post({ type: "run-started", runId: request.runId });
        const result = await executeRun(request, {
          model,
          processors: [new LivePortSpanProcessor((m) => port.postMessage(m))],
          testRunner: browserTestRunner,
          host: "browser",
          signal: ctrl.signal,
          stepGate: (step) =>
            new Promise<void>((resolve) => {
              releaseStep = resolve;
              ctrl.signal.addEventListener("abort", () => resolve(), { once: true });
              post({ type: "awaiting-step", step });
            }),
        });
        post({ type: "run-finished", runId: request.runId, result: { outcome: result.outcome, steps: result.steps, summary: result.summary } });
      } catch (e) {
        post({ type: "run-error", runId: request.runId, message: e instanceof Error ? e.message : String(e) });
      } finally {
        port.close();
        if (controller === ctrl) controller = undefined;
      }
      break;
    }
    case "step":
      releaseStep?.();
      releaseStep = undefined;
      break;
    case "abort":
      controller?.abort(new DOMException("Run stopped", "AbortError"));
      break;
    case "model-status":
      try {
        post({ type: "model-status", modelId: msg.modelId, cached: await isModelCached(msg.modelId) });
      } catch (e) {
        post({ type: "model-status", modelId: msg.modelId, cached: false, error: String(e) });
      }
      break;
    case "model-remove":
      try {
        forgetLoadedModel(msg.modelId);
        await removeModel(msg.modelId);
      } finally {
        post({ type: "model-status", modelId: msg.modelId, cached: false });
      }
      break;
  }
};
