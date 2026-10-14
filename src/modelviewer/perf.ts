// Per-pane performance counters, measured the same way in every pane.
// Recording is a few performance.now() calls and array writes per frame; the
// overlays read a summary on a 500 ms timer, so watching doesn't cost frames.

export type PaneId = "three" | "babylon" | "webgpu" | "webgl2";
export const PANE_IDS: PaneId[] = ["three", "babylon", "webgpu", "webgl2"];
export const PANE_NAMES: Record<PaneId, string> = { three: "three.js", babylon: "Babylon.js", webgpu: "Custom · WebGPU", webgl2: "Custom · WebGL2" };

const WINDOW = 120; // frames kept for averages and p95

class Ring {
  values = new Float64Array(WINDOW);
  count = 0;
  next = 0;
  push(v: number) {
    this.values[this.next] = v;
    this.next = (this.next + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
  }
  clear() {
    this.count = this.next = 0;
  }
  stats(): { avg: number; p95: number } | null {
    if (!this.count) return null;
    const a = Array.from(this.values.subarray(0, this.count)).sort((x, y) => x - y);
    return { avg: a.reduce((s, v) => s + v, 0) / a.length, p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))]! };
  }
}

export interface PaneRecord {
  /** Where the model was parsed. */
  parsedOn: "main thread" | "worker";
  loadStart: number;
  loadMs: number | null;
  firstFrameMs: number | null;
  awaitingFirstFrame: boolean;
  cpu: Ring;
  gpu: Ring;
  /** "n/a" when the browser exposes no GPU timer for this API. */
  gpuSupport: "yes" | "n/a" | "unknown";
  frameTimes: Ring; // timestamps, for frames per second
  drawCalls: number | null;
  /** Triangles submitted in the last frame, including the grid and extra passes. */
  trianglesDrawn: number | null;
  /** Triangles in the model's geometry (no grid, each triangle once). */
  modelTriangles: number | null;
  gpuBytes: number | null;
}

function record(parsedOn: PaneRecord["parsedOn"]): PaneRecord {
  return { parsedOn, loadStart: 0, loadMs: null, firstFrameMs: null, awaitingFirstFrame: false, cpu: new Ring(), gpu: new Ring(), gpuSupport: "unknown", frameTimes: new Ring(), drawCalls: null, trianglesDrawn: null, modelTriangles: null, gpuBytes: null };
}

const panes: Record<PaneId, PaneRecord> = {
  three: record("main thread"),
  babylon: record("main thread"),
  webgpu: record("worker"),
  webgl2: record("worker"),
};

/** A new model was opened: reset every pane's counters and start the load clocks. */
export function startLoad(id: PaneId) {
  const p = panes[id];
  p.loadStart = performance.now();
  p.loadMs = p.firstFrameMs = null;
  p.awaitingFirstFrame = false;
  p.cpu.clear();
  p.gpu.clear();
  p.frameTimes.clear();
  p.drawCalls = p.trianglesDrawn = p.modelTriangles = p.gpuBytes = null;
}

/** The pane's model is parsed and on the GPU; the next frame recorded is its first. */
export function endLoad(id: PaneId, gpuBytes: number | null, modelTriangles: number) {
  const p = panes[id];
  p.modelTriangles = modelTriangles;
  p.loadMs = performance.now() - p.loadStart;
  p.gpuBytes = gpuBytes;
  p.awaitingFirstFrame = true;
}

export function setGpuBytes(id: PaneId, bytes: number) {
  panes[id].gpuBytes = bytes;
}

export function recordFrame(id: PaneId, cpuMs: number, drawCalls: number, trianglesDrawn: number) {
  const p = panes[id];
  const now = performance.now();
  p.cpu.push(cpuMs);
  p.frameTimes.push(now);
  p.drawCalls = drawCalls;
  p.trianglesDrawn = trianglesDrawn;
  if (p.awaitingFirstFrame) {
    p.awaitingFirstFrame = false;
    p.firstFrameMs = now - p.loadStart;
  }
}

export function recordGpu(id: PaneId, ms: number) {
  panes[id].gpu.push(ms);
  panes[id].gpuSupport = "yes";
}

export function setGpuSupport(id: PaneId, supported: boolean) {
  if (panes[id].gpuSupport !== "yes") panes[id].gpuSupport = supported ? "unknown" : "n/a";
}

export interface PaneSummary {
  parsedOn: string;
  loadMs: number | null;
  firstFrameMs: number | null;
  fps: number | null;
  cpu: { avg: number; p95: number } | null;
  gpu: { avg: number; p95: number } | null;
  gpuSupport: PaneRecord["gpuSupport"];
  drawCalls: number | null;
  trianglesDrawn: number | null;
  modelTriangles: number | null;
  gpuBytes: number | null;
}

export function summary(id: PaneId): PaneSummary {
  const p = panes[id];
  const now = performance.now();
  // Frames drawn in the last second (on-demand panes show what they actually drew).
  let fps = 0;
  for (let i = 0; i < p.frameTimes.count; i++) if (now - p.frameTimes.values[i]! <= 1000) fps++;
  return {
    parsedOn: p.parsedOn,
    loadMs: p.loadMs,
    firstFrameMs: p.firstFrameMs,
    fps: p.frameTimes.count ? fps : null,
    cpu: p.cpu.stats(),
    gpu: p.gpu.stats(),
    gpuSupport: p.gpuSupport,
    drawCalls: p.drawCalls,
    trianglesDrawn: p.trianglesDrawn,
    modelTriangles: p.modelTriangles,
    gpuBytes: p.gpuBytes,
  };
}

export function jsHeapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? memory.usedJSHeapSize : null;
}

// Benchmark mode: every pane renders continuously and orbits by the same angle.
let benchmark = false;
let benchmarkStart = 0;
const listeners = new Set<() => void>();
export const BENCH_SPEED = 0.5; // radians per second

export function isBenchmark() {
  return benchmark;
}
export function setBenchmark(on: boolean) {
  benchmark = on;
  benchmarkStart = performance.now();
  for (const id of PANE_IDS) {
    panes[id].cpu.clear();
    panes[id].gpu.clear();
    panes[id].frameTimes.clear();
  }
  for (const l of listeners) l();
}
export function subscribeBenchmark(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Orbit angle added to each pane's starting azimuth, shared so all panes turn identically. */
export function benchmarkAngle(now = performance.now()) {
  return ((now - benchmarkStart) / 1000) * BENCH_SPEED;
}

/** WebGL2 GPU timer (EXT_disjoint_timer_query_webgl2), one query in flight per frame, polled later. */
export function createGlTimer(gl: WebGL2RenderingContext, onResult: (ms: number) => void) {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  return {
    supported: !!ext,
    begin() {
      if (!ext || active || pending.length > 4) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    poll() {
      if (!ext) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      while (pending.length && gl.getQueryParameter(pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift()!;
        if (!disjoint) onResult(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    },
    dispose() {
      for (const q of pending) gl.deleteQuery(q);
      pending.length = 0;
    },
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "–";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
