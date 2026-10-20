import type { NormSpan } from "../collector/normalize";
import type { RunIndex } from "../store/trace-store";
import { APP, ERROR_TYPE, GEN_AI } from "../tracing/attrs";

/** A span prepared for display: offsets in ms from the run start. */
export interface ViewSpan {
  span: NormSpan;
  id: string;
  parentId?: string;
  depth: number;
  op: string;
  tool?: string;
  startMs: number;
  /** null while open. */
  endMs: number | null;
  isError: boolean;
  fault?: string;
  childCount: number;
}

export const nsToMs = (ns: bigint) => Number(ns) / 1e6;

export function operationOf(span: NormSpan): string {
  const op = span.attrs[GEN_AI.operationName] ?? span.attrs[APP.spanType];
  return typeof op === "string" ? op : "span";
}

/** Depth-first span list with offsets, optionally clipped to a playback time. */
export function buildViewSpans(index: RunIndex, playbackMs?: number): ViewSpan[] {
  const t0 = index.startNs;
  const out: ViewSpan[] = [];
  const visit = (span: NormSpan, depth: number) => {
    const startMs = nsToMs(span.startNs - t0);
    if (playbackMs !== undefined && startMs > playbackMs) return;
    let endMs = span.endNs === null ? null : nsToMs(span.endNs - t0);
    if (playbackMs !== undefined && endMs !== null && endMs > playbackMs) endMs = null;
    const children = index.children.get(span.spanId) ?? [];
    const tool = span.attrs[GEN_AI.toolName];
    const fault = span.attrs[APP.faultInjected];
    out.push({
      span,
      id: span.spanId,
      parentId: span.parentSpanId,
      depth,
      op: operationOf(span),
      tool: typeof tool === "string" ? tool : undefined,
      startMs,
      endMs,
      // During playback a span's error status only shows once it has ended.
      isError: span.status.code === 2 && endMs !== null,
      fault: typeof fault === "string" ? fault : undefined,
      childCount: children.length,
    });
    for (const c of children) visit(c, depth + 1);
  };
  for (const r of index.roots) visit(r, 0);
  return out;
}

export interface Filters {
  errors: boolean;
  slow: boolean;
  tool?: string;
  op?: string;
  q?: string;
}

export const NO_FILTERS: Filters = { errors: false, slow: false };

export const hasFilters = (f: Filters) => f.errors || f.slow || !!f.tool || !!f.op || !!f.q;

/** 90th percentile (nearest rank) of ended, non-root span durations. */
export function p90(spans: ViewSpan[]): number | undefined {
  const d = spans.filter((s) => s.depth > 0 && s.endMs !== null).map((s) => s.endMs! - s.startMs).sort((a, b) => a - b);
  if (d.length === 0) return undefined;
  return d[Math.max(0, Math.ceil(0.9 * d.length) - 1)];
}

