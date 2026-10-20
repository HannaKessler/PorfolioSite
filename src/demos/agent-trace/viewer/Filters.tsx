import type { Filters as FilterState } from "./model";

interface Props {
  filters: FilterState;
  onChange: (f: FilterState) => void;
  tools: string[];
  ops: string[];
  slowThresholdMs?: number;
  formatMs: (ms: number) => string;
}

export function Filters({ filters, onChange, tools, ops, slowThresholdMs, formatMs }: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });
  return (
    <div className="atv-filters" role="group" aria-label="Filter spans">
      <label className="atv-check">
        <input type="checkbox" checked={filters.errors} onChange={(e) => set({ errors: e.target.checked })} /> Errors only
      </label>
      <label className="atv-check" title={slowThresholdMs !== undefined ? `Slower than ${formatMs(slowThresholdMs)}` : undefined}>
        <input type="checkbox" checked={filters.slow} onChange={(e) => set({ slow: e.target.checked })} /> Slow (&gt; p90
        {slowThresholdMs !== undefined ? `, ${formatMs(slowThresholdMs)}` : ""})
      </label>
      <label className="atv-field">
        <span>Tool</span>
        <select value={filters.tool ?? ""} onChange={(e) => set({ tool: e.target.value || undefined })}>
          <option value="">All</option>
          {tools.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="atv-field">
        <span>Operation</span>
        <select value={filters.op ?? ""} onChange={(e) => set({ op: e.target.value || undefined })}>
          <option value="">All</option>
          {ops.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </label>
      <label className="atv-field atv-search">
        <span>Search</span>
        <input type="search" value={filters.q ?? ""} placeholder="Name or attribute" onChange={(e) => set({ q: e.target.value || undefined })} />
      </label>
    </div>
  );
}
