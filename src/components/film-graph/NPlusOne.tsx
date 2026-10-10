import type { RunMetrics } from "../../filmgraph/client/metrics";
import { formatCount, formatMs } from "../../filmgraph/client/metrics";

export interface NPlusOneResult {
  off: RunMetrics;
  on: RunMetrics;
  rest: RunMetrics;
  castSize: number;
  sqlOn: string[];
}

interface Props {
  result: NPlusOneResult | null;
  onRun: () => void;
  disabled: boolean;
  running: boolean;
}

export function NPlusOne({ result, onRun, disabled, running }: Props) {
  const max = result ? Math.max(result.off.dbQueries, result.on.dbQueries, 1) : 1;
  const bars = result
    ? [
        { key: "off", label: "GraphQL, batching off", metrics: result.off },
        { key: "on", label: "GraphQL, DataLoader batching on", metrics: result.on },
      ]
    : [];
  return (
    <section className="fg-card" aria-labelledby="fg-n1-title" aria-busy={running}>
      <h2 id="fg-n1-title">The N+1 problem</h2>
      <p>
        One query asks for Pulp Fiction's cast and every cast member's films. Without batching, each actor and each film
        is fetched with its own SQL query. DataLoader collects the IDs requested in the same tick into one{" "}
        <code>WHERE id = ANY($1)</code> query per type.
      </p>
      <button type="button" className="button button-primary button-small" onClick={onRun} disabled={disabled}>
        {running ? "Running…" : "Run with batching off, then on"}
      </button>
      <div aria-live="polite">
        {result && (
          <>
            <ul className="fg-bars">
              {bars.map((bar) => (
                <li key={bar.key} data-n1={bar.key}>
                  <span className="fg-bar-label">{bar.label}</span>
                  <span className="fg-bar" style={{ width: `${Math.max(2, (bar.metrics.dbQueries / max) * 100)}%` }} aria-hidden="true" />
                  <span className="fg-bar-value">
                    <strong>{formatCount(bar.metrics.dbQueries)}</strong> SQL queries · {formatMs(bar.metrics.ms)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="fg-footnote">
              Same response either way. With {result.castSize} cast members, batching cuts the work from{" "}
              {formatCount(result.off.dbQueries)} to {formatCount(result.on.dbQueries)} queries. The REST version of the
              same screen needs {formatCount(result.rest.requests)} HTTP requests and {formatCount(result.rest.dbQueries)}{" "}
              queries.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
