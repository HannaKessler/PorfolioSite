import type { Run, TraceStore } from "../store/trace-store";
import { align } from "./align";
import { runLabel } from "./labels";
import { buildViewSpans, formatMs, summarize, type RunSummary, type ViewSpan } from "./model";

const token = (s: ViewSpan) => (s.op === "execute_tool" ? `execute_tool:${s.tool}` : s.op);
const steps = (spans: ViewSpan[]) => spans.filter((s) => s.op === "chat" || s.op === "execute_tool");

function delta(a: number | null | undefined, b: number | null | undefined, f: (v: number) => string) {
  if (a == null || b == null) return "–";
  const d = b - a;
  return `${d > 0 ? "+" : d < 0 ? "−" : "±"}${f(Math.abs(d))}`;
}

const fullTokens = (s: RunSummary) =>
  s.inputTokens.m > 0 && s.inputTokens.n === s.inputTokens.m && s.outputTokens.n === s.outputTokens.m ? s.inputTokens.total! + s.outputTokens.total! : undefined;


/** Two runs side by side, aligned with Needleman–Wunsch over (operation, tool) tokens. */
export function Compare({ store, a, b }: { store: TraceStore; a: Run; b: Run }) {
  const ia = store.index(a.id);
  const ib = store.index(b.id);
  if (!ia || !ib) return null;
  const va = buildViewSpans(ia);
  const vb = buildViewSpans(ib);
  const sa = summarize(va);
  const sb = summarize(vb);
  const rows = align(steps(va), steps(vb), token);
  const tokensA = fullTokens(sa);
  const tokensB = fullTokens(sb);
  return (
    <section className="atv-compare" aria-label="Compare runs">
      <dl className="atv-stats">
        <div>
          <dt>Wall time</dt>
          <dd>
            {sa.wallMs === null ? "–" : formatMs(sa.wallMs)} → {sb.wallMs === null ? "–" : formatMs(sb.wallMs)}{" "}
            <span className="atv-muted">({delta(sa.wallMs, sb.wallMs, formatMs)})</span>
          </dd>
        </div>
        <div>
          <dt>Steps</dt>
          <dd>
            {sa.steps} → {sb.steps} <span className="atv-muted">({delta(sa.steps, sb.steps, String)})</span>
          </dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd>
            {sa.errors} → {sb.errors} <span className="atv-muted">({delta(sa.errors, sb.errors, String)})</span>
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {tokensA !== undefined && tokensB !== undefined ? (
              <>
                {tokensA.toLocaleString()} → {tokensB.toLocaleString()}{" "}
                <span className="atv-muted">({delta(tokensA, tokensB, (v) => v.toLocaleString())})</span>
              </>
            ) : (
              <span className="atv-not-reported">Not reported for both runs</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="atv-table-wrap">
        <table className="atv-table atv-align">
          <thead>
            <tr>
              <th scope="col">{runLabel(store, a)}</th>
              <th scope="col" className="num">Duration</th>
              <th scope="col">{runLabel(store, b)}</th>
              <th scope="col" className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([x, y], i) => {
              const diverge = !x || !y || token(x) !== token(y);
              return (
                <tr key={i} className={diverge ? "is-diverged" : undefined}>
                  <td>{x ? <SpanCell s={x} /> : <span className="atv-gap">gap</span>}</td>
                  <td className="num">{x?.endMs != null ? formatMs(x.endMs - x.startMs) : ""}</td>
                  <td>{y ? <SpanCell s={y} /> : <span className="atv-gap">gap</span>}</td>
                  <td className="num">{y?.endMs != null ? formatMs(y.endMs - y.startMs) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SpanCell({ s }: { s: ViewSpan }) {
  return (
    <>
      {s.isError && <span className="atv-icon atv-icon-error" title="Error">✕ </span>}
      {s.op === "execute_tool" ? s.tool : "chat"}
      {s.fault && <span className="atv-badge-fault"> fault</span>}
    </>
  );
}
