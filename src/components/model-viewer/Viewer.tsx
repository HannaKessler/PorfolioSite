import { type ReactNode, Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { disposeObject, loadModel, type LoadedModel } from "../../modelviewer/load";
import { SAMPLES, type Sample } from "../../modelviewer/samples";

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

function Scene({ model }: { model: LoadedModel | null }) {
  const { camera, controls, invalidate } = useThree();
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
      <hemisphereLight args={[0xffffff, 0x8d8a85, 1.6]} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} />
      <directionalLight position={[-4, 2, -3]} intensity={0.6} />
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
      setFiles(files);
      try {
        const model = await loadModel(files);
        if (id !== request.current) {
          disposeObject(model.object);
          model.release();
          return;
        }
        replaceModel(model);
        setStatus({ kind: "ready", model });
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
        const response = await fetch(sample.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        await open([new File([blob], sample.file)], sample.title);
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
      <div className="mv-toolbar">
        <button type="button" className="button mv-open" onClick={() => inputRef.current?.click()}>
          Open files
        </button>
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
        <span className="mv-samples-label">or try a sample:</span>
        <div className="mv-samples">
          {SAMPLES.map((sample) => (
            <button key={sample.url} type="button" className="mv-chip" onClick={() => void openSample(sample)}>
              {sample.title}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`mv-stage${dragging ? " is-dragging" : ""}`}
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
        <div className="mv-pane">
        <span className="mv-pane-label">three.js</span>
        <PaneBoundary engine="three.js" resetKey={files}>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: 40, position: [3, 2.2, 3.6], near: 0.01, far: 1000 }}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          onCreated={({ gl }) => {
            gl.setClearColor("#f6f5f3");
            gl.toneMapping = THREE.ACESFilmicToneMapping;
          }}
        >
          <Suspense fallback={null}>
            <Scene model={model} />
          </Suspense>
        </Canvas>
        </PaneBoundary>
        </div>
        <div className="mv-pane">
          <span className="mv-pane-label">Babylon.js</span>
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
            {model && (
              <PaneBoundary engine={label} resetKey={model}>
                <Suspense fallback={<div className="mv-pane-note">Loading renderer…</div>}>
                  <CustomPane backend={backend} model={model} />
                </Suspense>
              </PaneBoundary>
            )}
          </div>
        ))}

        {status.kind !== "ready" && (
          <div className={`mv-overlay mv-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
            {status.kind === "empty" && (
              <>
                <p className="mv-overlay-title">Drop a 3D model here</p>
                <p>glTF/GLB, OBJ + MTL, STL, FBX or PLY. Drop textures and other referenced files together with the model.</p>
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
