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
import { buildFileMap, matchKey, objNeedsSmoothNormals, pickMainFile, pickMaterialFile } from "./files";

export interface LoadedModel {
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
    disableDepthWriteOnTexturedTransparency(object);
    // Textures finish loading after the model itself, so the blob URLs stay
    // alive until the model is replaced.
    return { object, name: main.name, missing: [...missing], release };
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

/** Free GPU memory held by a model: geometries, materials and their textures. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
