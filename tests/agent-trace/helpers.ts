import { executeRun, type RunRequest } from "../../src/demos/agent-trace/agent/runner";
import { LivePortSpanProcessor, type OtlpBatchMessage } from "../../src/demos/agent-trace/tracing/live-processor";
import { SeededIdGenerator } from "../../src/demos/agent-trace/tracing/setup";
import { nodeTestRunner } from "../../src/demos/agent-trace/testrunner/node-runner";
import { Collector } from "../../src/demos/agent-trace/collector/collector";
import { TraceStore } from "../../src/demos/agent-trace/store/trace-store";
import { ScriptedBrain } from "../../src/demos/agent-trace/brains/scripted";
import type { ChatModel } from "../../src/demos/agent-trace/brains/types";
import type { RunResult } from "../../src/demos/agent-trace/agent/loop";

/** A test-only clock that advances 1 ms per reading, for golden traces. */
export const fakeClock = (start = Date.UTC(2026, 0, 1)) => {
  let t = start;
  return () => (t += 1);
};

export const baseRequest = (over: Partial<RunRequest> = {}): RunRequest => ({
  runId: "run-test",
  variant: "rounding",
  brain: { kind: "scripted" },
  seed: 7,
  maxSteps: 12,
  faults: {},
  stepMode: false,
  ...over,
});

export interface Captured {
  result: RunResult;
  batches: OtlpBatchMessage[];
  store: TraceStore;
  runId: string;
}

/** Runs the agent through the real pipeline: OTel SDK → LivePortSpanProcessor → Collector → TraceStore. */
export async function runThroughPipeline(
  request: RunRequest = baseRequest(),
  opts: { model?: ChatModel; fake?: boolean; deadlines?: Record<string, number> } = {},
): Promise<Captured> {
  const batches: OtlpBatchMessage[] = [];
  const result = await executeRun(request, {
    model: opts.model ?? new ScriptedBrain(),
    processors: [new LivePortSpanProcessor((m) => batches.push(m), 5)],
    testRunner: nodeTestRunner,
    host: "node",
    signal: new AbortController().signal,
    ...(opts.fake === false ? {} : { clock: fakeClock(), idGenerator: new SeededIdGenerator(request.seed) }),
    deadlines: opts.deadlines,
  });
  const store = new TraceStore();
  const collector = new Collector(store);
  let runId = "";
  for (const b of batches) runId = collector.ingest(b.json, { source: "live" }).runIds[0] ?? runId;
  return { result, batches, store, runId };
}
