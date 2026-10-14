import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { readFbxModelFlags } from "./fbxModels";
import { uvsWithinUnitSquare } from "./uv";
import { shininessToRoughness, type LightingMode } from "./lighting";
import { hasOpenEdges, NO_SIDE_INFO } from "./openEdges";
import { buildFileMap, matchKey, objNeedsSmoothNormals, pickMainFile, pickMaterialFile } from "./files";

export interface LoadedModel {
  /** Waits for textures to finish, strips any that failed to load; resolves with their names. */
  settleTextures: () => Promise<string[]>;
  object: THREE.Object3D;
  name: string;
  /** Files the model referred to that were not supplied. */
  missing: string[];
  /** Release the blob: URLs created for the supplied files. */
  release: () => void;
}

const DRACO_PATH = "/projects/model-viewer/draco/";
let draco: DRACOLoader | undefined;

function dracoLoader(): DRACOLoader {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
  }
  return draco;
}

function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const hasColor = Boolean(geometry.getAttribute("color"));
  // Binary STL may carry a default color with alpha in its header ("COLOR=rgba").
  const alpha = (geometry as THREE.BufferGeometry & { alpha?: number }).alpha;
  const translucent = typeof alpha === "number" && alpha < 1;
  const material = new THREE.MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0xb9b4ad,
    vertexColors: hasColor,
    roughness: 0.55,
    metalness: 0.05,
    ...(translucent ? { transparent: true, opacity: alpha, depthWrite: false } : {}),
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Load a model from files the visitor supplied. Every file becomes a blob: URL,
 * and a LoadingManager URL modifier maps each reference inside the model
 * (textures, .bin buffers) to the supplied file with the same name.
 */
export async function loadModel(files: File[]): Promise<LoadedModel> {
  const pick = pickMainFile(files);
  if (!pick.ok) throw new Error(pick.error);
  const { main, format } = pick;

  const map = buildFileMap(files);
  const urls = new Map<string, string>();
  const urlFor = (file: File) => {
    const key = matchKey(file.name);
    let url = urls.get(key);
    if (!url) {
      url = URL.createObjectURL(file);
      urls.set(key, url);
    }
    return url;
  };
  const release = () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  const ownUrls = new Set<string>();
  const missing = new Set<string>();

  const manager = new THREE.LoadingManager();
  let settled = false;
  manager.onStart = () => (settled = false);
  manager.onLoad = () => (settled = true);
  const failedFiles = new Set<string>();
  manager.onError = (url) => failedFiles.add(decodeSafe(url.split(/[\\/]/).pop() ?? url));
  manager.setURLModifier((url) => {
    // data: and blob: URLs are textures embedded in the model file itself
    // (FBXLoader and GLTFLoader create blob: URLs for them).
    if (url.startsWith("data:") || url.startsWith("blob:") || ownUrls.has(url)) return url;
    const file = map.get(matchKey(url));
    if (file) {
      const blobUrl = urlFor(file);
      ownUrls.add(blobUrl);
      return blobUrl;
    }
    missing.add(decodeSafe(url.split("/").pop() ?? url));
    return url;
  });

  const mainUrl = urlFor(main);
  ownUrls.add(mainUrl);

  try {
    let object: THREE.Object3D;
    switch (format) {
      case "gltf":
      case "glb": {
        const loader = new GLTFLoader(manager);
        loader.setDRACOLoader(dracoLoader());
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.loadAsync(mainUrl);
        object = gltf.scene;
        break;
      }
      case "fbx":
        object = await new FBXLoader(manager).loadAsync(mainUrl);
        applyFbxModelFlags(object, await main.arrayBuffer());
        break;
      case "obj": {
        const text = await main.text();
        const loader = new OBJLoader(manager);
        const mtl = pickMaterialFile(main.name, text, files);
        if (mtl) {
          const materials = new MTLLoader(manager).parse(await mtl.text(), "");
          materials.preload();
          loader.setMaterials(materials);
        }
        object = loader.parse(text);
        if (objNeedsSmoothNormals(text)) smoothObjNormals(object);
        break;
      }
      case "stl":
        object = meshFromGeometry(new STLLoader(manager).parse(await main.arrayBuffer()));
        break;
      case "ply":
        object = meshFromGeometry(new PLYLoader(manager).parse(await main.arrayBuffer()));
        break;
    }

    if (!hasRenderableContent(object)) {
      disposeObject(object);
      throw new Error(`${main.name} loaded but contains no visible geometry.`);
    }
    object.name = main.name;
    if (NO_SIDE_INFO.has(format)) doubleSideOpenMeshes(object);
    if (format === "fbx" || format === "obj") clampTexturesForUnitUVs(object);
    disableDepthWriteOnTexturedTransparency(object);
    // Textures finish loading after the model itself, so the blob URLs stay
    // alive until the model is replaced.
    // Prefer the referenced file names over three's internal texture names in the note.
    const settleTextures = async () => {
      const names = await dropFailedTextures(object, () => settled);
      return names.length && failedFiles.size ? [...failedFiles] : names;
    };
    return { object, name: main.name, missing: [...missing], release, settleTextures };
  } catch (error) {
    release();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't read ${main.name} as ${format.toUpperCase()}: ${reason}`);
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasRenderableContent(object: THREE.Object3D): boolean {
  let found = false;
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geometry?.getAttribute?.("position")?.count) found = true;
  });
  return found;
}

