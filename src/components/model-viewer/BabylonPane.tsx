// Babylon.js half of the side-by-side comparison. Loaded lazily (React.lazy)
// so none of Babylon ships with the initial page. Uses deep ES imports so the
// bundler only pulls in the pieces used here.
import { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { FilesInputStore } from "@babylonjs/core/Misc/filesInputStore";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { STLFileLoader } from "@babylonjs/loaders/STL/stlFileLoader.pure";
import { buildFileMap, matchKey, pickMainFile } from "../../modelviewer/files";
import { readFbxModelFlags } from "../../modelviewer/fbxModels";
import { uvsWithinUnitSquare } from "../../modelviewer/uv";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { benchmarkAngle, createGlTimer, endLoad, isBenchmark, recordFrame, recordGpu, setGpuBytes, setGpuSupport } from "../../modelviewer/perf";

registerBuiltInLoaders();

/** Formats with an official Babylon.js mesh loader. (Babylon's .ply support is for Gaussian splats only.) */
const NATIVE = new Set(["gltf", "glb", "obj", "stl", "fbx"]);

const GROUND_SIZE = 1000;

// Keep STL coordinates as stored, like three.js (Babylon swaps Y and Z by default).
STLFileLoader.DO_NOT_ALTER_FILE_COORDINATES = true;

type PaneState = { kind: "idle" } | { kind: "loading" } | { kind: "ready" } | { kind: "note"; text: string };

interface World {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  grid: GridMaterial;
  current: { container: AssetContainer; root: TransformNode } | null;
}

function createWorld(canvas: HTMLCanvasElement): World {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, true);
  const scene = new Scene(engine);
  // Match three.js: right-handed, same background, ACES tone mapping.
  scene.useRightHandedSystem = true;
  scene.clearColor = Color4.FromHexString("#f6f5f3ff");
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;

  const camera = new ArcRotateCamera("camera", 0.876, 1.151, 5, new Vector3(0, 0.5, 0), scene);
  camera.fov = (40 * Math.PI) / 180;
  camera.wheelDeltaPercentage = 0.02;
  // Let the camera call preventDefault on wheel and pointer events, so the
  // wheel zooms the model instead of scrolling the page (as in the three.js pane).
  camera.attachControl(false);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  hemi.groundColor = Color3.FromHexString("#8d8a85");
  const key = new DirectionalLight("key", new Vector3(-3, -5, -4), scene);
  key.intensity = 1.6;
  const fill = new DirectionalLight("fill", new Vector3(4, -2, 3), scene);
  fill.intensity = 0.4;

  const grid = new GridMaterial("grid", scene);
  grid.mainColor = Color3.FromHexString("#f6f5f3");
  grid.lineColor = Color3.FromHexString("#b3aea7");
  grid.opacity = 0.9;
  grid.backFaceCulling = false;
  const ground = CreateGround("grid", { width: 1, height: 1 }, scene);
  ground.material = grid;
  ground.isPickable = false;
  ground.alphaIndex = -1; // drawn first among blended meshes, like the three.js grid
  ground.scaling.set(GROUND_SIZE, 1, GROUND_SIZE);
  setGridScale(grid, 1);

  // Measured like the other panes: CPU time inside the render call, GPU time
  // from a timer query (EXT_disjoint_timer_query_webgl2) on the canvas's own context.
  const context = canvas.getContext("webgl2");
  const timer = context ? createGlTimer(context, (ms) => recordGpu("babylon", ms)) : null;
  setGpuSupport("babylon", !!timer?.supported);
  const sceneStats = new SceneInstrumentation(scene);
  let benchBase: number | null = null;
  engine.runRenderLoop(() => {
    if (isBenchmark()) {
      benchBase ??= camera.alpha;
      // Babylon's alpha turns the opposite way to the three.js azimuth.
      camera.alpha = benchBase - benchmarkAngle();
    } else benchBase = null;
    timer?.poll();
    timer?.begin();
    const start = performance.now();
    scene.render();
    const cpu = performance.now() - start;
    timer?.end();
    recordFrame("babylon", cpu, sceneStats.drawCallsCounter.current, scene.getActiveIndices() / 3);
  });
  return { engine, scene, camera, grid, current: null };
}

