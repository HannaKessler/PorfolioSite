import { formatBytes } from "../../filmgraph/client/metrics";

export interface PersistedStats {
  sentBytes: number;
  fullBytes: number;
  persisted: boolean;
  persistedOnly: boolean;
  error: string | null;
  probe?: boolean;
}

interface Props {
  stats: PersistedStats | null;
  onProbe: () => void;
  disabled: boolean;
}

export function PersistedPanel({ stats, onProbe, disabled }: Props) {
  const saved = stats ? stats.fullBytes - stats.sentBytes : 0;
  return (
    <section className="fg-card" aria-labelledby="fg-pq-title">
      <h2 id="fg-pq-title">Persisted queries</h2>
      <p>
        Every question's query ships with the server as an allowlist, keyed by its SHA-256 hash. With <em>Send persisted query hash</em>{" "}
        on, the page sends only the hash and the variables instead of the query text. With <em>Reject non-persisted
        queries</em> on, the server only runs queries on that list.
      </p>
      <button type="button" className="button button-ghost button-small" onClick={onProbe} disabled={disabled}>
        Try a query that is not on the list
      </button>
      <div aria-live="polite">
        {stats && (
          <dl className="fg-stats">
            <div>
              <dt>Last request body</dt>
              <dd data-pq="sent">{formatBytes(stats.sentBytes)}</dd>
            </div>
            <div>
              <dt>With the full query text</dt>
              <dd data-pq="full">{formatBytes(stats.fullBytes)}</dd>
            </div>
            <div>
              <dt>Saved</dt>
              <dd data-pq="saved">
                {stats.persisted && saved > 0
                  ? `${formatBytes(saved)} (${Math.round((saved / stats.fullBytes) * 100)}%)`
                  : "–"}
              </dd>
            </div>
            {stats.error && (
              <div className="fg-stats-wide">
                <dt>Server said</dt>
                <dd data-pq="error" className="fg-error-text">{stats.error}</dd>
              </div>
            )}
          </dl>
        )}
        {stats && !stats.persisted && !stats.probe && (
          <p className="fg-hint">Turn on Send persisted query hash and run GraphQL to compare.</p>
        )}
      </div>
    </section>
  );
}
