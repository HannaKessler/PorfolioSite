/// <reference lib="webworker" />
// Parses dropped model files off the main thread with our own parsers, builds
// the renderer-ready scene, decodes only the images materials use, and posts
// everything back as transferables (array buffers and ImageBitmaps).
import { buildScene, type BuiltTextureRef } from "./parsers/build";
import { parseFiles } from "./parsers/parse";
import type { InputFile } from "./parsers/types";
import type { CustomMaterial, CustomScene, CustomTexture } from "./customScene";

export interface WorkerRequest {
  id: number;
  files: InputFile[];
}
export type WorkerResponse = { id: number; ok: true; scene: CustomScene } | { id: number; ok: false; error: string; unsupported: boolean };

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, files } = event.data;
  try {
    const { scene: raw } = await parseFiles(files);
    const built = buildScene(raw);
    if (!built.meshes.length) throw new Error("The model has no triangles to draw.");

    const textures: CustomTexture[] = [];
    const cache = new Map<string, Promise<CustomTexture | null>>();
    const texture = (ref: BuiltTextureRef | null): Promise<CustomTexture | null> => {
      if (!ref) return Promise.resolve(null);
      const key = `${ref.image}:${ref.repeat}:${ref.flipY}`;
      let pending = cache.get(key);
      if (!pending) {
        const image = raw.images[ref.image]!;
        pending = createImageBitmap(new Blob([image.data! as BlobPart], { type: image.mimeType }), {
          imageOrientation: ref.flipY ? "flipY" : "from-image",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        }).then(
          (bitmap) => {
            const t = { image: bitmap, repeat: ref.repeat };
            textures.push(t);
            return t;
          },
          () => {
            raw.missing.push(`${image.name} (couldn't decode)`);
            return null;
          },
        );
        cache.set(key, pending);
      }
      return pending;
    };

    const meshes = await Promise.all(
      built.meshes.map(async (mesh) => ({
        ...mesh,
        parts: await Promise.all(
          mesh.parts.map(async (part) => {
            const [map, alphaMap] = await Promise.all([texture(part.material.map), texture(part.material.alphaMap)]);
            const { name: _name, ...rest } = part.material;
            const material: CustomMaterial = { ...rest, map, alphaMap };
            return { ...part, material };
          }),
        ),
      })),
    );
    const scene: CustomScene = { meshes, textures, min: built.min, max: built.max, stats: built.stats, missing: raw.missing };
    const transfer: Transferable[] = [...textures.map((t) => t.image)];
    const seen = new Set<ArrayBufferLike>();
    for (const m of meshes)
      for (const array of [m.positions, m.normals, m.uvs, m.colors, m.indices])
        if (array && !seen.has(array.buffer)) {
          seen.add(array.buffer);
          transfer.push(array.buffer as ArrayBuffer);
        }
    self.postMessage({ id, ok: true, scene } satisfies WorkerResponse, transfer);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ id, ok: false, error: message, unsupported: error instanceof Error && error.name === "UnsupportedError" } satisfies WorkerResponse);
  }
};