function setGridScale(grid: GridMaterial, radius: number) {
  const cell = Math.pow(10, Math.floor(Math.log10(Math.max(radius, 1e-6))) - 1) * 2;
  grid.gridRatio = cell / GROUND_SIZE; // GridMaterial works in the ground's local (unscaled) units
  grid.majorUnitFrequency = 5;
  grid.minorUnitVisibility = 0.35;
}

function clearModel(world: World) {
  if (!world.current) return;
  world.current.container.dispose();
  world.current.root.dispose();
  world.current = null;
}

/** Centre on the grid, sit on y = 0, frame like the three.js pane. */
function placeAndFrame(world: World, root: TransformNode, meshes: AbstractMesh[]) {
  const visible = meshes.filter((m) => m.getTotalVertices() > 0);
  if (!visible.length) return;
  root.computeWorldMatrix(true);
  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of visible) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min = Vector3.Minimize(min, box.minimumWorld);
    max = Vector3.Maximize(max, box.maximumWorld);
  }
  const size = max.subtract(min);
  const center = min.add(max).scale(0.5);
  root.position.set(-center.x, -min.y, -center.z);

  const radius = Math.max(size.length() / 2, 1e-6);
  const distance = (radius / Math.sin(world.camera.fov / 2)) * 1.15;
  const { camera } = world;
  camera.setTarget(new Vector3(0, size.y / 2, 0));
  camera.alpha = 0.876;
  camera.beta = 1.151;
  camera.radius = distance;
  camera.minZ = distance / 1000;
  camera.maxZ = distance * 100;
  camera.lowerRadiusLimit = distance / 100;
  camera.panningSensibility = 1000 / radius;
  setGridScale(world.grid, radius);
}

/** Same file-setting fixes as the three.js loader, where Babylon's loaders don't already apply them. */
function applyFileSettings(format: string, meshes: AbstractMesh[], fbxBuffer: ArrayBuffer | null) {
  if (format === "fbx" && fbxBuffer) {
    try {
      const flags = readFbxModelFlags(fbxBuffer);
      const names = (m: AbstractMesh) => [m.name, m.parent?.name ?? ""];
      for (const mesh of meshes) {
        // FBX opacity maps are greyscale; three.js reads them as an alpha map,
        // Babylon expects alpha in the texture's alpha channel unless told otherwise.
        const opacity = (mesh.material as { opacityTexture?: { getAlphaFromRGB: boolean } } | null)?.opacityTexture;
        if (opacity) opacity.getAlphaFromRGB = true;
        if (names(mesh).some((n) => flags.hidden.has(n))) mesh.setEnabled(false);
        if (mesh.material && names(mesh).some((n) => flags.doubleSided.has(n))) mesh.material.backFaceCulling = false;
      }
    } catch {
      // Unreadable flags: keep what the loader produced.
    }
  }
  if (format === "fbx" || format === "obj") clampTexturesForUnitUVs(meshes);
  // Alpha-blended, textured surfaces (foliage cards) are one mesh and can't be
  // sorted per face, so don't let them hide each other through depth writes.
  for (const mesh of meshes) {
    const material = mesh.material as (AbstractMesh["material"] & { diffuseTexture?: unknown; albedoTexture?: unknown; opacityTexture?: unknown }) | null;
    if (!material || !material.needAlphaBlending()) continue;
    if (material.diffuseTexture || material.albedoTexture || material.opacityTexture) material.disableDepthWrite = true;
  }
}

/** Same rule as the three.js loader: clamp instead of repeat when a mesh's UVs never leave [0, 1]. */
function clampTexturesForUnitUVs(meshes: AbstractMesh[]) {
  const clampable = new Set<Texture>();
  const tiled = new Set<Texture>();
  for (const mesh of meshes) {
    if (!mesh.material) continue;
    const inside = uvsWithinUnitSquare(mesh.getVerticesData(VertexBuffer.UVKind));
    for (const texture of mesh.material.getActiveTextures()) {
      if (!(texture instanceof Texture)) continue;
      const untransformed = texture.uScale === 1 && texture.vScale === 1 && texture.uOffset === 0 && texture.vOffset === 0 && texture.wAng === 0;
      (inside && untransformed && texture.coordinatesIndex === 0 ? clampable : tiled).add(texture);
    }
  }
  for (const texture of clampable) {
    if (tiled.has(texture)) continue;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  }
}

