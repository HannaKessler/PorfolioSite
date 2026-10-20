import type { IdGenerator, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { ChatModel } from "../brains/types";
import { ScriptedBrain } from "../brains/scripted";
import { WebLLMBrain, type LoadProgress } from "../brains/webllm";
import { createTracing } from "../tracing/setup";
import { realClock, type Clock } from "../tracing/clock";
import type { TestRunner } from "../testrunner/protocol";
import type { FaultConfig } from "./faults";
import { runAgent, type RunConfig, type RunResult, type AgentDeps } from "./loop";
import { TASK_ID, TASK_TEXT, projectFiles, type TaskVariant } from "./tasks/format-duration";
import type { ToolName } from "./protocol";

export type BrainChoice = { kind: "scripted" } | { kind: "webllm"; modelId: string; label: string };

export interface RunRequest {
  runId: string;
  variant: TaskVariant;
  brain: BrainChoice;
  seed: number;
  maxSteps: number;
  faults: FaultConfig;
  stepMode: boolean;
}

export interface BrainHooks {
  onModelProgress?: (modelId: string, progress: LoadProgress) => void;
  onModelReady?: (modelId: string) => void;
}

// A loaded WebLLM engine stays loaded between runs, so weights go to the GPU once per visit.
let loadedModel: { modelId: string; brain: Promise<ChatModel> } | undefined;

export function forgetLoadedModel(modelId: string): void {
  if (loadedModel?.modelId === modelId) loadedModel = undefined;
}

/**
 * The only module that picks a brain. Everything it hands the loop (tracer,
 * processors, test runner) is the same whichever brain is chosen.
 */
export async function createBrain(choice: BrainChoice, hooks: BrainHooks = {}): Promise<ChatModel> {
  if (choice.kind === "scripted") return new ScriptedBrain();
  const { modelId, label } = choice;
  if (loadedModel?.modelId !== modelId) {
    const brain = WebLLMBrain.create(modelId, label, (p) => hooks.onModelProgress?.(modelId, p));
    loadedModel = { modelId, brain };
    brain.then(
      () => hooks.onModelReady?.(modelId),
      () => {
        if (loadedModel?.brain === brain) loadedModel = undefined;
      },
    );
  }
  return loadedModel.brain;
}

export interface ExecuteOptions {
  model: ChatModel;
  processors: SpanProcessor[];
  testRunner: TestRunner;
  host: string;
  signal: AbortSignal;
  clock?: Clock;
  idGenerator?: IdGenerator;
  stepGate?: AgentDeps["stepGate"];
  deadlines?: Partial<Record<ToolName, number>>;
}

export async function executeRun(request: RunRequest, options: ExecuteOptions): Promise<RunResult> {
  const { provider, tracer } = createTracing({ processors: options.processors, idGenerator: options.idGenerator, host: options.host });
  const config: RunConfig = {
    runId: request.runId,
    seed: request.seed,
    maxSteps: request.maxSteps,
    faults: request.faults,
    stepMode: request.stepMode,
  };
  try {
    return await runAgent(
      { id: TASK_ID, variant: request.variant, text: TASK_TEXT, files: projectFiles(request.variant) },
      config,
      {
        model: options.model,
        tracer,
        clock: options.clock ?? realClock,
        testRunner: options.testRunner,
        signal: options.signal,
        stepGate: request.stepMode ? options.stepGate : undefined,
        deadlines: options.deadlines,
      },
    );
  } finally {
    await provider.forceFlush();
    await provider.shutdown();
  }
}
