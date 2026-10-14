import { type ReactNode, Component, lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { disposeObject, loadModel, setModelLighting, type LoadedModel } from "../../modelviewer/load";
import { getLighting, setLighting, subscribeLighting, type LightingMode } from "../../modelviewer/lighting";
import { SAMPLES, type Sample } from "../../modelviewer/samples";
import { benchmarkAngle, createGlTimer, endLoad, PANE_IDS, recordFrame, recordGpu, setBenchmark, setGpuBytes, setGpuSupport, startLoad } from "../../modelviewer/perf";
import { PaneStats, PerfTable, useBenchmark } from "./PerfStats";

// Babylon.js is only fetched once a model is opened, keeping the initial page light.
// A failed download isn't cached: the next model opened tries again.
function lazyBabylonPane() {
  return lazy(() =>
    import("./BabylonPane").catch((error: unknown) => {
      BabylonPane = lazyBabylonPane();
      throw error;
    }),
  );
}
let BabylonPane = lazyBabylonPane();

// The hand-written renderers, also fetched only once a model is open.
function lazyCustomPane() {
  return lazy(() =>
    import("./CustomPane").catch((error: unknown) => {
      CustomPane = lazyCustomPane();
      throw error;
    }),
  );
}
let CustomPane = lazyCustomPane();

const CUSTOM_PANES = [
  { backend: "webgpu", label: "Custom · WebGPU" },
  { backend: "webgl2", label: "Custom · WebGL2" },
] as const;

/**
 * Keeps a failure in one engine's pane (a chunk that fails to download, a
 * loader exception, a lost WebGL context) inside that pane instead of
 * unmounting the whole viewer. Resets when a new model is opened.
 */
class PaneBoundary extends Component<{ engine: string; resetKey: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error(`${this.props.engine} pane failed:`, error);
  }

  render() {
    if (this.state.error) {
      return <div className="mv-pane-note" role="alert">{this.props.engine} couldn't show this model: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

type Status =
  | { kind: "empty" }
  | { kind: "loading"; label: string }
  | { kind: "ready"; model: LoadedModel }
  | { kind: "error"; message: string };

/** Centre the model on the grid, sitting on y = 0, and frame the camera to its bounds. */
function placeAndFrame(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: { target: THREE.Vector3; update: () => void } | null) {
  object.position.set(0, 0, 0);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return 1;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -box.min.y, -center.z);

  const radius = Math.max(size.length() / 2, 1e-6);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = (radius / Math.sin(fov / 2)) * 1.15;
  const target = new THREE.Vector3(0, size.y / 2, 0);
  const direction = new THREE.Vector3(1, 0.7, 1.2).normalize();
  camera.position.copy(target).addScaledVector(direction, distance);
  camera.near = distance / 1000;
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(target);
    controls.update();
  }
  return radius;
}

/** Approximate GPU memory for a three.js model: vertex/index buffers plus mipmapped RGBA textures. */
/** Triangles in the model's visible geometry, each counted once. */
function modelTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const count = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    triangles += Math.floor(Math.min(count, g.drawRange.count) / 3);
  });
  return triangles;
}

function estimateGpuBytes(root: THREE.Object3D): number {
  let bytes = 0;
  const seen = new Set<unknown>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!seen.has(mesh.geometry)) {
      seen.add(mesh.geometry);
      for (const attribute of Object.values(mesh.geometry.attributes)) bytes += (attribute as THREE.BufferAttribute).array?.byteLength ?? 0;
      bytes += mesh.geometry.index?.array.byteLength ?? 0;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null;
        if (!texture?.isTexture || seen.has(texture)) continue;
        seen.add(texture);
        const image = texture.image as { width?: number; height?: number } | undefined;
        if (image?.width && image.height) bytes += image.width * image.height * 4 * (4 / 3);
      }
    }
  });
  return Math.round(bytes);
}

export function useLighting(): LightingMode {
  return useSyncExternalStore(subscribeLighting, getLighting, getLighting);
}

