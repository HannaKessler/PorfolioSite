// Live performance readouts: a small corner overlay per pane and a comparison
// table under the grid. Both re-render from counters on a 500 ms timer.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { isBenchmark, PANE_IDS, PANE_NAMES, setBenchmark, subscribeBenchmark, summary, type PaneId, type PaneSummary } from "../../modelviewer/perf";

function useTick(ms = 500) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const handle = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(handle);
  }, [ms]);
}

export function useBenchmark() {
  return useSyncExternalStore(subscribeBenchmark, isBenchmark, () => false);
}

const DASH = "\u2014";
const ms = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? DASH : v.toFixed(digits));
const gpuText = (s: PaneSummary) => (s.gpu ? ms(s.gpu.avg, 2) : s.gpuSupport === "n/a" ? "n/a" : DASH);
const count = (v: number | null) => (v === null ? DASH : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : String(v));

export function PaneStats({ id }: { id: PaneId }) {
  useTick();
  const s = summary(id);
  if (s.loadMs === null && s.cpu === null) return null;
  return (
    <div className="mv-stats" aria-hidden="true">
      cpu {ms(s.cpu?.avg, 2)} ms · gpu {gpuText(s)}
      {s.gpu ? " ms" : ""}
      <br />
      {count(s.modelTriangles)} tris · {count(s.drawCalls)} draws
    </div>
  );
}

type Column = {
  head: string;
  title: string;
  value: (s: PaneSummary, id: PaneId) => number | null;
  show: (s: PaneSummary, id: PaneId) => ReactNode;
  better?: "low" | "high";
};

const COLUMNS: Column[] = [
  {
    head: "Load (ms)",
    title: "From opening the file to the model being ready to draw; where the file was parsed",
    value: (s) => s.loadMs,
    show: (s) => (
      <>
        {ms(s.loadMs, 0)} <span className="mv-perf-dim">{s.parsedOn === "worker" ? "worker" : "main"}</span>
      </>
    ),
    better: "low",
  },
  { head: "First frame (ms)", title: "From opening the file to the first frame drawn with the model", value: (s) => s.firstFrameMs, show: (s) => ms(s.firstFrameMs, 0), better: "low" },
  { head: "Frame CPU (ms)", title: "JavaScript time inside the render call, average of the last 120 frames", value: (s) => s.cpu?.avg ?? null, show: (s) => ms(s.cpu?.avg, 2), better: "low" },
  { head: "GPU (ms)", title: "GPU time per frame from timer queries; n/a where the browser doesn't expose them", value: (s) => s.gpu?.avg ?? null, show: gpuText, better: "low" },
];

function bestIds(column: Column, rows: [PaneId, PaneSummary][]): Set<PaneId> {
  if (!column.better) return new Set();
  const values = rows.map(([id, s]) => [id, column.value(s, id)] as const).filter((r): r is readonly [PaneId, number] => r[1] !== null);
  if (values.length < 2) return new Set();
  const target = column.better === "low" ? Math.min(...values.map((v) => v[1])) : Math.max(...values.map((v) => v[1]));
  if (values.every((v) => v[1] === target)) return new Set();
  return new Set(values.filter((v) => v[1] === target).map((v) => v[0]));
}

export function PerfTable() {
  useTick();
  const benchmark = useBenchmark();
  const rows = PANE_IDS.map((id) => [id, summary(id)] as [PaneId, PaneSummary]);
  const columns = COLUMNS;
  const best = columns.map((c) => bestIds(c, rows));
  return (
    <div className="mv-perf">
      <div className="mv-perf-head">
        <button type="button" className={`mv-bench${benchmark ? " is-on" : ""}`} aria-pressed={benchmark} onClick={() => setBenchmark(!benchmark)}>
          {benchmark ? "Stop benchmark" : "Benchmark"}
        </button>
        <span className="mv-perf-note">
          {benchmark ? "All panes render continuously and orbit identically." : "Panes redraw on demand (Babylon.js continuously); press Benchmark to compare frame times."}{" "}
          Best in each column is highlighted.
        </span>
      </div>
      <table className="mv-perf-table">
        <thead>
          <tr>
            <th scope="col">Pane</th>
            {columns.map((c) => (
              <th scope="col" key={c.head} title={c.title}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, s]) => (
            <tr key={id}>
              <th scope="row">{PANE_NAMES[id]}</th>
              {columns.map((c, i) => (
                <td key={c.head} className={best[i]!.has(id) ? "mv-best" : undefined}>
                  {c.show(s, id)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
