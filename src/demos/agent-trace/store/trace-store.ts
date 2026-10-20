import type { ParsedBatch } from "../collector/ingest";
import type { NormSpan, OtlpExportRequest, OtlpResource, OtlpScope } from "../collector/normalize";

export type RunSource = "live" | "sample" | "upload";

export interface Run {
  /** URL-safe run ID: "live-…", "sample-…" or "upload-…". */
  id: string;
  traceId: string;
  source: RunSource;
  label?: string;
  spans: Map<string, NormSpan>;
  resources: Map<string, { resource: OtlpResource; schemaUrl?: string }>;
  scopes: Map<string, { scope: OtlpScope; schemaUrl?: string }>;
  /** Bumped on every change so views can memoize. */
  version: number;
}

export interface RunIndex {
  spans: NormSpan[];
  byId: Map<string, NormSpan>;
  children: Map<string | undefined, NormSpan[]>;
  roots: NormSpan[];
  startNs: bigint;
  /** Latest known timestamp: the max end or start among spans. */
  endNs: bigint;
  open: number;
}

const byStart = (a: NormSpan, b: NormSpan) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : a.spanId < b.spanId ? -1 : 1);

export function runIdFor(source: RunSource, traceId: string, sourceId: string | undefined, tracesInBatch: number): string {
  if (source === "live" || !sourceId) return `${source}-${traceId.slice(0, 16)}`;
  return tracesInBatch > 1 ? `${sourceId}-${traceId.slice(0, 8)}` : sourceId;
}

/** In-memory trace store, indexed by trace, parent and start time. */
export class TraceStore {
  private runs = new Map<string, Run>();
  private byTrace = new Map<string, string>();
  private indexes = new Map<string, { version: number; index: RunIndex }>();
  private listeners = new Set<() => void>();
  private snapshotVersion = 0;
  private notifyScheduled = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Changes on every update; for useSyncExternalStore. */
  getVersion = (): number => this.snapshotVersion;

  private notify() {
    this.snapshotVersion++;
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      this.listeners.forEach((l) => l());
    });
  }

  /** Upserts spans by spanId. An ended span is never replaced by an older open copy. Returns affected run IDs. */
  upsert(batch: ParsedBatch, options: { source: RunSource; sourceId?: string; label?: string }): string[] {
    const traceIds = [...new Set(batch.spans.map((s) => s.traceId))];
    const touched = new Set<string>();
    for (const span of batch.spans) {
      let runId = this.byTrace.get(span.traceId);
      if (!runId) {
        runId = runIdFor(options.source, span.traceId, options.sourceId, traceIds.length);
        this.runs.set(runId, {
          id: runId,
          traceId: span.traceId,
          source: options.source,
          label: options.label,
          spans: new Map(),
          resources: new Map(),
          scopes: new Map(),
          version: 0,
        });
        this.byTrace.set(span.traceId, runId);
      }
      const run = this.runs.get(runId)!;
      const existing = run.spans.get(span.spanId);
      if (existing && existing.endNs !== null && span.endNs === null) continue;
      run.spans.set(span.spanId, span);
      const res = batch.resources.get(span.resourceKey);
      if (res) run.resources.set(span.resourceKey, res);
      const scope = batch.scopes.get(span.scopeKey);
      if (scope) run.scopes.set(span.scopeKey, scope);
      run.version++;
      touched.add(runId);
    }
    if (touched.size) this.notify();
    return [...touched];
  }

  get(runId: string): Run | undefined {
    return this.runs.get(runId);
  }

  list(): Run[] {
    return [...this.runs.values()];
  }

  remove(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.delete(runId);
    this.byTrace.delete(run.traceId);
    this.indexes.delete(runId);
    this.notify();
  }

  /** Sorted spans, parent/child maps and time bounds, cached per run version. */
  index(runId: string): RunIndex | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    const cached = this.indexes.get(runId);
    if (cached && cached.version === run.version) return cached.index;
    const spans = [...run.spans.values()].sort(byStart);
    const byId = new Map(spans.map((s) => [s.spanId, s]));
    const children = new Map<string | undefined, NormSpan[]>();
    const roots: NormSpan[] = [];
    let startNs = spans[0]?.startNs ?? 0n;
    let endNs = startNs;
    let open = 0;
    for (const s of spans) {
      const parent = s.parentSpanId && byId.has(s.parentSpanId) ? s.parentSpanId : undefined;
      if (!parent) roots.push(s);
      const list = children.get(parent) ?? [];
      list.push(s);
      children.set(parent, list);
      if (s.startNs < startNs) startNs = s.startNs;
      const last = s.endNs ?? s.startNs;
      if (last > endNs) endNs = last;
      if (s.endNs === null) open++;
    }
    const index = { spans, byId, children, roots, startNs, endNs, open };
    this.indexes.set(runId, { version: run.version, index });
    return index;
  }

  /** A run is complete when every span has ended and a root exists. */
  isComplete(runId: string): boolean {
    const idx = this.index(runId);
    return !!idx && idx.spans.length > 0 && idx.open === 0 && idx.roots.length > 0;
  }

  /** Standard ExportTraceServiceRequest for one run, grouped by resource and scope. */
  exportOtlp(runId: string): OtlpExportRequest {
    const run = this.runs.get(runId);
    if (!run) return { resourceSpans: [] };
    const idx = this.index(runId)!;
    const grouped = new Map<string, Map<string, NormSpan[]>>();
    for (const s of idx.spans) {
      const scopes = grouped.get(s.resourceKey) ?? new Map<string, NormSpan[]>();
      const list = scopes.get(s.scopeKey) ?? [];
      list.push(s);
      scopes.set(s.scopeKey, list);
      grouped.set(s.resourceKey, scopes);
    }
    return {
      resourceSpans: [...grouped].map(([resourceKey, scopes]) => {
        const res = run.resources.get(resourceKey);
        return {
          resource: res?.resource ?? { attributes: [], droppedAttributesCount: 0 },
          ...(res?.schemaUrl ? { schemaUrl: res.schemaUrl } : {}),
          scopeSpans: [...scopes].map(([scopeKey, spans]) => {
            const sc = run.scopes.get(scopeKey);
            return {
              scope: sc?.scope ?? { name: "" },
              ...(sc?.schemaUrl ? { schemaUrl: sc.schemaUrl } : {}),
              spans: spans.map((s) => s.raw),
            };
          }),
        };
      }),
    };
  }
}