/** Buttons attached to the bottom edge of the pane grid: Benchmark on the left, lighting mode on the right. */
function StageBar() {
  const benchmark = useBenchmark();
  const lighting = useLighting();
  const modes: [LightingMode, string, string][] = [
    ["simple", "Simple", "Hemisphere and two directional lights, as loaded"],
    ["pbr", "PBR", "Physically based: metallic-roughness materials, image-based lighting from a generated environment"],
  ];
  return (
    <div className="mv-stage-bar">
      <button type="button" className={`mv-bench${benchmark ? " is-on" : ""}`} aria-pressed={benchmark} onClick={() => setBenchmark(!benchmark)}>
        {benchmark ? "Stop benchmark" : "Benchmark"}
      </button>
      <div className="mv-mode" role="group" aria-label="Lighting">
        {modes.map(([mode, label, title]) => (
          <button key={mode} type="button" title={title} className={`mv-mode-btn${lighting === mode ? " is-active" : ""}`} aria-pressed={lighting === mode} onClick={() => setLighting(mode)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** PBR mode for the three.js pane: a PMREM-filtered RoomEnvironment as scene.environment. */
function Environment({ enabled }: { enabled: boolean }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    if (!enabled) return;
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    pmrem.dispose();
    room.dispose?.();
    scene.environment = texture;
    scene.environmentIntensity = 0.5; // RoomEnvironment is bright; keep exposure close to the other panes
    invalidate();
    return () => {
      scene.environment = null;
      texture.dispose();
      invalidate();
    };
  }, [enabled, gl, scene, invalidate]);
  return null;
}

/** Benchmark mode: orbit the camera by the shared angle around the current target. */
function BenchmarkOrbit() {
  const benchmark = useBenchmark();
  const { camera, controls } = useThree();
  const base = useRef<{ spherical: THREE.Spherical } | null>(null);
  useEffect(() => {
    base.current = null;
  }, [benchmark]);
  useFrame(() => {
    if (!benchmark) return;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
    if (!base.current) base.current = { spherical: new THREE.Spherical().setFromVector3(camera.position.clone().sub(target)) };
    const s = base.current.spherical.clone();
    s.theta += benchmarkAngle();
    camera.position.setFromSpherical(s).add(target);
    camera.lookAt(target);
  });
  return null;
}

function Scene({ model }: { model: LoadedModel | null }) {
  const { camera, controls, invalidate } = useThree();
  const lighting = useLighting();
  const pbr = lighting === "pbr";

  useEffect(() => {
    if (!model) return;
    setModelLighting(model.object, lighting);
    invalidate();
  }, [model, lighting, invalidate]);
  const [scale, setScale] = useState(1);
  const grid = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const material = grid.current?.material as THREE.Material | undefined;
    if (material) {
      material.depthWrite = false;
      material.needsUpdate = true;
    }
  }, []);

  useEffect(() => {
    if (!model) return;
    const radius = placeAndFrame(
      model.object,
      camera as THREE.PerspectiveCamera,
      controls as unknown as { target: THREE.Vector3; update: () => void } | null,
    );
    setScale(radius);
    invalidate();
  }, [model, camera, controls, invalidate]);

  // Pick grid spacing as a power of ten close to the model size.
  const cell = Math.pow(10, Math.floor(Math.log10(Math.max(scale, 1e-6))) - 1) * 2;

  return (
    <>
      <Environment enabled={pbr} />
      <hemisphereLight args={[0xffffff, 0x8d8a85, 1.6]} visible={!pbr} />
      <directionalLight position={[3, 5, 4]} intensity={pbr ? 1.5 : 2.2} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} visible={!pbr} />
      {/* Drawn before the model's transparent surfaces and without writing
          depth, so foliage and other alpha-textured meshes blend over it. */}
      <Grid
        ref={grid}
        renderOrder={-1}
        args={[10, 10]}
        cellSize={cell}
        sectionSize={cell * 5}
        cellColor="#d6d3ce"
        sectionColor="#b3aea7"
        fadeDistance={scale * 12}
        fadeStrength={1.5}
        infiniteGrid
      />
      {model && <primitive object={model.object} />}
      <OrbitControls makeDefault enableDamping={false} />
      <BenchmarkOrbit />
    </>
  );
}

export default function Viewer() {
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [dragging, setDragging] = useState(false);
  const current = useRef<LoadedModel | null>(null);
  const [files, setFiles] = useState<File[] | null>(null);
  const request = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [threeMissing, setThreeMissing] = useState<string[]>([]);
  const benchmark = useBenchmark();

  const replaceModel = useCallback((next: LoadedModel | null) => {
    const previous = current.current;
    current.current = next;
    if (previous) {
      disposeObject(previous.object);
      previous.release();
    }
  }, []);

  useEffect(() => () => replaceModel(null), [replaceModel]);

  const open = useCallback(
    async (files: File[], label: string) => {
      const id = ++request.current;
      setStatus({ kind: "loading", label });
      for (const pane of PANE_IDS) startLoad(pane);
      setFiles(files);
      setThreeMissing([]);
      try {
        const model = await loadModel(files);
        if (id === request.current) {
          endLoad("three", estimateGpuBytes(model.object), modelTriangles(model.object));
          // Textures decode after the model; count them once they have arrived.
          setTimeout(() => id === request.current && setGpuBytes("three", estimateGpuBytes(model.object)), 2000);
        }
        if (id !== request.current) {
          disposeObject(model.object);
          model.release();
          return;
        }
        replaceModel(model);
        setStatus({ kind: "ready", model });
        void model.settleTextures().then((names) => {
          if (id !== request.current || !names.length) return;
          setThreeMissing(names);
          setGpuBytes("three", estimateGpuBytes(model.object));
        });
      } catch (error) {
        if (id !== request.current) return;
        replaceModel(null);
        setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [replaceModel],
  );

  const openSample = useCallback(
    async (sample: Sample) => {
      try {
        const base = sample.url.slice(0, sample.url.lastIndexOf("/") + 1);
        const names = [sample.file, ...(sample.extras ?? [])];
        // The model and its sidecars go to every pane as one file set, like a multi-file drop.
        const files = await Promise.all(
          names.map(async (name, i) => {
            const response = await fetch(i === 0 ? sample.url : base + name);
            if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
            return new File([await response.blob()], name);
          }),
        );
        await open(files, sample.title);
      } catch (error) {
        setStatus({ kind: "error", message: `Couldn't fetch the ${sample.title} sample: ${error instanceof Error ? error.message : error}` });
      }
    },
    [open],
  );

  const onFiles = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) void open(files, files.length === 1 ? files[0]!.name : `${files.length} files`);
  };

  const model = status.kind === "ready" ? status.model : null;

  return (
    <div className="mv-app">
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept=".glb,.gltf,.bin,.obj,.mtl,.stl,.fbx,.ply,.png,.jpg,.jpeg,.webp,.ktx2,.tga,.bmp"
          onChange={(event) => {
            onFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      {files && (
        <div className="mv-toolbar">
          <button type="button" className="button mv-open" onClick={() => inputRef.current?.click()}>
            Open files
          </button>
          <span className="mv-samples-label">or try a sample:</span>
          <div className="mv-samples">
            {SAMPLES.map((sample) => (
              <button key={sample.url} type="button" className="mv-chip" onClick={() => void openSample(sample)}>
                {sample.title}
              </button>
            ))}
          </div>
        </div>

      )}

      <div className="mv-stage-wrap">
      <div
        className={`mv-stage${files ? "" : " is-empty"}${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onFiles(event.dataTransfer.files);
        }}
      >
        {files && (
        <>
        <div className="mv-pane">
        <span className="mv-pane-label">three.js</span>
        <PaneStats id="three" />
        <PaneBoundary engine="three.js" resetKey={files}>
        <Canvas
          frameloop={benchmark ? "always" : "demand"}
          dpr={[1, 2]}
          camera={{ fov: 40, position: [3, 2.2, 3.6], near: 0.01, far: 1000 }}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.setClearColor("#f6f5f3");
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            // Time every frame the same way as the other panes: CPU time inside
            // the render call, GPU time from a timer query around it.
            const timer = createGlTimer(gl.getContext() as WebGL2RenderingContext, (ms) => recordGpu("three", ms));
            setGpuSupport("three", timer.supported);
            gl.info.autoReset = false;
            const render = gl.render.bind(gl);
            gl.render = (scene, camera) => {
              timer.poll();
              gl.info.reset();
              timer.begin();
              const start = performance.now();
              render(scene, camera);
              const cpu = performance.now() - start;
              timer.end();
              recordFrame("three", cpu, gl.info.render.calls, gl.info.render.triangles);
            };
          }}
        >
          <Suspense fallback={null}>
            <Scene model={model} />
          </Suspense>
        </Canvas>
        </PaneBoundary>
        {threeMissing.length > 0 && (
          <div className="mv-pane-note">Missing textures, shown untextured: {threeMissing.join(", ")}</div>
        )}
        </div>
        <div className="mv-pane">
          <span className="mv-pane-label">Babylon.js</span>
          <PaneStats id="babylon" />
          {files && (
            <PaneBoundary engine="Babylon.js" resetKey={files}>
              <Suspense fallback={<div className="mv-pane-note">Loading Babylon.js…</div>}>
                <BabylonPane files={files} />
              </Suspense>
            </PaneBoundary>
          )}
        </div>
        {CUSTOM_PANES.map(({ backend, label }) => (
          <div className="mv-pane" key={backend}>
            <span className="mv-pane-label">{label}</span>
            <PaneStats id={backend} />
            {files && (
              <PaneBoundary engine={label} resetKey={files}>
                <Suspense fallback={<div className="mv-pane-note">Loading renderer…</div>}>
                  <CustomPane backend={backend} files={files} />
                </Suspense>
              </PaneBoundary>
            )}
          </div>
        ))}

        </>
        )}

        {status.kind !== "ready" && (
          <div className={`mv-overlay mv-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
            {status.kind === "empty" && (
              <>
                <p className="mv-overlay-title">Drop a 3D model here</p>
                <p>glTF/GLB, OBJ + MTL, STL, FBX or PLY. Drop textures and other referenced files together with the model.</p>
                <p>It opens in three.js, Babylon.js and two hand-written renderers side by side.</p>
                <div className="mv-empty-actions">
                  <button type="button" className="button mv-open" onClick={() => inputRef.current?.click()}>
                    Open files
                  </button>
                  <span className="mv-samples-label">or try a sample:</span>
                  <div className="mv-samples">
                    {SAMPLES.map((sample) => (
                      <button key={sample.url} type="button" className="mv-chip" onClick={() => void openSample(sample)}>
                        {sample.title}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {status.kind === "loading" && <p className="mv-overlay-title">Loading {status.label}…</p>}
            {status.kind === "error" && (
              <>
                <p className="mv-overlay-title">That file couldn't be opened</p>
                <p>{status.message}</p>
              </>
            )}
          </div>
        )}
        {dragging && <div className="mv-dropzone">Drop to open</div>}
      </div>
      {files && <StageBar />}
      </div>

      {files && <PerfTable />}

      <p className="mv-footnote" aria-live="polite">
        {model ? (
          <>
            Showing <strong>{model.name}</strong>. Drag to orbit, right-drag to pan, scroll to zoom.
            {model.missing.length > 0 && (
              <span className="mv-warning"> Missing referenced files: {model.missing.join(", ")}.</span>
            )}
          </>
        ) : (
          "Files are opened in your browser and never uploaded."
        )}
      </p>
    </div>
  );
}