function matches(s: ViewSpan, f: Filters, slowThreshold: number | undefined): boolean {
  if (f.errors && !s.isError) return false;
  if (f.slow && (slowThreshold === undefined || s.endMs === null || s.depth === 0 || s.endMs - s.startMs <= slowThreshold)) return false;
  if (f.tool && s.tool !== f.tool) return false;
  if (f.op && s.op !== f.op) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    const hay = [s.span.name, ...Object.values(s.span.attrs).map((v) => (typeof v === "string" ? v : JSON.stringify(v)))].join("\n").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export interface Row extends ViewSpan {
  /** Shown only because a descendant matches the filters. */
  context: boolean;
}

/** Applies filters (keeping ancestors of matches, dimmed) and collapsed subtrees. */
export function visibleRows(spans: ViewSpan[], filters: Filters, collapsed: ReadonlySet<string>): Row[] {
  const active = hasFilters(filters);
  const threshold = filters.slow ? p90(spans) : undefined;
  const byId = new Map(spans.map((s) => [s.id, s]));
  const keep = new Map<string, boolean>();
  for (const s of spans) {
    if (active && !matches(s, filters, threshold)) continue;
    keep.set(s.id, false);
    for (let p = s.parentId ? byId.get(s.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (!keep.has(p.id)) keep.set(p.id, true);
    }
  }
  const rows: Row[] = [];
  const hidden = new Set<string>();
  for (const s of spans) {
    if (s.parentId && (hidden.has(s.parentId) || collapsed.has(s.parentId))) {
      hidden.add(s.id);
      continue;
    }
    if (!active || keep.has(s.id)) rows.push({ ...s, context: active && keep.get(s.id) === true });
    else hidden.add(s.id);
  }
  return rows;
}

export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export interface Reported {
  /** Calls that reported the value, out of all chat calls. */
  n: number;
  m: number;
  total?: number;
  mean?: number;
}

function reported(chats: ViewSpan[], key: string): Reported {
  const values = chats.map((c) => num(c.span.attrs[key])).filter((v): v is number => v !== undefined);
  const total = values.length ? values.reduce((a, b) => a + b, 0) : undefined;
  return { n: values.length, m: chats.length, total, mean: total === undefined ? undefined : total / values.length };
}

export interface RunSummary {
  wallMs: number | null;
  steps: number;
  llmCalls: number;
  toolCalls: number;
  retries: number;
  errors: number;
  errorTypes: Record<string, number>;
  faults: number;
  tests?: { passed: number; failed: number };
  outcome?: string;
  brain?: string;
  model?: string;
  provider?: string;
  host?: string;
  inputTokens: Reported;
  outputTokens: Reported;
  ttftS: Reported;
  prefillTps: Reported;
  decodeTps: Reported;
}

export function summarize(spans: ViewSpan[], resourceAttrs: Record<string, unknown> = {}): RunSummary {
  const root = spans.find((s) => s.depth === 0);
  const chats = spans.filter((s) => s.op === "chat");
  const errorTypes: Record<string, number> = {};
  // Count each error once, where it originated: a step or run that fails because
  // a child failed with the same error.type is not counted again.
  const typeOf = (s: ViewSpan) => String(s.span.attrs[ERROR_TYPE] ?? "error");
  const childErrorTypes = new Map<string, Set<string>>();
  for (const s of spans) {
    if (!s.isError || !s.parentId) continue;
    const set = childErrorTypes.get(s.parentId) ?? new Set<string>();
    set.add(typeOf(s));
    childErrorTypes.set(s.parentId, set);
  }
  for (const s of spans) {
    if (!s.isError) continue;
    const t = typeOf(s);
    if (childErrorTypes.get(s.id)?.has(t)) continue;
    errorTypes[t] = (errorTypes[t] ?? 0) + 1;
  }
  const testRuns = spans.filter((s) => s.tool === "run_tests" && s.endMs !== null && num(s.span.attrs[APP.testsPassed]) !== undefined);
  const last = testRuns.at(-1);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    wallMs: root && root.endMs !== null ? root.endMs - root.startMs : null,
    steps: spans.filter((s) => s.op === "step").length,
    llmCalls: chats.length,
    toolCalls: spans.filter((s) => s.op === "execute_tool").length,
    retries: spans.reduce((n, s) => n + s.span.events.filter((e) => e.name === "retry").length, 0),
    errors: Object.values(errorTypes).reduce((a, b) => a + b, 0),
    errorTypes,
    faults: spans.filter((s) => s.fault).length,
    tests: last ? { passed: num(last.span.attrs[APP.testsPassed])!, failed: num(last.span.attrs[APP.testsFailed]) ?? 0 } : undefined,
    outcome: root && root.endMs !== null ? str(root.span.attrs[APP.runOutcome]) : undefined,
    brain: str(root?.span.attrs[APP.brainLabel]),
    model: str(root?.span.attrs[GEN_AI.requestModel]),
    provider: str(root?.span.attrs[GEN_AI.providerName]),
    host: str(resourceAttrs["app.host"]),
    inputTokens: reported(chats, GEN_AI.usageInputTokens),
    outputTokens: reported(chats, GEN_AI.usageOutputTokens),
    ttftS: reported(chats, APP.llmTimeToFirstTokenS),
    prefillTps: reported(chats, APP.llmPrefillTokensPerS),
    decodeTps: reported(chats, APP.llmDecodeTokensPerS),
  };
}

/** Distinct values for filter dropdowns. */
export function filterOptions(spans: ViewSpan[]): { tools: string[]; ops: string[] } {
  return {
    tools: [...new Set(spans.map((s) => s.tool).filter((t): t is string => !!t))].sort(),
    ops: [...new Set(spans.map((s) => s.op))].sort(),
  };
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
