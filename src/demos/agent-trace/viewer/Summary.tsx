import { formatMs, type Reported, type RunSummary } from "./model";

function ReportedValue({ r, format, kind }: { r: Reported; format: (v: number) => string; kind: "total" | "mean" }) {
  if (r.m === 0 || r.n === 0) return <span className="atv-not-reported">Not reported by this brain</span>;
  const v = kind === "total" ? r.total! : r.mean!;
  return (
    <>
      {format(v)}
      {r.n < r.m && <span className="atv-muted"> (reported for {r.n} of {r.m} calls)</span>}
    </>
  );
}

const OUTCOME: Record<string, string> = {
  finished: "Finished",
  step_cap: "Stopped at the step cap",
  aborted: "Stopped",
  error: "Failed",
};

export function Summary({ summary }: { summary: RunSummary }) {
  const s = summary;
  const errorText = Object.entries(s.errorTypes).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ");
  const anyUsage = s.inputTokens.n + s.outputTokens.n + s.ttftS.n + s.prefillTps.n + s.decodeTps.n > 0;
  return (
    <section className="atv-summary" aria-label="Run summary">
      <dl className="atv-stats">
        <div>
          <dt>Outcome</dt>
          <dd>{s.outcome ? OUTCOME[s.outcome] ?? s.outcome : "Running"}</dd>
        </div>
        <div>
          <dt>Wall time</dt>
          <dd>{s.wallMs === null ? "Running" : formatMs(s.wallMs)}</dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>{s.steps}</dd>
        </div>
        <div>
          <dt>LLM calls</dt>
          <dd>{s.llmCalls}</dd>
        </div>
        <div>
          <dt>Tool calls</dt>
          <dd>{s.toolCalls}</dd>
        </div>
        <div>
          <dt>Retries</dt>
          <dd>{s.retries}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>
            {s.errors}
            {errorText && <span className="atv-muted"> ({errorText})</span>}
          </dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd>{s.tests ? `${s.tests.passed} passed, ${s.tests.failed} failed` : "Not run yet"}</dd>
        </div>
      </dl>
      <dl className="atv-stats atv-stats-usage">
        <div className="atv-stat-wide">
          <dt>Brain</dt>
          <dd>
            {s.brain ?? "Unknown"}
            {s.model && <span className="atv-muted"> · {s.model}</span>}
            {s.host && <span className="atv-muted"> · ran in {s.host === "node" ? "Node.js" : s.host}</span>}
          </dd>
        </div>
        {anyUsage ? (
          <>
            <div>
              <dt>Input tokens</dt>
              <dd><ReportedValue r={s.inputTokens} kind="total" format={(v) => v.toLocaleString()} /></dd>
            </div>
            <div>
              <dt>Output tokens</dt>
              <dd><ReportedValue r={s.outputTokens} kind="total" format={(v) => v.toLocaleString()} /></dd>
            </div>
            <div>
              <dt>Time to first token</dt>
              <dd><ReportedValue r={s.ttftS} kind="mean" format={(v) => `${formatMs(v * 1000)} mean`} /></dd>
            </div>
            <div>
              <dt>Prefill</dt>
              <dd><ReportedValue r={s.prefillTps} kind="mean" format={(v) => `${v.toFixed(1)} tokens/s mean`} /></dd>
            </div>
            <div>
              <dt>Decode</dt>
              <dd><ReportedValue r={s.decodeTps} kind="mean" format={(v) => `${v.toFixed(1)} tokens/s mean`} /></dd>
            </div>
          </>
        ) : (
          <div className="atv-stat-wide">
            <dt>Tokens and model stats</dt>
            <dd className="atv-not-reported">Not reported by this brain</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