/** Approximate GPU memory: vertex/index data plus mipmapped RGBA textures. */
function estimateGpuBytes(container: AssetContainer): number {
  let bytes = 0;
  for (const mesh of container.meshes) {
    for (const kind of [VertexBuffer.PositionKind, VertexBuffer.NormalKind, VertexBuffer.UVKind, VertexBuffer.UV2Kind, VertexBuffer.ColorKind, VertexBuffer.TangentKind]) bytes += (mesh.getVerticesData(kind)?.length ?? 0) * 4;
    bytes += (mesh.getIndices()?.length ?? 0) * 4;
  }
  for (const texture of container.textures) {
    const size = texture.getSize();
    bytes += size.width * size.height * 4 * (4 / 3);
  }
  return Math.round(bytes);
}

/** Triangles in the model's enabled meshes, each counted once. */
function modelTriangles(container: AssetContainer): number {
  let triangles = 0;
  for (const mesh of container.meshes) {
    if (!mesh.isEnabled()) continue;
    const indices = mesh.getTotalIndices();
    triangles += Math.floor((indices > 0 ? indices : mesh.getTotalVertices()) / 3);
  }
  return triangles;
}

export default function BabylonPane({ files }: { files: File[] | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [state, setState] = useState<PaneState>({ kind: "idle" });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const world = createWorld(canvas);
    worldRef.current = world;
    const observer = new ResizeObserver(() => world.engine.resize());
    observer.observe(canvas);
    const stopScroll = (event: WheelEvent) => event.preventDefault();
    canvas.addEventListener("wheel", stopScroll, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", stopScroll);
      observer.disconnect();
      clearModel(world);
      world.scene.dispose();
      world.engine.dispose();
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    const world = worldRef.current;
    if (!world || !files) return;
    let cancelled = false;
    clearModel(world);
    const pick = pickMainFile(files);
    if (!pick.ok) {
      setState({ kind: "note", text: pick.error });
      return;
    }
    if (!NATIVE.has(pick.format)) {
      setState({ kind: "note", text: `.${pick.format.toUpperCase()} isn't compatible with Babylon.js.` });
      return;
    }
    setState({ kind: "loading" });
    // Babylon resolves "file:" references (textures, .mtl, .bin) through
    // FilesInputStore; route lookups through the same matching as three.js.
    const map = buildFileMap(files);
    FilesInputStore.FilesToLoad = new Proxy({} as Record<string, File>, {
      get: (_, key) => (typeof key === "string" ? map.get(matchKey(key)) : undefined),
      has: (_, key) => typeof key === "string" && map.has(matchKey(key)),
    });
    (async () => {
      const fbxBuffer = pick.format === "fbx" ? await pick.main.arrayBuffer() : null;
      const container = await LoadAssetContainerAsync(pick.main, world.scene, { pluginExtension: `.${pick.format}` });
      if (cancelled) {
        container.dispose();
        return;
      }
      container.addAllToScene();
      const root = new TransformNode("model", world.scene);
      for (const node of container.rootNodes) node.parent = root;
      applyFileSettings(pick.format, container.meshes, fbxBuffer);
      world.current = { container, root };
      placeAndFrame(world, root, container.meshes);
      endLoad("babylon", estimateGpuBytes(container), modelTriangles(container));
      // Textures finish decoding after the container loads; count them again shortly.
      setTimeout(() => !cancelled && setGpuBytes("babylon", estimateGpuBytes(container)), 2000);
      setState({ kind: "ready" });
    })().catch((error: unknown) => {
      if (cancelled) return;
      setState({ kind: "note", text: `Babylon.js couldn't open this file: ${error instanceof Error ? error.message : String(error)}` });
    });
    return () => {
      cancelled = true;
    };
  }, [files]);

  return (
    <>
      <canvas ref={canvasRef} className="mv-babylon-canvas" />
      {state.kind === "loading" && <div className="mv-pane-note">LoadingÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</div>}
      {state.kind === "note" && <div className="mv-pane-note">{state.text}</div>}
    </>
  );
}
