import { NO_FILTERS, type Filters } from "./model";

/** Everything needed to reproduce a view, kept in the query string. */
export interface UrlState {
  run?: string;
  span?: string;
  filters: Filters;
  cmp?: string;
  /** Playback time in ms from the run start. */
  t?: number;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;

export function parseUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const id = (k: string) => {
    const v = p.get(k);
    return v && ID.test(v) ? v : undefined;
  };
  const t = Number(p.get("t"));
  const flags = new Set((p.get("f") ?? "").split(",").filter(Boolean));
  return {
    run: id("run"),
    span: id("span"),
    cmp: id("cmp"),
    t: p.has("t") && Number.isFinite(t) && t >= 0 ? t : undefined,
    filters: {
      ...NO_FILTERS,
      errors: flags.has("errors"),
      slow: flags.has("slow"),
      tool: p.get("tool") || undefined,
      op: p.get("op") || undefined,
      q: p.get("q") || undefined,
    },
  };
}

export function serializeUrlState(state: UrlState): string {
  const p = new URLSearchParams();
  if (state.run) p.set("run", state.run);
  if (state.span) p.set("span", state.span);
  const flags = [state.filters.errors && "errors", state.filters.slow && "slow"].filter(Boolean);
  if (flags.length) p.set("f", flags.join(","));
  if (state.filters.tool) p.set("tool", state.filters.tool);
  if (state.filters.op) p.set("op", state.filters.op);
  if (state.filters.q) p.set("q", state.filters.q);
  if (state.cmp) p.set("cmp", state.cmp);
  if (state.t !== undefined) p.set("t", String(Math.round(state.t * 1000) / 1000));
  const s = p.toString();
  return s ? `?${s}` : "";
}
