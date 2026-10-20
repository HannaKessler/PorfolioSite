import type { AttrValue } from "../collector/normalize";
import { APP, GEN_AI, PAYLOAD_LIMIT, REPORTED_ONLY_KEYS } from "../tracing/attrs";
import type { DetailView } from "./url-state";
import { formatMs, nsToMs, num, type ViewSpan } from "./model";

const STATUS = ["Unset", "OK", "Error"];
const KIND = ["Unspecified", "Internal", "Server", "Client", "Producer", "Consumer"];

interface MessagePart {
  type?: string;
  content?: string;
  response?: string;
  id?: string;
}
interface SemconvMessage {
  role?: string;
  parts?: MessagePart[];
  finish_reason?: string;
}

function parseJson<T>(v: AttrValue | undefined): T | undefined {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

function pretty(v: AttrValue | undefined): string {
  if (typeof v !== "string") return JSON.stringify(v, null, 2);
  const parsed = parseJson<unknown>(v);
  return parsed === undefined ? v : JSON.stringify(parsed, null, 2);
}

function Messages({ value, title }: { value: AttrValue | undefined; title: string }) {
  const messages = parseJson<SemconvMessage[]>(value);
  if (!messages) return value === undefined ? null : <pre className="atv-pre">{String(value)}</pre>;
  return (
    <details className="atv-details" open={title === "Response"}>
      <summary>
        {title} <span className="atv-muted">({messages.length} message{messages.length === 1 ? "" : "s"})</span>
      </summary>
      <ol className="atv-messages">
        {messages.map((m, i) => (
          <li key={i}>
            <span className="atv-role">{m.role}</span>
            {(m.parts ?? []).map((p, j) => (
              <pre key={j} className="atv-pre">{p.content ?? p.response ?? JSON.stringify(p)}</pre>
            ))}
          </li>
        ))}
      </ol>
    </details>
  );
}

const USAGE_ROWS: [string, string, (v: number) => string][] = [
  [GEN_AI.usageInputTokens, "Input tokens", (v) => v.toLocaleString()],
  [GEN_AI.usageOutputTokens, "Output tokens", (v) => v.toLocaleString()],
  [APP.llmTimeToFirstTokenS, "Time to first token", (v) => formatMs(v * 1000)],
  [APP.llmTimePerOutputTokenS, "Time per output token", (v) => formatMs(v * 1000)],
  [APP.llmPrefillTokensPerS, "Prefill", (v) => `${v.toFixed(1)} tokens/s`],
  [APP.llmDecodeTokensPerS, "Decode", (v) => `${v.toFixed(1)} tokens/s`],
  [APP.llmE2eLatencyS, "Runtime end-to-end latency", (v) => formatMs(v * 1000)],
  [APP.llmGrammarInitS, "Grammar initialisation", (v) => formatMs(v * 1000)],
];

function Usage({ span }: { span: ViewSpan }) {
  const rows = USAGE_ROWS.filter(([k]) => num(span.span.attrs[k]) !== undefined);
  return (
    <section className="atv-section">
      <h4>Model usage</h4>
      {rows.length === 0 ? (
        <p className="atv-not-reported">Not reported by this brain</p>
      ) : (
        <dl className="atv-dl">
          {rows.map(([k, label, f]) => (
            <div key={k}>
              <dt>{label}</dt>
              <dd>{f(num(span.span.attrs[k])!)}</dd>
            </div>
          ))}
        </dl>
      )}
      {rows.length > 0 && <p className="atv-footnote">As reported by the model runtime.</p>}
    </section>
  );
}

/** Large payloads shown in the detail views rather than the attribute table. */
const DETAIL_PAYLOADS: [string, DetailView][] = [
  [APP.vfsFiles, "files"],
  [APP.fileBefore, "files"],
  [APP.fileAfter, "files"],
  [APP.llmRequest, "prompts"],
];

const sizeLabel = (v: AttrValue) => {
  const n = typeof v === "string" ? v.length : JSON.stringify(v).length;
  return n < 1024 ? `${n} characters` : `${(n / 1024).toFixed(1)} K characters`;
};

export function Inspector({ span, runStartNs, onClose, onShow }: { span?: ViewSpan; runStartNs: bigint; onClose?: () => void; onShow?: (view: DetailView) => void }) {
  if (!span) {
    return (
      <aside className="atv-inspector is-empty" aria-label="Span details">
        <p className="atv-muted">Select a span to see its attributes, messages and events.</p>
      </aside>
    );
  }
  const s = span.span;
  const shown = new Set<string>([GEN_AI.inputMessages, GEN_AI.outputMessages, GEN_AI.toolCallArguments, GEN_AI.toolCallResult, ...REPORTED_ONLY_KEYS, ...DETAIL_PAYLOADS.map(([k]) => k)]);
  const payloads = DETAIL_PAYLOADS.filter(([k]) => s.attrs[k] !== undefined);
  const views = new Set<DetailView>(["activity"]);
  if (span.op === "chat") views.add("prompts");
  if (payloads.length || span.tool === "edit_file") views.add("files");
  const attrs = Object.entries(s.attrs).filter(([k]) => !shown.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return (
    <aside className="atv-inspector" aria-label="Span details">
      <header className="atv-inspector-head">
        <div>
          <h3>{s.name}</h3>
          <p className="atv-muted">
            {span.endMs === null ? "Running" : formatMs(span.endMs - span.startMs)} · starts at {formatMs(span.startMs)} · {KIND[s.kind] ?? s.kind}
          </p>
        </div>
        {onClose && (
          <button type="button" className="atv-close" onClick={onClose} aria-label="Close details">
            ✕
          </button>
        )}
      </header>
      <p className="atv-chips">
        <span className={`atv-status atv-status-${s.status.code}`}>
          {s.status.code === 2 ? "✕ " : s.status.code === 1 ? "✓ " : ""}
          {STATUS[s.status.code] ?? s.status.code}
        </span>
        {span.fault && <span className="atv-badge-fault">Injected fault: {span.fault}</span>}
        {s.attrs[APP.truncated] === true && <span className="atv-chip">Payload truncated at {Math.round(PAYLOAD_LIMIT / 1024)} KB</span>}
      </p>
      {onShow && (
        <p className="atv-show-in">
          <span className="atv-label">Show in</span>
          {[...views].map((v) => (
            <button key={v} type="button" className="atv-link" onClick={() => onShow(v)}>
              {v === "activity" ? "Activity" : v === "files" ? "Files" : "Prompts"}
            </button>
          ))}
        </p>
      )}
      {s.status.message && <p className="atv-error-text">{s.status.message}</p>}

      {span.op === "chat" && (
        <>
          <Usage span={span} />
          <section className="atv-section">
            <h4>Messages</h4>
            <Messages title="Prompt" value={s.attrs[GEN_AI.inputMessages]} />
            <Messages title="Response" value={s.attrs[GEN_AI.outputMessages]} />
          </section>
        </>
      )}

      {span.op === "execute_tool" && (
        <section className="atv-section">
          <h4>Tool call</h4>
          <p className="atv-label">Arguments</p>
          <pre className="atv-pre">{pretty(s.attrs[GEN_AI.toolCallArguments])}</pre>
          {s.attrs[GEN_AI.toolCallResult] !== undefined && (
            <>
              <p className="atv-label">Result</p>
              <pre className="atv-pre">{pretty(s.attrs[GEN_AI.toolCallResult])}</pre>
            </>
          )}
        </section>
      )}

      {s.events.length > 0 && (
        <section className="atv-section">
          <h4>Events</h4>
          <ul className="atv-events">
            {s.events.map((e, i) => (
              <li key={i}>
                <strong>{e.name}</strong> <span className="atv-muted">at {formatMs(nsToMs(e.timeNs - runStartNs))}</span>
                {Object.entries(e.attrs).map(([k, v]) => (
                  <div key={k} className="atv-event-attr">
                    <code>{k}</code>: {typeof v === "string" ? v : JSON.stringify(v)}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="atv-section">
        <h4>Attributes</h4>
        <table className="atv-attrs">
          <tbody>
            <tr>
              <th scope="row">span id</th>
              <td><code>{s.spanId}</code></td>
            </tr>
            {payloads.map(([k, view]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>
                  {sizeLabel(s.attrs[k])} ·{" "}
                  <button type="button" className="atv-link" onClick={() => onShow?.(view)}>
                    shown in {view === "files" ? "Files" : "Prompts"}
                  </button>
                </td>
              </tr>
            ))}
            {attrs.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td>{typeof v === "string" ? v : JSON.stringify(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </aside>
  );
}
