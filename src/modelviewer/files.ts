// Pure helpers for working out which dropped file is the model and how the
// files it refers to (textures, .bin buffers, .mtl materials) map onto the
// other files the visitor supplied. No three.js imports, so it is unit-testable.

export const MODEL_EXTENSIONS = ["gltf", "glb", "fbx", "obj", "stl", "ply"] as const;
export type ModelFormat = (typeof MODEL_EXTENSIONS)[number];

// When several model files are dropped together, prefer the format that
// carries the most scene information.
const PRIORITY: ModelFormat[] = ["gltf", "glb", "fbx", "obj", "stl", "ply"];

export interface NamedFile {
  name: string;
}

export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function isModelFile(name: string): boolean {
  return (MODEL_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}

/** Strip a query string, hash, URL decoding and any folders, leaving the bare file name. */
export function baseName(ref: string): string {
  let clean = ref.split(/[?#]/)[0] ?? "";
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Leave malformed escapes as they are.
  }
  const parts = clean.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? "";
}

/** Key used to match a reference inside a model to a supplied file: case-insensitive base name. */
export function matchKey(ref: string): string {
  return baseName(ref).toLowerCase();
}

export function buildFileMap<T extends NamedFile>(files: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const file of files) {
    const key = matchKey(file.name);
    if (key && !map.has(key)) map.set(key, file);
  }
  return map;
}

export function resolveReference<T extends NamedFile>(ref: string, map: Map<string, T>): T | undefined {
  return map.get(matchKey(ref));
}

export type PickResult<T> =
  | { ok: true; main: T; format: ModelFormat }
  | { ok: false; error: string };

export function pickMainFile<T extends NamedFile>(files: readonly T[]): PickResult<T> {
  if (files.length === 0) return { ok: false, error: "No files were provided." };
  for (const format of PRIORITY) {
    const main = files.find((file) => extensionOf(file.name) === format);
    if (main) return { ok: true, main, format };
  }
  const names = files.map((file) => file.name).join(", ");
  return {
    ok: false,
    error: `None of these files is a supported model (${names}). Supported formats: glTF/GLB, OBJ (+MTL), STL, FBX and PLY.`,
  };
}

/** Pick the .mtl for an OBJ: the one its mtllib line names, else one with the same base name, else the only one. */
export function pickMaterialFile<T extends NamedFile>(
  objName: string,
  objText: string,
  files: readonly T[],
): T | undefined {
  const mtls = files.filter((file) => extensionOf(file.name) === "mtl");
  if (mtls.length === 0) return undefined;
  const lib = /^\s*mtllib\s+(.+?)\s*$/m.exec(objText)?.[1];
  if (lib) {
    const named = resolveReference(lib, buildFileMap(mtls));
    if (named) return named;
  }
  const stem = matchKey(objName).replace(/\.obj$/, "");
  return mtls.find((file) => matchKey(file.name).replace(/\.mtl$/, "") === stem) ?? (mtls.length === 1 ? mtls[0] : undefined);
}