/** Open meshes in formats without a sidedness flag are drawn double-sided (see openEdges.ts). */
function doubleSideOpenMeshes(object: THREE.Object3D): void {
  const converted = new Map<THREE.Material, THREE.Material>();
  const toDoubleSided = (material: THREE.Material) => {
    let result = converted.get(material);
    if (!result) {
      result = material.side === THREE.DoubleSide ? material : material.clone();
      result.side = THREE.DoubleSide;
      converted.set(material, result);
    }
    return result;
  };
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute("position");
    if (!position || !hasOpenEdges(position.array, mesh.geometry.index?.array ?? null)) return;
    const old = mesh.material;
    mesh.material = Array.isArray(old) ? old.map(toDoubleSided) : toDoubleSided(old);
  });
}

/**
 * Apply FBX per-model settings FBXLoader ignores: "Culling: CullingOff" makes
 * the model double-sided, and Visibility = 0 / Show = false hide it (removed,
 * so it doesn't affect framing either). glTF's doubleSided is already applied
 * by GLTFLoader; OBJ, STL and PLY have no such flags.
 */
function applyFbxModelFlags(object: THREE.Object3D, buffer: ArrayBuffer): void {
  let flags: ReturnType<typeof readFbxModelFlags>;
  try {
    flags = readFbxModelFlags(buffer);
  } catch {
    return; // Unreadable: keep the loader's defaults.
  }
  const sanitize = (names: Set<string>) => new Set([...names].map((name) => THREE.PropertyBinding.sanitizeNodeName(name)));
  const doubleSided = sanitize(flags.doubleSided);
  const hidden = sanitize(flags.hidden);
  if (doubleSided.size === 0 && hidden.size === 0) return;

  const converted = new Map<THREE.Material, THREE.Material>();
  const toDoubleSided = (material: THREE.Material) => {
    let result = converted.get(material);
    if (!result) {
      result = material.side === THREE.DoubleSide ? material : material.clone();
      result.side = THREE.DoubleSide;
      converted.set(material, result);
    }
    return result;
  };
  const toRemove: THREE.Object3D[] = [];
  object.traverse((child) => {
    if (hidden.has(child.name)) {
      toRemove.push(child);
      return;
    }
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !doubleSided.has(mesh.name)) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toDoubleSided) : toDoubleSided(mesh.material);
  });
  for (const child of toRemove) {
    child.removeFromParent();
    disposeObject(child);
  }
}

/**
 * OBJ files without "vn" normals that turn smoothing on ("s 1") should look
 * smooth, but OBJLoader fills in per-face normals, so they render faceted.
 * Rebuild normals for those meshes, averaged across edges up to 60 degrees
 * so hard corners stay crisp (OBJLoader merges all smoothing groups, so the
 * group boundaries themselves aren't available).
 */
function smoothObjNormals(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => (material as THREE.MeshPhongMaterial).flatShading)) return;
    mesh.geometry.deleteAttribute("normal");
    mesh.geometry = toCreasedNormals(mesh.geometry, Math.PI / 3);
  });
}

/**
 * Transparent materials with a texture (foliage cards, decals) should not
 * write depth. Loaders such as FBXLoader leave depthWrite on, and when all
 * the cards are in one mesh three.js cannot sort them, so the fully
 * transparent part of a near card hides blades on the cards behind it.
 * Turning depthWrite off for these materials only keeps the soft blended
 * edges. Opaque materials, alpha-tested (glTF MASK) materials and untextured
 * transparent materials are left as loaded.
 */
const TEXTURE_SLOTS = ["map", "alphaMap", "normalMap", "bumpMap", "specularMap", "emissiveMap", "roughnessMap", "metalnessMap", "aoMap", "lightMap", "displacementMap"] as const;

/**
 * FBX and OBJ textures default to Repeat wrapping. When a mesh's UVs stay
 * inside [0, 1] nothing tiles, and Repeat only makes filtering at the UV
 * edges pull in texels from the opposite edge of the image (e.g. a faint
 * dotted line along the top of foliage cards whose blades touch the bottom
 * of the texture). Clamp those textures, unless another mesh tiles them or
 * the texture itself is offset or scaled.
 */
