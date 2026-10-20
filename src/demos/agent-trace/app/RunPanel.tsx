import { useEffect, useRef, useState } from "react";
import type { AgentClient } from "../agent/client";
import type { Collector } from "../collector/collector";
import type { TraceStore } from "../store/trace-store";
import { saveRun } from "../store/idb";
import type { RunRequest } from "../agent/runner";
import type { FromAgent } from "../agent/worker-protocol";
import type { ToolName } from "../agent/protocol";
import { DEFAULT_MAX_STEPS } from "../agent/loop";
import { checkWebGPU, type Capability } from "../brains/capability";
import { DEFAULT_MODEL_ID, MODEL_OPTIONS, resolveModel } from "../brains/models";

type Status = "idle" | "loading-model" | "running" | "awaiting-step";

interface Props {
  client: () => AgentClient;
  store: TraceStore;
  collector: Collector;
  onRunStarted: (runId: string) => void;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** Controls for starting the agent. The monitor below never sees which brain was chosen, only the spans. */
export function RunPanel({ client, store, collector, onRunStarted }: Props) {
  const [brain, setBrain] = useState<"scripted" | "webllm">("scripted");
  const [variant, setVariant] = useState<RunRequest["variant"]>("rounding");
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [stepMode, setStepMode] = useState(false);
  const [flaky, setFlaky] = useState(false);
  const [malformed, setMalformed] = useState(false);
  const [timeoutTool, setTimeoutTool] = useState<ToolName | "">("");
  const [seedText, setSeedText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>();
  const [capability, setCapability] = useState<Capability>();
  const [modelOption, setModelOption] = useState(DEFAULT_MODEL_ID);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<{ text: string; progress: number }>();
  const current = useRef<{ request: RunRequest; disconnect: () => void; runId?: string }>(undefined);

  const option = MODEL_OPTIONS.find((m) => m.id === modelOption) ?? MODEL_OPTIONS[0];
  const resolved = resolveModel(option, capability?.shaderF16 ?? true);

  useEffect(() => {
    if (brain === "webllm" && !capability) void checkWebGPU().then(setCapability);
  }, [brain, capability]);

  useEffect(() => {
    if (brain === "webllm" && capability?.ok) client().modelStatus(resolved.modelId);
  }, [brain, capability, resolved.modelId]);

  useEffect(() => {
    return client().on((msg: FromAgent) => {
      switch (msg.type) {
        case "model-status":
          setCached((c) => ({ ...c, [msg.modelId]: msg.cached }));
          break;
        case "model-progress":
          setStatus("loading-model");
          setProgress(msg.progress);
          break;
        case "model-ready":
          setCached((c) => ({ ...c, [msg.modelId]: true }));
          setProgress(undefined);
          break;
        case "run-started":
          setStatus("running");
          break;
        case "awaiting-step":
          setStatus("awaiting-step");
          setMessage(`Paused before step ${msg.step}.`);
          break;
        case "run-finished":
        case "run-error": {
          const run = current.current;
          setStatus("idle");
          setProgress(undefined);
          setMessage(
            msg.type === "run-error"
              ? `The run failed: ${msg.message}`
              : msg.result.outcome === "finished"
                ? `Finished in ${msg.result.steps} steps.`
                : msg.result.outcome === "step_cap"
                  ? `Stopped at the step cap (${msg.result.steps} steps).`
                  : "Run stopped.",
          );
          if (run) void persistWhenComplete(run);
          break;
        }
      }
    });
  }, []);

  /** Saves the finished run to IndexedDB once its last spans have been ingested. */
  const persistWhenComplete = async (run: NonNullable<typeof current.current>) => {
    for (let i = 0; i < 40; i++) {
      if (run.runId && store.isComplete(run.runId)) {
        await saveRun({ runId: run.runId, source: "live", savedAt: Date.now(), otlp: store.exportOtlp(run.runId) });
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    run.disconnect();
  };

  const start = () => {
    if (status !== "idle") return;
    const seed = seedText.trim() === "" ? randomSeed() : Math.abs(Math.floor(Number(seedText))) || 0;
    const request: RunRequest = {
      runId: crypto.randomUUID(),
      variant,
      brain: brain === "scripted" ? { kind: "scripted" } : { kind: "webllm", modelId: resolved.modelId, label: option.label },
      seed,
      maxSteps,
      faults: { flakyTest: flaky, malformedOutput: malformed, ...(timeoutTool ? { toolTimeout: timeoutTool } : {}) },
      stepMode,
    };
    setMessage(undefined);
    setStatus(brain === "webllm" ? "loading-model" : "running");
    const entry: NonNullable<typeof current.current> = { request, disconnect: () => {} };
    current.current = entry;
    entry.disconnect = client().run(request, collector, (runId) => {
      entry.runId = runId;
      onRunStarted(runId);
    });
  };

  const busy = status !== "idle";
  const webllmBlocked = brain === "webllm" && (!capability || !capability.ok);

  return (
    <section className="atv-runpanel" aria-label="Run the agent">
      <div className="atv-runpanel-grid">
        <fieldset className="atv-fieldset">
          <legend>Brain</legend>
          <label className="atv-radio">
            <input type="radio" name="atv-brain" checked={brain === "scripted"} disabled={busy} onChange={() => setBrain("scripted")} />
            Simulated brain <span className="atv-muted">(a deterministic rule set; no download)</span>
          </label>
          <label className="atv-radio">
            <input type="radio" name="atv-brain" checked={brain === "webllm"} disabled={busy} onChange={() => setBrain("webllm")} />
            Real model in your browser <span className="atv-muted">(WebLLM, WebGPU)</span>
          </label>
          {brain === "webllm" && (
            <div className="atv-model">
              {!capability ? (
                <p className="atv-muted">Checking WebGPU support…</p>
              ) : !capability.ok ? (
                <p className="atv-warning">{capability.reason} The simulated brain works on every device.</p>
              ) : (
                <>
                  <label className="atv-field">
                    <span>Model</span>
                    <select value={modelOption} disabled={busy} onChange={(e) => setModelOption(e.target.value)}>
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.id === DEFAULT_MODEL_ID ? " (default)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="atv-footnote">
                    <code>{resolved.modelId}</code> · download {resolved.downloadLabel} · needs about{" "}
                    {resolved.vramMB.toLocaleString()} MB of GPU memory.
                    {!capability.shaderF16 && " Your GPU lacks shader-f16, so the 32-bit build is used."} The model is cached by your browser after the first
                    download.
                  </p>
                  {cached[resolved.modelId] && (
                    <p className="atv-footnote">
                      Already downloaded.{" "}
                      <button type="button" className="atv-link" disabled={busy} onClick={() => client().removeModel(resolved.modelId)}>
                        Remove model
                      </button>
                    </p>
                  )}
                  {progress && (
                    <div className="atv-progress" role="status">
                      <progress max={1} value={progress.progress} />
                      <span>{progress.text}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="atv-fieldset">
          <legend>Task and limits</legend>
          <label className="atv-field">
            <span>Planted bug</span>
            <select value={variant} disabled={busy} onChange={(e) => setVariant(e.target.value as RunRequest["variant"])}>
              <option value="rounding">Rounding (59.6 s shows as 1:60)</option>
              <option value="padding">Padding (65 s shows as 1:5)</option>
            </select>
          </label>
          <label className="atv-field">
            <span>Step cap</span>
            <input type="number" min={1} max={40} value={maxSteps} disabled={busy} onChange={(e) => setMaxSteps(Math.max(1, Math.min(40, Number(e.target.value) || 1)))} />
          </label>
          <label className="atv-field">
            <span>Seed</span>
            <input inputMode="numeric" placeholder="Random" value={seedText} disabled={busy} onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="atv-check">
            <input type="checkbox" checked={stepMode} disabled={busy} onChange={(e) => setStepMode(e.target.checked)} /> Step mode (pause before each step)
          </label>
        </fieldset>

        <fieldset className="atv-fieldset">
          <legend>Inject faults</legend>
          <label className="atv-check">
            <input type="checkbox" checked={flaky} disabled={busy} onChange={(e) => setFlaky(e.target.checked)} /> Flaky test on the first test run
          </label>
          <label className="atv-check">
            <input type="checkbox" checked={malformed} disabled={busy} onChange={(e) => setMalformed(e.target.checked)} /> Malformed model output (second reply)
          </label>
          <label className="atv-field">
            <span>Tool timeout</span>
            <select value={timeoutTool} disabled={busy} onChange={(e) => setTimeoutTool(e.target.value as ToolName | "")}>
              <option value="">None</option>
              <option value="run_tests">run_tests</option>
              <option value="read_file">read_file</option>
              <option value="edit_file">edit_file</option>
            </select>
          </label>
        </fieldset>
      </div>

      <div className="atv-runbar">
        <button type="button" className="atv-run" onClick={start} disabled={busy || webllmBlocked}>
          {brain === "scripted" ? "Run the agent" : cached[resolved.modelId] ? "Run with a real model" : "Download and run with a real model"}
        </button>
        {status === "awaiting-step" && (
          <button type="button" className="atv-btn" onClick={() => { setStatus("running"); setMessage(undefined); client().step(); }}>
            Next step
          </button>
        )}
        {busy && (
          <button type="button" className="atv-btn" onClick={() => client().abort()}>
            Stop
          </button>
        )}
        <span className="atv-run-status" role="status">
          {status === "loading-model" ? "Loading the model…" : status === "running" ? "Running…" : message}
        </span>
      </div>
    </section>
  );
}
