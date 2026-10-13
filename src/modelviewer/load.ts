import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { setupAlpha } from "./alpha";
import { buildFileMap, matchKey, pickMainFile, pickMaterialFile } from "./files";

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
  const material = new THREE.MeshStandardMaterial({
    color: hasColor ? 0xffffff : 0xb9b4ad,
    vertexColors: hasColor,
    roughness: 0.55,
    metalness: 0.05,
  });
  return new THREE.Mesh(geometry, material);
}

/**
 * Load a model from files the visitor supplied. Every file becomes a blob: URL,
 * and a LoadingManager URL modifier maps each reference inside the model
 * (textures, .bin buffers) to the supplied file with the same name.
 */
export interface LoadOptions {
  /** Whether the renderer uses MSAA (enables alpha-to-coverage on cutouts). */
  antialias?: boolean;
  /** Called when materials change after load (texture alpha is detected asynchronously). */
  onChange?: () => void;
}

export async function loadModel(files: File[], options: LoadOptions = {}): Promise<LoadedModel> {
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
    if (url.startsWith("data:") || ownUrls.has(url)) return url;
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
    setupAlpha(object, {
      fromGltf: format === "gltf" || format === "glb",
      antialias: options.antialias ?? true,
      onChange: options.onChange,
    });
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
