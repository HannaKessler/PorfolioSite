import type { LogEntry } from "../../filmgraph/client/api";
import { formatBytes, formatMs } from "../../filmgraph/client/metrics";

export interface LoggedRun {
  id: number;
  label: string;
  startedAt: number;
  entries: LogEntry[];
}

const shortUrl = (url: string) => url.replace("/projects/film-graph/api", "");

export function RequestLog({ runs }: { runs: LoggedRun[] }) {
  return (
    <section className="fg-section" aria-labelledby="fg-log-title">
      <div className="fg-section-head">
        <h2 id="fg-log-title">Request log</h2>
        <p>Every request in order, with a timeline bar, cache status and the SQL the server ran. Open a row for the SQL.</p>
      </div>
      {runs.length === 0 && <p className="fg-placeholder">No requests yet.</p>}
      <div className="fg-log">
        {runs.map((run) => {
          const end = Math.max(1, ...run.entries.map((entry) => entry.startedAt + entry.ms - run.startedAt));
          return (
            <article key={run.id} className="fg-log-run" aria-label={run.label}>
              <h3>
                {run.label}
                <span>
                  {run.entries.length} request{run.entries.length === 1 ? "" : "s"} · {formatMs(end)}
                </span>
              </h3>
              <ol className="fg-log-list">
                {run.entries.map((entry) => {
                  const left = ((entry.startedAt - run.startedAt) / end) * 100;
                  const width = Math.max(0.8, (entry.ms / end) * 100);
                  return (
                    <li key={entry.id} data-api={entry.api} data-status={entry.status}>
                      <details>
                        <summary>
                          <span className="fg-log-method">{entry.api === "GraphQL" ? "POST" : entry.method}</span>
                          <span className="fg-log-url" title={entry.url}>
                            {shortUrl(entry.url)}
                            {entry.persisted && <span className="fg-pill">hash</span>}
                          </span>
                          <span className="fg-log-status" data-ok={entry.status < 400}>
                            {entry.status}
                            {entry.cache === "revalidated" && <span className="fg-pill fg-pill-ok">ETag hit</span>}
                          </span>
                          <span className="fg-log-num">{formatBytes(entry.responseBytes)}</span>
                          <span className="fg-log-num">{entry.dbQueries} SQL</span>
                          <span className="fg-log-num">{formatMs(entry.ms)}</span>
                          <span className="fg-log-timeline" aria-hidden="true">
                            <span style={{ left: `${Math.min(left, 99)}%`, width: `${Math.min(width, 100 - Math.min(left, 99))}%` }} />
                          </span>
                        </summary>
                        {entry.sql.length === 0 ? (
                          <p className="fg-hint">No SQL ran for this request.</p>
                        ) : (
                          <ol className="fg-sql">
                            {entry.sql.slice(0, 40).map((event, index) => (
                              <li key={index}>
                                <code>{event.sql}</code>
                                <span>
                                  {event.rows} row{event.rows === 1 ? "" : "s"} · {formatMs(event.ms)}
                                  {event.params.length > 0 && ` · params ${JSON.stringify(event.params).slice(0, 120)}`}
                                </span>
                              </li>
                            ))}
                            {entry.sql.length > 40 && <li className="fg-hint">…and {entry.sql.length - 40} more queries.</li>}
                          </ol>
                        )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </div>
    </section>
  );
}
