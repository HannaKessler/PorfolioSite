import type { RunRequest } from "./runner";
import type { RunResult } from "./loop";
import type { LoadProgress } from "../brains/webllm";

/** Main thread → agent worker. */
export type ToAgent =
  | { type: "run"; request: RunRequest; port: MessagePort }
  | { type: "step" }
  | { type: "abort" }
  | { type: "model-status"; modelId: string }
  | { type: "model-remove"; modelId: string };

/** Agent worker → main thread. */
export type FromAgent =
  | { type: "run-started"; runId: string }
  | { type: "awaiting-step"; step: number }
  | { type: "run-finished"; runId: string; result: Pick<RunResult, "outcome" | "steps" | "summary"> }
  | { type: "run-error"; runId: string; message: string }
  | { type: "model-progress"; modelId: string; progress: LoadProgress }
  | { type: "model-ready"; modelId: string }
  | { type: "model-status"; modelId: string; cached: boolean; error?: string };
