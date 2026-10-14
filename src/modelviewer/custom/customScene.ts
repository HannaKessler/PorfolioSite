// The renderer-ready scene the hand-written WebGPU / WebGL2 renderers draw.
// Produced in a worker by our own parsers (see ./parsers and ./sceneClient);
// geometry is baked to world space, so the renderers only need a view-projection matrix.
import type { Vec3 } from "../mat4";

export interface CustomTexture {
  /** Image decoded without colour conversion or premultiplication, already flipped as the file expects. */
  image: ImageBitmap;
  repeat: boolean;
}

export interface CustomMaterial {
  /** Linear RGB. */
  color: Vec3;
  opacity: number;
  transparent: boolean;
  /** Alpha-test threshold (glTF MASK); 0 = none. */
  alphaCutoff: number;
  side: "front" | "back" | "double";
  map: CustomTexture | null;
  /** Greyscale opacity map; the green channel is used, as in three.js. */
  alphaMap: CustomTexture | null;
  vertexColors: boolean;
  /** glTF metallic-roughness parameters (estimated for other formats). */
  metallic: number;
  roughness: number;
}

export interface CustomPart {
  /** Range in the index buffer (or vertices when not indexed). */
  start: number;
  count: number;
  material: CustomMaterial;
  /** World-space centre, used to sort transparent parts. */
  center: Vec3;
}

export interface CustomMesh {
  positions: Float32Array;
  /** Always present: files without normals get computed ones. */
  normals: Float32Array;
  uvs: Float32Array;
  /** Linear RGB per vertex; all ones when the mesh has none. */
  colors: Float32Array;
  indices: Uint32Array | null;
  parts: CustomPart[];
}

export interface CustomScene {
  meshes: CustomMesh[];
  textures: CustomTexture[];
  min: Vec3;
  max: Vec3;
  stats: { vertices: number; triangles: number };
  /** Referenced files (textures, buffers) that weren't supplied. */
  missing: string[];
}

export function disposeCustomScene(scene: CustomScene): void {
  for (const texture of scene.textures) texture.image.close();
}

/** Material flags shared by both shaders: x hasMap, y hasAlphaMap, z blend (1) or alpha-test cutoff (negative), w unused. */
export function materialFlags(m: CustomMaterial): [number, number, number, number] {
  return [m.map ? 1 : 0, m.alphaMap ? 1 : 0, m.transparent ? 1 : m.alphaCutoff > 0 ? -m.alphaCutoff : 0, 1];
}
