import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from "react";
import type { Collector } from "../collector/collector";
import { IngestError } from "../collector/ingest";
import { decodeAttributes } from "../collector/normalize";
import type { TraceStore } from "../store/trace-store";
import { saveRun } from "../store/idb";
import { CostTable } from "./CostTable";
import { Compare } from "./Compare";
import { Filters } from "./Filters";
import { Inspector } from "./Inspector";
import { Playback } from "./Playback";
import { Summary } from "./Summary";
import { Timeline } from "./Timeline";
import { buildViewSpans, filterOptions, formatMs, nsToMs, p90, summarize, visibleRows, type Filters as FilterState } from "./model";
import { parseUrlState, serializeUrlState, type UrlState } from "./url-state";
import { runLabel } from "./labels";

interface Props {
  store: TraceStore;
  collector: Collector;
  /** When this changes, the viewer switches to that run (for example, a live run that just started). */
  focus?: { runId: string; nonce: number };
  /** Rendered above the viewer, e.g. the run controls. */
  children?: ReactNode;
}

const SOURCE_ORDER = { sample: 0, live: 1, upload: 2 } as const;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const nowEpochMs = () => performance.timeOrigin + performance.now();

export function TraceViewer({ store, collector, focus, children }: Props) {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [url, setUrl] = useState<UrlState>(() => parseUrlState(typeof location === "undefined" ? "" : location.search));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | undefined>();
  const [dragging, setDragging] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [now, setNow] = useState(nowEpochMs);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const runs = store
    .list()
    .slice()
    .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || Number((store.index(a.id)?.startNs ?? 0n) - (store.index(b.id)?.startNs ?? 0n)));
  const run = (url.run && store.get(url.run)) || runs[0];
  const index = run ? store.index(run.id) : undefined;

  const update = useCallback((patch: Partial<UrlState>) => setUrl((u) => ({ ...u, ...patch })), []);
  const onPlayback = useCallback((t: number | undefined) => update({ t }), [update]);

  useEffect(() => {
    const qs = serializeUrlState(url);
    if (qs !== location.search) history.replaceState(history.state, "", `${location.pathname}${qs}${location.hash}`);
  }, [url]);

  useEffect(() => {
    if (focus) {
      setUrl((u) => ({ ...u, run: focus.runId, span: undefined, t: undefined, cmp: u.cmp === focus.runId ? undefined : u.cmp }));
      setCollapsed(new Set());
    }
  }, [focus?.runId, focus?.nonce]);

  // Open spans grow live: redraw every frame while the selected run has any.
  const live = !!index && index.open > 0 && url.t === undefined;
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      setNow(nowEpochMs());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  const allSpans = useMemo(() => (index ? buildViewSpans(index) : []), [index]);
  const runDurationMs = index ? nsToMs(index.endNs - index.startNs) : 0;
  const playbackT = url.t !== undefined ? Math.min(url.t, runDurationMs) : undefined;
  const spans = useMemo(() => (index && playbackT !== undefined ? buildViewSpans(index, playbackT) : allSpans), [index, playbackT, allSpans]);
  const rows = useMemo(() => visibleRows(spans, url.filters, collapsed), [spans, url.filters, collapsed]);
  const resourceAttrs = useMemo(() => {
    const first = run ? [...run.resources.values()][0] : undefined;
    return first ? decodeAttributes(first.resource.attributes) : {};
  }, [run, run?.version]);
  const summary = useMemo(() => summarize(spans, resourceAttrs), [spans, resourceAttrs]);
  const options = useMemo(() => filterOptions(allSpans), [allSpans]);
  const marks = useMemo(() => [...new Set(allSpans.map((s) => s.startMs))].sort((a, b) => a - b), [allSpans]);

  const liveOffset = index ? Math.max(runDurationMs, now - nsToMs(index.startNs)) : 0;
  const totalMs = playbackT !== undefined ? runDurationMs : index && index.open > 0 ? liveOffset : runDurationMs;
  const openEndMs = playbackT ?? liveOffset;
  const selected = spans.find((s) => s.id === url.span);
  const compareRun = url.cmp ? store.get(url.cmp) : undefined;

  const selectSpan = (id: string) => {
    update({ span: id });
    setSheetOpen(true);
  };
  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const importFiles = async (files: FileList | File[]) => {
    for (const file of [...files]) {
      try {
        const text = await file.text();
        const sourceId = `upload-${(await sha256Hex(text)).slice(0, 12)}`;
        const result = collector.ingest(text, { source: "upload", sourceId, label: `Upload · ${file.name}` });
        if (result.runIds.length === 0) throw new IngestError("The file contains no spans");
        for (const runId of result.runIds) {
          if (store.isComplete(runId)) {
            void saveRun({ runId, source: "upload", label: `Upload · ${file.name}`, savedAt: Date.now(), otlp: store.exportOtlp(runId) });
          }
        }
        update({ run: result.runIds[0], span: undefined, t: undefined });
        setNotice({
          kind: "info",
          text: `Imported ${result.accepted} span${result.accepted === 1 ? "" : "s"} from ${file.name}${result.rejected.length ? `; skipped ${result.rejected.length} invalid span(s) (${result.rejected[0].reason})` : ""}.`,
        });
      } catch (e) {
        setNotice({ kind: "error", text: `${file.name}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  };

  const download = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify(store.exportOtlp(run.id), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `agent-trace-${run.id}.otlp.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    exportDialog.current?.close();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`atv-viewer${dragging ? " is-dragging" : ""}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {children}
      <div className="atv-bar">
        <label className="atv-field atv-run-select">
          <span>Trace</span>
          <select
            value={run?.id ?? ""}
            onChange={(e) => {
              update({ run: e.target.value, span: undefined, t: undefined, cmp: url.cmp === e.target.value ? undefined : url.cmp });
              setCollapsed(new Set());
            }}
          >
            {runs.length === 0 && <option value="">No traces yet</option>}
            {(["sample", "live", "upload"] as const).map((source) => {
              const group = runs.filter((r) => r.source === source);
              if (group.length === 0) return null;
              return (
                <optgroup key={source} label={source === "sample" ? "Recorded samples" : source === "live" ? "Your runs" : "Uploaded files"}>
                  {group.map((r) => (
                    <option key={r.id} value={r.id}>
                      {runLabel(store, r)}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
        <label className="atv-field atv-run-select">
          <span>Compare with</span>
          <select value={compareRun?.id ?? ""} onChange={(e) => update({ cmp: e.target.value || undefined })}>
            <option value="">Nothing</option>
            {runs
              .filter((r) => r.id !== run?.id)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(store, r)}
                </option>
              ))}
          </select>
        </label>
        <div className="atv-bar-actions">
          <button type="button" className="atv-btn" onClick={() => fileInput.current?.click()}>
            Import OTLP-JSON
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" className="atv-btn" disabled={!run || !store.isComplete(run.id)} onClick={() => exportDialog.current?.showModal()}>
            Export
          </button>
        </div>
      </div>
      <p className="atv-footnote">Imported files are read in your browser and never uploaded. Drop a file anywhere on the viewer.</p>
      {notice && (
        <p className={notice.kind === "error" ? "atv-error-text" : "atv-info-text"} role="status">
          {notice.text}{" "}
          <button type="button" className="atv-link" onClick={() => setNotice(undefined)}>
            Dismiss
          </button>
        </p>
      )}

      {run && index ? (
        <>
          <Summary summary={summary} />
          <CostTable chats={allSpans.filter((s) => s.op === "chat")} />
          {compareRun && <Compare store={store} a={run} b={compareRun} />}
          {store.isComplete(run.id) && runDurationMs > 0 && (
            <Playback durationMs={runDurationMs} t={playbackT} marks={marks} onChange={onPlayback} />
          )}
          <Filters
            filters={url.filters}
            onChange={(f: FilterState) => update({ filters: f })}
            tools={options.tools}
            ops={options.ops}
            slowThresholdMs={p90(spans)}
            formatMs={formatMs}
          />
          <div className={`atv-main${sheetOpen && selected ? " sheet-open" : ""}`}>
            {rows.length > 0 ? (
              <Timeline rows={rows} totalMs={totalMs} openEndMs={openEndMs} selectedId={url.span} onSelect={selectSpan} collapsed={collapsed} onToggle={toggle} />
            ) : (
              <div className="atv-timeline atv-empty">
                <p className="atv-muted">{spans.length === 0 ? "No spans yet at this point in the run." : "No spans match these filters."}</p>
              </div>
            )}
            <Inspector span={selected} runStartNs={index.startNs} onClose={() => setSheetOpen(false)} />
          </div>
        </>
      ) : (
        <div className="atv-empty-state">
          <p className="atv-overlay-title">No trace selected</p>
          <p className="atv-muted">Run the agent, pick a recorded sample, or import an OTLP-JSON file.</p>
        </div>
      )}

      <dialog ref={exportDialog} className="atv-dialog" aria-labelledby="atv-export-title">
        <h3 id="atv-export-title">Export trace as OTLP-JSON</h3>
        <p>
          The file is a standard OpenTelemetry <code>ExportTraceServiceRequest</code> that can be imported here again or into other OTLP tools.
        </p>
        <p className="atv-warning">
          It includes the prompts and model responses recorded in the trace, and the tool arguments and results. Check the contents before sharing it.
        </p>
        <div className="atv-dialog-actions">
          <button type="button" className="atv-btn atv-btn-primary" onClick={download}>
            Download
          </button>
          <button type="button" className="atv-btn" onClick={() => exportDialog.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
      {dragging && <div className="atv-dropzone">Drop an OTLP-JSON file to import it</div>}
    </div>
  );
}
