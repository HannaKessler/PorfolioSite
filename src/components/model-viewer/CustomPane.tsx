// A pane driven by one of the hand-written renderers (WebGPU or WebGL2).
// Loaded lazily; each backend module is only fetched by the pane that uses it.
import { useEffect, useRef, useState } from "react";
import { loadCustomScene } from "../../modelviewer/custom/sceneClient";
import type { CustomRenderer } from "../../modelviewer/custom/renderer";
import { benchmarkAngle, endLoad, isBenchmark, recordFrame, recordGpu, setGpuSupport, subscribeBenchmark } from "../../modelviewer/perf";
import { frameBox, gridCell, lookAt, orbitEye, panOrbit, rotateOrbit, zoomOrbit, type Orbit } from "../../modelviewer/mat4";

export type Backend = "webgpu" | "webgl2";

const FOV = (40 * Math.PI) / 180;

type PaneState = { kind: "starting" } | { kind: "loading" } | { kind: "ready" } | { kind: "note"; text: string };

async function createRenderer(backend: Backend, canvas: HTMLCanvasElement): Promise<CustomRenderer> {
  const onGpuTime = (ms: number) => recordGpu(backend, ms);
  if (backend === "webgpu") {
    const { createWebGPURenderer } = await import("../../modelviewer/custom/webgpu");
    return createWebGPURenderer(canvas, onGpuTime);
  }
  const { createWebGL2Renderer } = await import("../../modelviewer/custom/webgl2");
  return createWebGL2Renderer(canvas, onGpuTime);
}

export default function CustomPane({ backend, files }: { backend: Backend; files: readonly File[] | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CustomRenderer | null>(null);
  const orbitRef = useRef<Orbit | null>(null);
  const sizeRef = useRef({ radius: 1, distance: 5 });
  const requestRef = useRef<() => void>(() => {});
  const [state, setState] = useState<PaneState>({ kind: "starting" });
  const [rendererReady, setRendererReady] = useState(false);

  // Renderer, input and on-demand drawing.
  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let frameHandle = 0;
    let benchBase: Orbit | null = null;

    const draw = () => {
      frameHandle = 0;
      const renderer = rendererRef.current;
      if (!renderer || disposed) return;
      // Benchmark mode: draw every frame, turning by the angle shared with the other panes.
      const benchmark = isBenchmark();
      if (benchmark && orbitRef.current) {
        benchBase ??= orbitRef.current;
        orbitRef.current = { ...benchBase, azimuth: benchBase.azimuth + benchmarkAngle() };
      } else if (!benchmark) benchBase = null;
      const orbit = orbitRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      const view = orbit ?? { target: [0, 0.5, 0] as [number, number, number], radius: 5, azimuth: 0.7, polar: 1.15 };
      const eye = orbitEye(view);
      const { radius, distance } = sizeRef.current;
      try {
        const start = performance.now();
        const stats = renderer.render({
          view: lookAt(eye, view.target),
          eye,
          fovY: FOV,
          near: distance / 1000,
          far: distance * 100,
          gridCell: gridCell(radius),
          gridFade: radius * 12,
          width,
          height,
        });
        recordFrame(backend, performance.now() - start, stats.drawCalls, stats.triangles);
        if (benchmark) request();
      } catch (error) {
        setState({ kind: "note", text: `Rendering failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    };
    const request = () => {
      if (!frameHandle && !disposed) frameHandle = requestAnimationFrame(draw);
    };
    requestRef.current = request;
    const unsubscribe = subscribeBenchmark(request);

    createRenderer(backend, canvas).then(
      (renderer) => {
        if (disposed) return renderer.dispose();
        rendererRef.current = renderer;
        setGpuSupport(backend, renderer.gpuTiming);
        setRendererReady(true);
        request();
      },
      (error: unknown) => {
        if (disposed) return;
        setState({ kind: "note", text: error instanceof Error ? error.message : String(error) });
      },
    );

    // Orbit like three.js OrbitControls: drag to rotate, right-drag or shift-drag to pan, wheel to zoom.
    let drag: { x: number; y: number; pan: boolean } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || !orbitRef.current) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      orbitRef.current = drag.pan
        ? panOrbit(orbitRef.current, dx, dy, canvas.clientHeight, FOV)
        : rotateOrbit(orbitRef.current, dx, dy, canvas.clientHeight);
      request();
    };
    const onPointerUp = () => {
      drag = null;
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault(); // zoom the model, don't scroll the page
      if (!orbitRef.current) return;
      const deltaY = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaY;
      const { distance } = sizeRef.current;
      orbitRef.current = zoomOrbit(orbitRef.current, deltaY, distance / 100, distance * 20);
      request();
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    const observer = new ResizeObserver(request);
    observer.observe(canvas);

    return () => {
      disposed = true;
      unsubscribe();
      if (frameHandle) cancelAnimationFrame(frameHandle);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [backend]);

  // Scene: parsed by our own parsers in a worker (shared with the other custom pane).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!rendererReady || !renderer) return;
    if (!files) {
      renderer.setScene(null);
      return;
    }
    let cancelled = false;
    let uploaded = false;
    setState({ kind: "loading" });
    loadCustomScene(files)
      .then((scene) => {
        if (cancelled) return;
        renderer.setScene(scene);
        uploaded = true;
        // Load time covers the shared worker parse plus this pane's upload.
        endLoad(backend, renderer.gpuBytes());
        const { min, max } = scene;
        const orbit = frameBox(min, max, FOV);
        orbitRef.current = orbit;
        sizeRef.current = { radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2, distance: orbit.radius };
        setState({ kind: "ready" });
        requestRef.current();
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ kind: "note", text: `Couldn't draw this model: ${error instanceof Error ? error.message : String(error)}` });
      });
    return () => {
      cancelled = true;
      if (uploaded) renderer.setScene(null);
    };
  }, [files, rendererReady]);

  return (
    <>
      <canvas ref={canvasRef} className="mv-custom-canvas" />
      {state.kind === "loading" && <div className="mv-pane-note">Preparing…</div>}
      {state.kind === "note" && (
        <div className="mv-pane-note" role="alert">
          {state.text}
        </div>
      )}
    </>
  );
}
