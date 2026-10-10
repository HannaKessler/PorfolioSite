import type { RunMetrics } from "../../filmgraph/client/metrics";
import { formatBytes, formatCount, formatMs } from "../../filmgraph/client/metrics";

interface Props {
  graphql: RunMetrics | null;
  rest: RunMetrics | null;
  restError: string | null;
  running: boolean;
}

type Row = {
  key: string;
  label: string;
  value: (m: RunMetrics) => number;
  format: (value: number, m: RunMetrics) => string;
  lowerIsBetter?: boolean;
};

const overfetch = (m: RunMetrics) => Math.max(0, m.payloadBytes - m.usefulBytes);
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const ROWS: Row[] = [
  { key: "requests", label: "HTTP requests", value: (m) => m.requests, format: (v) => formatCount(v), lowerIsBetter: true },
  { key: "sent", label: "Request bytes sent", value: (m) => m.requestBytes, format: (v) => formatBytes(v), lowerIsBetter: true },
  { key: "received", label: "Response bytes received", value: (m) => m.responseBytes, format: (v) => formatBytes(v), lowerIsBetter: true },
  { key: "db", label: "Database queries", value: (m) => m.dbQueries, format: (v) => formatCount(v), lowerIsBetter: true },
  { key: "time", label: "Total time", value: (m) => m.ms, format: (v) => formatMs(v), lowerIsBetter: true },
  {
    key: "overfetch",
    label: "Unused data (over-fetch)",
    value: overfetch,
    format: (v, m) => `${formatBytes(v)} · ${percent(v, m.payloadBytes)}%`,
    lowerIsBetter: true,
  },
  {
    key: "fields",
    label: "Fields used of received",
    value: (m) => m.fieldsReceived - m.fieldsUsed,
    format: (_, m) => `${formatCount(m.fieldsUsed)} of ${formatCount(m.fieldsReceived)}`,
    lowerIsBetter: true,
  },
  {
    key: "cached",
    label: "Revalidated with ETag (304)",
    value: (m) => m.revalidated,
    format: (v, m) => (m.api === "GraphQL" ? "n/a (POST)" : `${formatCount(v)} of ${formatCount(m.requests)}`),
  },
];

export function ComparisonStrip({ graphql, rest, restError, running }: Props) {
  return (
    <section className="fg-section fg-compare" aria-labelledby="fg-compare-title" aria-busy={running}>
      <div className="fg-section-head">
        <h2 id="fg-compare-title">GraphQL vs REST</h2>
        <p>Measured in your browser for the last run. Run the same preset again to see ETag revalidation kick in.</p>
      </div>
      <div className="fg-table-wrap" tabIndex={0} role="region" aria-labelledby="fg-compare-title">
        <table className="fg-table">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">GraphQL</th>
              <th scope="col">REST</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const g = graphql ? row.value(graphql) : null;
              const r = rest && !restError ? row.value(rest) : null;
              const better = (mine: number | null, other: number | null) =>
                row.lowerIsBetter && mine !== null && other !== null && mine < other;
              return (
                <tr key={row.key} data-metric={row.key}>
                  <th scope="row">{row.label}</th>
                  <td data-api="graphql" data-better={better(g, r) || undefined}>
                    {graphql && g !== null ? row.format(g, graphql) : "–"}
                  </td>
                  <td data-api="rest" data-better={better(r, g) || undefined}>
                    {restError ? (row.key === "requests" && rest ? `${formatCount(rest.requests)} (failed)` : "–") : rest && r !== null ? row.format(r, rest) : "–"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fg-footnote">
        Bytes are response bodies as the page receives them from the service worker, before any HTTP compression.
        Unused data compares every JSON payload the client handled with the JSON it actually needed.
      </p>
    </section>
  );
}
