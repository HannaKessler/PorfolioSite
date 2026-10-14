// The plain scene format every custom parser produces. No engine types: just
// typed arrays, numbers and encoded image bytes, so it can cross a worker
// boundary and be unit-tested in Node.

export type Wrap = "repeat" | "clamp";

/** An image as stored in (or referenced by) the file. Decoding happens later. */
export interface RawImage {
  /** Encoded bytes (PNG, JPEG, WebP…), or null when the file referenced a sidecar that wasn't supplied. */
  data: Uint8Array | null;
  mimeType: string;
  /** Name the file used for it, for "missing file" messages. */
  name: string;
}

export interface RawTexture {
  image: number;
  wrapS: Wrap;
  wrapT: Wrap;
  /** True when texture v = 0 is the bottom of the image (OBJ, FBX, STL, PLY); false for glTF. */
  flipY: boolean;
}

export interface RawMaterial {
  name: string;
  /** Linear RGB. */
  color: [number, number, number];
  opacity: number;
  transparent: boolean;
  /** Alpha-test threshold (glTF MASK); 0 = none. */
  alphaCutoff: number;
  side: "front" | "back" | "double";
  map: number | null;
  /** Greyscale opacity map (green channel used). */
  alphaMap: number | null;
  vertexColors: boolean;
}

export interface RawPrimitive {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  /** Linear RGB per vertex. */
  colors: Float32Array | null;
  indices: Uint32Array | null;
  material: number;
  /** How to build normals when the file has none: smooth across edges up to this angle (radians); 0 = flat. */
  creaseAngle: number;
  /** Column-major world matrix for this primitive. */
  matrix: Float64Array;
  /** Formats whose textures repeat by default may be clamped when UVs stay in [0, 1]. */
  clampUnitUVs: boolean;
}

export interface RawScene {
  primitives: RawPrimitive[];
  materials: RawMaterial[];
  textures: RawTexture[];
  images: RawImage[];
  /** Referenced sidecar files that weren't supplied. */
  missing: string[];
}

export interface InputFile {
  name: string;
  data: ArrayBuffer;
}

export class UnsupportedError extends Error {
  override name = "UnsupportedError";
}

export function defaultMaterial(name = "default"): RawMaterial {
  return { name, color: [0.8, 0.8, 0.8], opacity: 1, transparent: false, alphaCutoff: 0, side: "front", map: null, alphaMap: null, vertexColors: false };
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" }[ext] ?? "application/octet-stream";
}
