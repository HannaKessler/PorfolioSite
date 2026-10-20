import { useEffect, useMemo, useRef, useState } from "react";
import { PAYLOAD_LIMIT } from "../tracing/attrs";
import { modelCall, parseJson, type ModelCall } from "./details";
import { CopyButton } from "./CopyButton";
import { formatMs, type ViewSpan } from "./model";

const KB = Math.round(PAYLOAD_LIMIT / 1024);

function pretty(text: string): string {
  const v = parseJson(text);
  return v === undefined ? text : JSON.stringify(v, null, 2);
}

function verdict(c: ModelCall) {
  if (c.open) return <span className="atv-chip">waiting</span>;
  if (!c.parsed) return <span className="atv-chip">no reply</span>;
  return c.parsed.ok ? <span className="atv-status atv-status-1">valid: {c.parsed.call.tool}</span> : <span className="atv-status atv-status-2">invalid</span>;
}

function Call({ call, open, onToggle, onSelect, selected }: { call: ModelCall; open: boolean; onToggle: (open: boolean) => void; onSelect: () => void; selected: boolean }) {
  const simulated = call.provider === "simulated";
  return (
    <details
      className={`atv-call${selected ? " is-selected" : ""}`}
      data-span={call.span.id}
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary onClick={onSelect}>
        <span className="atv-call-title">
          Step {call.step ?? "?"}
          {call.attempt > 1 ? ` · attempt ${call.attempt}` : ""}
        </span>
        <span className="atv-muted atv-call-meta">
          {call.model} · {call.open ? "running" : formatMs((call.span.endMs ?? 0) - call.span.startMs)}
          {call.finishReason ? ` · finish: ${call.finishReason}` : ""}
        </span>
        {verdict(call)}
        {call.fault && <span className="atv-badge-fault">Injected fault: {call.fault}</span>}
      </summary>
      {open && (
        <div className="atv-call-body">
          <p className="atv-footnote">
            {simulated
              ? "The simulated brain received this message list as a function argument and returned the reply below. No model was involved."
              : "The brain received this message list. The exact request body it sent to the WebLLM engine is further down."}
          </p>
          {call.truncated && <p className="atv-warning">Part of this call was truncated at {KB} KB when it was recorded.</p>}

          <section className="atv-call-section">
            <div className="atv-call-section-head">
              <h4>Messages sent{call.messages ? ` (${call.messages.length})` : ""}</h4>
              {call.messages && <CopyButton text={JSON.stringify(call.messages.map(({ role, text, toolCallId }) => (toolCallId ? { role, toolCallId, content: text } : { role, content: text })), null, 2)} label="Copy all" />}
            </div>
            {call.messages ? (
              <ol className="atv-msgs">
                {call.messages.map((m, i) => (
                  <li key={i} className={`atv-msg atv-msg-${m.role}`}>
                    <div className="atv-msg-head">
                      <span className="atv-role">{m.role}</span>
                      {m.toolCallId && <span className="atv-muted">result for {m.toolCallId}</span>}
                      <CopyButton text={m.text} />
                    </div>
                    <pre className="atv-pre">{m.text}</pre>
                  </li>
                ))}
              </ol>
            ) : call.messagesRaw !== undefined ? (
              <>
                <p className="atv-muted">The recorded message list could not be parsed; this is the recorded text.</p>
                <pre className="atv-pre">{call.messagesRaw}</pre>
              </>
            ) : (
              <p className="atv-muted">This trace did not record the messages for this call.</p>
            )}
          </section>

          {call.request !== undefined && (
            <details className="atv-call-section atv-details">
              <summary>Exact request body sent to WebLLM</summary>
              <div className="atv-call-section-head">
                <span className="atv-footnote">Tool results are sent as user turns, because these models have no tool role in WebLLM.</span>
                <CopyButton text={pretty(call.request)} />
              </div>
              <pre className="atv-pre">{pretty(call.request)}</pre>
            </details>
          )}

          <section className="atv-call-section">
            <div className="atv-call-section-head">
              <h4>Raw reply, before parsing</h4>
              {call.output !== undefined && <CopyButton text={call.output} />}
            </div>
            {call.output !== undefined ? (
              <pre className="atv-pre">{call.output}</pre>
            ) : (
              <p className="atv-muted">{call.open ? "Waiting for the reply…" : "No reply was recorded (the call was stopped)."}</p>
            )}
            {call.parsed && !call.parsed.ok && <p className="atv-error-text">Rejected by the validator: {call.parsed.error}</p>}
            {call.parsed?.ok && (
              <p className="atv-info-text">
                Accepted by the validator as a <code>{call.parsed.call.tool}</code> call.
              </p>
            )}
          </section>

          {call.policy && (
            <section className="atv-call-section">
              <h4>Scripted policy decision</h4>
              <p>
                <strong>Rule:</strong> {call.policy.rule}
              </p>
              <p>
                <strong>Matched:</strong> {call.policy.condition}
              </p>
            </section>
          )}
        </div>
      )}
    </details>
  );
}

/** Every model call in the run with its full prompt and raw reply. */
export function ModelCalls({ spans, selectedId, onSelect }: { spans: ViewSpan[]; selectedId?: string; onSelect: (id: string) => void }) {
  const calls = useMemo(() => spans.filter((s) => s.op === "chat").sort((a, b) => a.startMs - b.startMs).map(modelCall), [spans]);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);

  // Selecting a chat span elsewhere opens and reveals its call.
  useEffect(() => {
    if (!selectedId || !calls.some((c) => c.span.id === selectedId)) return;
    setOpenIds((s) => (s.has(selectedId) ? s : new Set([...s, selectedId])));
    requestAnimationFrame(() => {
      const el = box.current?.querySelector<HTMLElement>(`[data-span="${selectedId}"]`);
      const c = box.current;
      if (el && c) c.scrollTo({ top: Math.max(0, el.offsetTop - 8) });
    });
  }, [selectedId, calls.length]);

  if (calls.length === 0) return <p className="atv-muted">No model calls at this point in the run.</p>;
  return (
    <div className="atv-calls" ref={box}>
      {calls.map((c) => (
        <Call
          key={c.span.id}
          call={c}
          open={openIds.has(c.span.id)}
          selected={c.span.id === selectedId}
          onSelect={() => onSelect(c.span.id)}
          onToggle={(open) =>
            setOpenIds((s) => {
              if (open === s.has(c.span.id)) return s;
              const next = new Set(s);
              if (open) next.add(c.span.id);
              else next.delete(c.span.id);
              return next;
            })
          }
        />
      ))}
    </div>
  );
}
