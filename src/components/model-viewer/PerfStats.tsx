// Live performance readouts: a small corner overlay per pane and a comparison
// table under the grid. Both re-render from counters on a 500 ms timer.
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatBytes, isBenchmark, jsHeapBytes, PANE_IDS, PANE_NAMES, setBenchmark, subscribeBenchmark, summary, type PaneId, type PaneSummary } from "../../modelviewer/perf";

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

const ms = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "–" : `${v.toFixed(digits)}`);
const gpuText = (s: PaneSummary) => (s.gpu ? `${ms(s.gpu.avg, 2)}` : s.gpuSupport === "n/a" ? "n/a" : "–");
const count = (v: number | null) => (v === null ? "–" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : String(v));

export function PaneStats({ id }: { id: PaneId }) {
  useTick();
  const s = summary(id);
  if (s.loadMs === null && s.fps === null) return null;
  return (
    <div className="mv-stats" aria-hidden="true">
      {s.fps ?? "–"} fps · cpu {ms(s.cpu?.avg, 2)} ms · gpu {gpuText(s)}
      {s.gpu ? " ms" : ""}
      <br />
      {count(s.modelTriangles)} tris · {count(s.trianglesDrawn)} drawn · {count(s.drawCalls)} draws
    </div>
  );
}

export function PerfTable() {
  useTick();
  const benchmark = useBenchmark();
  const heap = jsHeapBytes();
  return (
    <div className="mv-perf">
      <div className="mv-perf-head">
        <button type="button" className={`mv-chip${benchmark ? " is-on" : ""}`} aria-pressed={benchmark} onClick={() => setBenchmark(!benchmark)}>
          {benchmark ? "Stop benchmark" : "Benchmark"}
        </button>
        <span className="mv-perf-note">
          {benchmark ? "All panes render continuously and orbit identically." : "Panes redraw on demand (Babylon.js continuously); press Benchmark to compare frame times."}
          {heap !== null && ` JS heap ${formatBytes(heap)}.`}
        </span>
      </div>
      <table className="mv-perf-table">
        <thead>
          <tr>
            <th scope="col">Pane</th>
            <th scope="col">Load ms</th>
            <th scope="col">First frame ms</th>
            <th scope="col">FPS</th>
            <th scope="col">CPU ms avg / p95</th>
            <th scope="col">GPU ms avg / p95</th>
            <th scope="col">Draws</th>
            <th scope="col" title="Triangles in the model geometry, each counted once, grid excluded">Triangles</th>
            <th scope="col" title="Triangles submitted per frame, including the grid and extra passes">Tris drawn</th>
            <th scope="col">GPU mem</th>
          </tr>
        </thead>
        <tbody>
          {PANE_IDS.map((id) => {
            const s = summary(id);
            return (
              <tr key={id}>
                <th scope="row">{PANE_NAMES[id]}</th>
                <td>
                  {ms(s.loadMs, 0)} <span className="mv-perf-dim">{s.parsedOn === "worker" ? "worker" : "main"}</span>
                </td>
                <td>{ms(s.firstFrameMs, 0)}</td>
                <td>{s.fps ?? "–"}</td>
                <td>{s.cpu ? `${ms(s.cpu.avg, 2)} / ${ms(s.cpu.p95, 2)}` : "–"}</td>
                <td>{s.gpu ? `${ms(s.gpu.avg, 2)} / ${ms(s.gpu.p95, 2)}` : s.gpuSupport === "n/a" ? "n/a" : "–"}</td>
                <td>{count(s.drawCalls)}</td>
                <td>{count(s.modelTriangles)}</td>
                <td>{count(s.trianglesDrawn)}</td>
                <td>{formatBytes(s.gpuBytes)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
