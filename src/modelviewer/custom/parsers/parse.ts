// Entry point: pick the model among the supplied files, wire sidecar lookups
// (textures, .bin, .mtl) by case-insensitive base name, and run the matching parser.
import { readFbxModelFlags } from "../../fbxModels";
import { buildFileMap, extensionOf, matchKey, pickMainFile, pickMaterialFile, resolveReference } from "../../files";
import { parseFbx } from "./fbx/scene";
import { parseGltf } from "./gltf";
import { parseObj, type FileLookup } from "./obj";
import { parsePly } from "./ply";
import { parseStl } from "./stl";
import type { InputFile, RawScene } from "./types";

export async function parseFiles(files: readonly InputFile[]): Promise<{ scene: RawScene; main: string }> {
  const pick = pickMainFile(files);
  if (!pick.ok) throw new Error(pick.error);
  const { main, format } = pick;
  const map = buildFileMap(files);
  const bytes = (file: InputFile) => new Uint8Array(file.data);
  const lookup: FileLookup = (ref) => {
    const file = resolveReference(ref, map);
    return file && file !== main ? bytes(file) : null;
  };
  const data = bytes(main);

  let scene: RawScene;
  switch (format) {
    case "gltf":
    case "glb":
      scene = parseGltf(data, lookup);
      break;
    case "obj": {
      const text = new TextDecoder().decode(data);
      const mtl = pickMaterialFile(main.name, text, files);
      // Fall back to a supplied .mtl when the mtllib name doesn't match exactly.
      scene = parseObj(text, (ref) => lookup(ref) ?? (extensionOf(ref) === "mtl" && mtl ? bytes(mtl) : null));
      break;
    }
    case "stl":
      scene = parseStl(data);
      break;
    case "ply":
      scene = parsePly(data);
      break;
    case "fbx":
      scene = await parseFbx(data, lookup, readFbxModelFlags(main.data));
      break;
  }
  scene.missing = scene.missing.filter((name) => !map.has(matchKey(name)));
  return { scene, main: main.name };
}