function clampTexturesForUnitUVs(object: THREE.Object3D): void {
  const clampable = new Set<THREE.Texture>();
  const tiled = new Set<THREE.Texture>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const inside = uvsWithinUnitSquare(mesh.geometry.getAttribute("uv")?.array as ArrayLike<number> | undefined);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = (material as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
        if (!texture?.isTexture) continue;
        const untransformed = texture.repeat.x === 1 && texture.repeat.y === 1 && texture.offset.x === 0 && texture.offset.y === 0 && texture.rotation === 0;
        (inside && untransformed && texture.channel === 0 ? clampable : tiled).add(texture);
      }
    }
  });
  for (const texture of clampable) {
    if (tiled.has(texture)) continue;
    if (texture.wrapS === THREE.ClampToEdgeWrapping && texture.wrapT === THREE.ClampToEdgeWrapping) continue;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
  }
}

function disableDepthWriteOnTexturedTransparency(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
      if (material.transparent && (textured.map || textured.alphaMap)) material.depthWrite = false;
    }
  });
}

type LightingData = { mvSimple?: THREE.Material | THREE.Material[]; mvPbr?: THREE.Material | THREE.Material[] };

/**
 * A physically based copy of a loaded material. glTF materials are already
 * MeshStandardMaterial and are used as they are; Phong/Lambert/Basic materials
 * (OBJ, FBX) become MeshStandardMaterial with roughness estimated from their
 * shininess and no metalness. Textures are shared, not copied.
 */
export function toPbrMaterial(material: THREE.Material): THREE.Material {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
  const m = material as THREE.MeshPhongMaterial;
  const pbr = new THREE.MeshStandardMaterial({
    name: m.name,
    color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
    map: m.map ?? null,
    alphaMap: m.alphaMap ?? null,
    normalMap: m.normalMap ?? null,
    bumpMap: m.bumpMap ?? null,
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000),
    emissiveMap: m.emissiveMap ?? null,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    vertexColors: m.vertexColors,
    flatShading: m.flatShading ?? false,
    roughness: shininessToRoughness(typeof m.shininess === "number" ? m.shininess : 30),
    metalness: 0,
  });
  pbr.transparent = m.transparent;
  pbr.opacity = m.opacity;
  pbr.alphaTest = m.alphaTest;
  pbr.side = m.side;
  pbr.depthWrite = m.depthWrite;
  pbr.visible = m.visible;
  return pbr;
}

/** Switch a loaded model between its loaded materials ("simple") and physically based copies ("pbr"). */
export function setModelLighting(root: THREE.Object3D, mode: LightingMode): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const data = mesh.userData as LightingData;
    data.mvSimple ??= mesh.material;
    if (mode === "simple") {
      mesh.material = data.mvSimple;
      return;
    }
    data.mvPbr ??= Array.isArray(data.mvSimple) ? data.mvSimple.map(toPbrMaterial) : toPbrMaterial(data.mvSimple);
    mesh.material = data.mvPbr;
  });
}

/** Free GPU memory held by a model: geometries, materials and their textures. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const data = mesh.userData as LightingData;
    const materials = [...new Set([mesh.material, data.mvSimple, data.mvPbr].flat().filter((m): m is THREE.Material => !!m))];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function textureLoaded(texture: THREE.Texture): boolean {
  const image = texture.image as { width?: number; naturalWidth?: number; data?: unknown } | undefined | null;
  return !!image && ((image.naturalWidth ?? image.width ?? 0) > 0 || !!image.data);
}

/**
 * A texture whose file is missing or unreadable stays empty, and three.js then samples it as black.
 * Once loading settles (or after 10 s), remove such textures from their materials so the surface
 * shows its plain material colour, like the other panes.
 */
async function dropFailedTextures(object: THREE.Object3D, settled: () => boolean): Promise<string[]> {
  const materials = new Set<THREE.Material>();
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    if (material) for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
  });
  const slots = (m: THREE.Material) =>
    Object.entries(m).filter((entry): entry is [string, THREE.Texture] => (entry[1] as THREE.Texture | null)?.isTexture === true);
  const all = [...materials].flatMap(slots).map(([, t]) => t);
  const started = performance.now();
  while (!all.every(textureLoaded) && !settled() && performance.now() - started < 10000) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const failed = new Set<THREE.Texture>(all.filter((t) => !textureLoaded(t)));
  if (!failed.size) return [];
  for (const material of materials) {
    let changed = false;
    for (const [key, texture] of slots(material)) {
      if (!failed.has(texture)) continue;
      (material as unknown as Record<string, unknown>)[key] = null;
      changed = true;
    }
    if (changed) material.needsUpdate = true;
  }
  for (const texture of failed) texture.dispose();
  return [...new Set([...failed].map((t) => decodeSafe((t.name || String((t as { sourceFile?: string }).sourceFile ?? "texture")).split(/[\\/]/).pop()!)))];
}
