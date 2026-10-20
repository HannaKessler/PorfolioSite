import { useEffect, useMemo, useRef } from "react";
import { buildActivity, lineDiff, editRecord, type ActivityStep, type ModelCall, type ToolCallView } from "./details";
import { formatMs, type ViewSpan } from "./model";
import { Selectable } from "./Selectable";

const RUN_OUTCOME: Record<string, string> = {
  finished: "The agent called finish",
  step_cap: "Stopped at the step cap",
  aborted: "Stopped by the visitor",
  error: "The run failed",
};

const STEP_OUTCOME: Record<string, string> = {
  ok: "Tool result returned to the model",
  finished: "Finished the run",
  tool_error: "Tool error returned to the model",
  timeout: "Tool timed out",
  test_failure: "Failing tests returned to the model",
  invalid_output: "No valid tool call after all retries",
};

const duration = (s: ViewSpan) => (s.endMs === null ? "running" : formatMs(s.endMs - s.startMs));

function Args({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) return <span className="atv-muted">no arguments</span>;
  return (
    <dl className="atv-feed-args">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>
            <pre className="atv-pre atv-pre-inline">{typeof v === "string" ? v : JSON.stringify(v)}</pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Reasoning({ call }: { call: ModelCall }) {
  if (call.open) return <p className="atv-muted">Waiting for the brain's reply…</p>;
  if (call.policy) {
    return (
      <div className="atv-feed-policy">
        <p className="atv-feed-label">Scripted policy decision · a fixed rule, not model reasoning</p>
        <p>
          <strong>Rule:</strong> {call.policy.rule}
        </p>
        {call.policy.condition && (
          <p>
            <strong>Matched:</strong> {call.policy.condition}
          </p>
        )}
      </div>
    );
  }
  const thought = call.parsed?.ok ? call.parsed.call.thought : undefined;
  if (thought !== undefined && call.provider === "simulated") {
    // Traces recorded before the policy decision was traced: the text is a fixed string in the rule set.
    return (
      <div className="atv-feed-policy">
        <p className="atv-feed-label">Simulated brain · fixed text from its rule set, not model reasoning</p>
        <p>{thought}</p>
      </div>
    );
  }
  if (thought !== undefined) {
    return (
      <div className="atv-feed-thought">
        <p className="atv-feed-label">Model's reasoning · its own words, verbatim</p>
        <blockquote>{thought}</blockquote>
      </div>
    );
  }
  if (call.output === undefined) return <p className="atv-muted">No reply was recorded for this call.</p>;
  return <p className="atv-muted">{call.parsed?.ok ? "The reply contains no reasoning field." : "The reply could not be parsed, so no reasoning field could be read."}</p>;
}

function CallItem({ call, selectedId, onSelect, retries }: { call: ModelCall; selectedId?: string; onSelect: (id: string) => void; retries: boolean }) {
  return (
    <Selectable id={call.span.id} selectedId={selectedId} onSelect={onSelect} className={`atv-feed-item atv-feed-call${call.error ? " is-error" : ""}`}>
      <p className="atv-feed-kind">
        <span>{call.policy ? "Simulated brain" : "Model"}{retries ? ` · attempt ${call.attempt}` : ""}</span>
        <span className="atv-muted">{duration(call.span)}</span>
      </p>
      <Reasoning call={call} />
      {call.parsed?.ok && (
        <div className="atv-feed-decision">
          <p className="atv-feed-label">Tool call</p>
          <p>
            <code className="atv-feed-tool">{call.parsed.call.tool}</code>
          </p>
          <Args args={call.parsed.call.args} />
        </div>
      )}
      {call.parsed && !call.parsed.ok && (
        <div className="atv-feed-invalid">
          <p className="atv-error-text">Rejected by the validator: {call.parsed.error}</p>
          {call.fault && <p><span className="atv-badge-fault">Injected fault: {call.fault}</span></p>}
          <p className="atv-feed-label">Raw reply</p>
          <pre className="atv-pre">{call.output}</pre>
        </div>
      )}
    </Selectable>
  );
}

function ToolResult({ tool }: { tool: ToolCallView }) {
  if (tool.open) return <p className="atv-muted">Running…</p>;
  const r = tool.result;
  if (tool.tests) {
    const t = tool.tests;
    return (
      <div>
        {t.error ? (
          <p className="atv-error-text">{t.error}</p>
        ) : (
          <p className={t.failed > 0 ? "atv-error-text" : "atv-info-text"}>
            {t.passed} passed, {t.failed} failed
          </p>
        )}
        {t.failures.length > 0 && (
          <ul className="atv-feed-failures">
            {t.failures.map((f, i) => (
              <li key={i}>
                <strong>{f.name}</strong>
                <pre className="atv-pre atv-pre-inline">{f.message}</pre>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (tool.tool === "edit_file") {
    const e = editRecord(tool.span);
    if (e.applied && e.before !== undefined && e.after !== undefined) {
      const d = lineDiff(e.before, e.after);
      const add = d.filter((l) => l.type === "add").length;
      const del = d.filter((l) => l.type === "del").length;
      return (
        <p className="atv-info-text">
          Edited <code>{e.path}</code> <span className="atv-diff-count">+{add} −{del}</span>
        </p>
      );
    }
    if (e.applied) return <p className="atv-info-text">Edited <code>{e.path}</code></p>;
    return (
      <p className="atv-error-text">
        {tool.errorMessage ?? "The edit did not apply"}
        {e.matches !== undefined ? ` (${e.matches} match${e.matches === 1 ? "" : "es"} for the find text)` : ""}
      </p>
    );
  }
  if (tool.errorMessage) return <p className="atv-error-text">{tool.errorMessage}</p>;
  if (tool.tool === "read_file" && r && typeof r.contents === "string") {
    const lines = r.contents.split("\n").length - (r.contents.endsWith("\n") ? 1 : 0);
    return (
      <p>
        Read <code>{String(r.path)}</code> ({lines} line{lines === 1 ? "" : "s"})
      </p>
    );
  }
  if (tool.tool === "finish") return <p className="atv-info-text">Run ended by the agent.</p>;
  if (r) return <pre className="atv-pre">{JSON.stringify(r, null, 2)}</pre>;
  if (tool.resultRaw) return <pre className="atv-pre">{tool.resultRaw}</pre>;
  return <p className="atv-muted">No result was recorded.</p>;
}

function ToolItem({ tool, selectedId, onSelect }: { tool: ToolCallView; selectedId?: string; onSelect: (id: string) => void }) {
  return (
    <Selectable id={tool.span.id} selectedId={selectedId} onSelect={onSelect} className={`atv-feed-item atv-feed-toolrun${tool.errorType ? " is-error" : ""}`}>
      <p className="atv-feed-kind">
        <span>
          Tool · <code className="atv-feed-tool">{tool.tool}</code>
          {tool.attempt > 1 ? ` · attempt ${tool.attempt}` : ""}
          {tool.fault && <> <span className="atv-badge-fault">Injected fault: {tool.fault}</span></>}
        </span>
        <span className="atv-muted">{duration(tool.span)}</span>
      </p>
      <ToolResult tool={tool} />
    </Selectable>
  );
}

function StepItem({ step, selectedId, onSelect, active }: { step: ActivityStep; selectedId?: string; onSelect: (id: string) => void; active: boolean }) {
  const retries = step.calls.length > 1;
  return (
    <li className={`atv-feed-step${active ? " is-active" : ""}${step.isError ? " is-error" : ""}${step.open ? " is-open" : ""}`}>
      <Selectable id={step.span.id} selectedId={selectedId} onSelect={onSelect} className="atv-feed-head">
        <span className="atv-feed-step-title">Step {step.index}</span>
        <span className="atv-muted">
          at {formatMs(step.span.startMs)} · {duration(step.span)}
        </span>
      </Selectable>
      {step.pause && (
        <Selectable id={step.pause.id} selectedId={selectedId} onSelect={onSelect} className="atv-feed-item atv-feed-pause">
          <p className="atv-muted">Step mode: waited {duration(step.pause)} for the visitor to allow this step.</p>
        </Selectable>
      )}
      {step.calls.map((c) => (
        <CallItem key={c.span.id} call={c} selectedId={selectedId} onSelect={onSelect} retries={retries} />
      ))}
      {step.tools.map((t) => (
        <ToolItem key={t.span.id} tool={t} selectedId={selectedId} onSelect={onSelect} />
      ))}
      {step.outcome && (
        <p className={`atv-feed-outcome${step.isError ? " atv-error-text" : ""}`}>
          {STEP_OUTCOME[step.outcome] ?? step.outcome}
          {step.error && step.outcome !== "tool_error" ? `: ${step.error}` : ""}
        </p>
      )}
    </li>
  );
}

/** A readable transcript of the run, step by step, built from the spans. */
export function ActivityFeed({ spans, selectedId, onSelect, live }: { spans: ViewSpan[]; selectedId?: string; onSelect: (id: string) => void; live: boolean }) {
  const activity = useMemo(() => buildActivity(spans), [spans]);
  const box = useRef<HTMLDivElement>(null);
  const activeStep = activity.steps.find(
    (s) => s.span.id === selectedId || s.pause?.id === selectedId || s.calls.some((c) => c.span.id === selectedId) || s.tools.some((t) => t.span.id === selectedId),
  );

  // Keep the selected item in view (selection made in the timeline or inspector).
  useEffect(() => {
    const el = selectedId ? box.current?.querySelector<HTMLElement>(`[data-span="${selectedId}"]`) : null;
    const c = box.current;
    if (!el || !c) return;
    const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
    if (top < c.scrollTop || top + el.offsetHeight > c.scrollTop + c.clientHeight) c.scrollTo({ top: Math.max(0, top - 12) });
  }, [selectedId]);

  // While a run is live and nothing is selected, follow the newest step.
  const count = spans.length;
  useEffect(() => {
    if (live && !selectedId && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [live, selectedId, count]);

  const root = activity.root;
  return (
    <div className="atv-feed" ref={box}>
      {activity.steps.length === 0 ? (
        <p className="atv-muted">{root ? "No steps yet at this point in the run." : "No agent run in this trace."}</p>
      ) : (
        <ol className="atv-feed-list">
          {activity.steps.map((s) => (
            <StepItem key={s.span.id} step={s} selectedId={selectedId} onSelect={onSelect} active={s === activeStep} />
          ))}
        </ol>
      )}
      {root && (
        <Selectable id={root.id} selectedId={selectedId} onSelect={onSelect} className={`atv-feed-item atv-feed-end${root.isError ? " is-error" : ""}`}>
          {activity.outcome ? (
            <p>
              <strong>{RUN_OUTCOME[activity.outcome] ?? activity.outcome}</strong>
              {root.endMs !== null && <span className="atv-muted"> · after {formatMs(root.endMs - root.startMs)}</span>}
            </p>
          ) : (
            <p className="atv-muted">{live ? "Run in progress…" : "The run has not ended at this point."}</p>
          )}
        </Selectable>
      )}
    </div>
  );
}
