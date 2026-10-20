/**
 * Records the bundled sample traces by driving the real agent through the real
 * pipeline (OpenTelemetry SDK → LivePortSpanProcessor → Collector → TraceStore)
 * and saving the store's OTLP-JSON export. Timings are real measurements of this
 * run on this machine; nothing is edited afterwards.
 *
 *   npm run agenttrace:samples
 *
 * The WebLLM sample is recorded by hand in Chrome with the viewer's Export button.
 */
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { executeRun, createBrain, type RunRequest } from "../src/demos/agent-trace/agent/runner";
import { LivePortSpanProcessor, type OtlpBatchMessage } from "../src/demos/agent-trace/tracing/live-processor";
import { nodeTestRunner } from "../src/demos/agent-trace/testrunner/node-runner";
import { Collector } from "../src/demos/agent-trace/collector/collector";
import { TraceStore } from "../src/demos/agent-trace/store/trace-store";

const SAMPLES: { name: string; request: Omit<RunRequest, "runId" | "brain"> }[] = [
  { name: "scripted-clean", request: { variant: "rounding", seed: 1, maxSteps: 12, faults: {}, stepMode: false } },
  { name: "scripted-flaky", request: { variant: "padding", seed: 2, maxSteps: 12, faults: { flakyTest: true }, stepMode: false } },
  { name: "scripted-malformed", request: { variant: "rounding", seed: 3, maxSteps: 12, faults: { malformedOutput: true }, stepMode: false } },
];

for (const sample of SAMPLES) {
  const request: RunRequest = { ...sample.request, runId: randomUUID(), brain: { kind: "scripted" } };
  const batches: OtlpBatchMessage[] = [];
  const result = await executeRun(request, {
    model: await createBrain(request.brain),
    processors: [new LivePortSpanProcessor((m) => batches.push(m))],
    testRunner: nodeTestRunner,
    host: "node",
    signal: new AbortController().signal,
  });
  const store = new TraceStore();
  const collector = new Collector(store);
  let runId = "";
  for (const b of batches) runId = collector.ingest(b.json, { source: "live" }).runIds[0] ?? runId;
  if (!store.isComplete(runId)) throw new Error(`${sample.name}: trace is incomplete`);
  const path = new URL(`../src/demos/agent-trace/samples/${sample.name}.otlp.json`, import.meta.url);
  writeFileSync(path, `${JSON.stringify(store.exportOtlp(runId), null, 1)}\n`);
  console.log(`${sample.name}: ${result.outcome} in ${result.steps} steps, ${store.get(runId)!.spans.size} spans`);
}
