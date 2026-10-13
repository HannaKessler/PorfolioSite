// Turns the model three.js has already parsed into plain arrays and images for
// the hand-written WebGPU / WebGL2 renderers. Geometry is baked to world space,
// so the renderers only need a view-projection matrix.
import * as THREE from "three";
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
  side: "front" | "back" | "double";
  map: CustomTexture | null;
  /** Greyscale opacity map; the green channel is used, as in three.js. */
  alphaMap: CustomTexture | null;
  vertexColors: boolean;
  flatShading: boolean;
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
  normals: Float32Array;
  uvs: Float32Array;
  /** Linear RGB per vertex; all ones when the mesh has none. */
  colors: Float32Array;
  indices: Uint32Array | null;
  hasNormals: boolean;
  parts: CustomPart[];
}

export interface CustomScene {
  meshes: CustomMesh[];
  textures: CustomTexture[];
  min: Vec3;
  max: Vec3;
}

export function disposeCustomScene(scene: CustomScene): void {
  for (const texture of scene.textures) texture.image.close();
}

/** Wait until three.js has finished decoding the image behind a texture (FBX/OBJ textures load after the model). */
async function textureImage(texture: THREE.Texture, timeoutMs = 20000): Promise<CanvasImageSource | ImageData | null> {
  const started = performance.now();
  for (;;) {
    const image = texture.image as unknown;
    if (image instanceof HTMLImageElement) {
      if (image.complete && image.naturalWidth > 0) return image;
    } else if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      return image;
    } else if (image instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== "undefined" && image instanceof OffscreenCanvas)) {
      return image;
    } else if (image && typeof image === "object" && "data" in image && "width" in image && "height" in image) {
      const { data, width, height } = image as { data: ArrayLike<number>; width: number; height: number };
      if (data && data.length === width * height * 4) return new ImageData(new Uint8ClampedArray(data as ArrayLike<number>), width, height);
      return null;
    }
    if (performance.now() - started > timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function materialOf(material: THREE.Material): Omit<CustomMaterial, "map" | "alphaMap"> & { mapTexture: THREE.Texture | null; alphaTexture: THREE.Texture | null } {
  const m = material as THREE.MeshStandardMaterial & { flatShading?: boolean };
  const color = m.color ? ([m.color.r, m.color.g, m.color.b] as Vec3) : ([1, 1, 1] as Vec3);
  return {
    color,
    opacity: m.opacity ?? 1,
    transparent: !!m.transparent,
    side: m.side === THREE.DoubleSide ? "double" : m.side === THREE.BackSide ? "back" : "front",
    vertexColors: !!m.vertexColors,
    flatShading: !!m.flatShading,
    mapTexture: m.map ?? null,
    alphaTexture: m.alphaMap ?? null,
  };
}

/** Copy an attribute through its accessors, so interleaved and normalized data come out as plain floats. */
function readAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, components: number, fill: number): Float32Array {
  const out = new Float32Array(attribute.count * components).fill(fill);
  const n = Math.min(components, attribute.itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < n; c++) out[i * components + c] = attribute.getComponent(i, c);
  }
  return out;
}

export async function extractScene(root: THREE.Object3D, signal: { cancelled: boolean }): Promise<CustomScene> {
  root.updateMatrixWorld(true);
  const meshes: CustomMesh[] = [];
  const textureCache = new Map<THREE.Texture, Promise<CustomTexture | null>>();
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  const convertTexture = (texture: THREE.Texture | null): Promise<CustomTexture | null> => {
    if (!texture) return Promise.resolve(null);
    let pending = textureCache.get(texture);
    if (!pending) {
      pending = (async () => {
        const source = await textureImage(texture);
        if (!source || signal.cancelled) return null;
        const image = await createImageBitmap(source as ImageBitmapSource, {
          imageOrientation: texture.flipY && !(source instanceof ImageData) ? "flipY" : "from-image",
          premultiplyAlpha: "none",
          colorSpaceConversion: "none",
        });
        // Clamp/repeat as decided by the loader (including the unit-UV clamp in load.ts).
        return { image, repeat: texture.wrapS === THREE.RepeatWrapping || texture.wrapT === THREE.RepeatWrapping };
      })();
      textureCache.set(texture, pending);
    }
    return pending;
  };

  const tasks: Promise<void>[] = [];
  root.traverseVisible((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position || position.count === 0) return;

    const world = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
    const positions = readAttribute(position, 3, 0);
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromArray(positions, i * 3).applyMatrix4(world).toArray(positions, i * 3);
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, positions[i * 3 + c]!);
        max[c] = Math.max(max[c]!, positions[i * 3 + c]!);
      }
    }
    const normalAttribute = geometry.getAttribute("normal");
    const normals = normalAttribute ? readAttribute(normalAttribute, 3, 0) : new Float32Array(position.count * 3);
    if (normalAttribute) {
      for (let i = 0; i < position.count; i++) v.fromArray(normals, i * 3).applyMatrix3(normalMatrix).normalize().toArray(normals, i * 3);
    }
    const uvAttribute = geometry.getAttribute("uv");
    const uvs = uvAttribute ? readAttribute(uvAttribute, 2, 0) : new Float32Array(position.count * 2);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Vertex colours only count when the material asks for them, as in three.js.
    const colorAttribute = materials.some((m) => m.vertexColors) ? geometry.getAttribute("color") : undefined;
    const colors = colorAttribute ? readAttribute(colorAttribute, 3, 1) : new Float32Array(position.count * 3).fill(1);
    const indices = geometry.index ? Uint32Array.from(geometry.index.array as ArrayLike<number>) : null;

    // A mirrored transform flips the winding; swap two corners of each triangle to keep front faces.
    if (world.determinant() < 0) {
      if (indices) {
        for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
      } else {
        for (const [array, size] of [[positions, 3], [normals, 3], [uvs, 2], [colors, 3]] as const) {
          for (let t = 0; t + 2 < position.count; t += 3) {
            for (let c = 0; c < size; c++) {
              const a = (t + 1) * size + c;
              const b = (t + 2) * size + c;
              [array[a], array[b]] = [array[b]!, array[a]!];
            }
          }
        }
      }
    }

    const box = new THREE.Box3().setFromBufferAttribute(position as THREE.BufferAttribute).applyMatrix4(world);
    const center = box.getCenter(new THREE.Vector3()).toArray() as Vec3;
    const total = indices ? indices.length : position.count;
    const ranges = geometry.groups.length
      ? geometry.groups.map((group) => ({ start: group.start, count: Math.min(group.count, total - group.start), materialIndex: group.materialIndex ?? 0 }))
      : [{ start: 0, count: total, materialIndex: 0 }];

    const out: CustomMesh = { positions, normals, uvs, colors, indices, hasNormals: !!normalAttribute, parts: [] };
    meshes.push(out);
    for (const range of ranges) {
      const material = materials[range.materialIndex] ?? materials[0];
      if (!material || !material.visible || range.count <= 0) continue;
      const base = materialOf(material);
      tasks.push(
        (async () => {
          const [map, alphaMap] = await Promise.all([convertTexture(base.mapTexture), convertTexture(base.alphaTexture)]);
          const { mapTexture: _m, alphaTexture: _a, ...rest } = base;
          out.parts.push({ start: range.start, count: range.count, center: [...center] as Vec3, material: { ...rest, map, alphaMap } });
        })(),
      );
    }
  });

  await Promise.all(tasks);

  // Centre on the grid with the base at y = 0, as the other panes do, so the
  // result doesn't depend on whether three.js has positioned its copy yet.
  if (Number.isFinite(min[0])) {
    const shift: Vec3 = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        mesh.positions[i] += shift[0];
        mesh.positions[i + 1] += shift[1];
        mesh.positions[i + 2] += shift[2];
      }
      for (const part of mesh.parts) part.center = [part.center[0] + shift[0], part.center[1] + shift[1], part.center[2] + shift[2]];
    }
    for (let c = 0; c < 3; c++) {
      min[c] += shift[c]!;
      max[c] += shift[c]!;
    }
  }
  const textures = (await Promise.all(textureCache.values())).filter((t): t is CustomTexture => !!t);
  const scene = { meshes: meshes.filter((m) => m.parts.length), textures, min, max };
  if (signal.cancelled) disposeCustomScene(scene);
  return scene;
}
