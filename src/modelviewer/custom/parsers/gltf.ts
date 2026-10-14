// glTF 2.0: .gltf (JSON with data: URIs or sidecar .bin/images) and .glb.
import { ident, mul, mulAll, quat, scale, translate, type M4 } from "./mat";
import { defaultMaterial, mimeFromName, UnsupportedError, type RawImage, type RawMaterial, type RawPrimitive, type RawScene, type RawTexture, type Wrap } from "./types";
import type { FileLookup } from "./obj";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const UNSUPPORTED_EXTENSIONS: Record<string, string> = {
  KHR_draco_mesh_compression: "Draco-compressed meshes",
  EXT_meshopt_compression: "Meshopt-compressed buffers",
  KHR_texture_basisu: "KTX2/Basis textures",
  KHR_mesh_quantization: "quantized vertex attributes",
};

export function isGlb(data: Uint8Array): boolean {
  return data.length >= 12 && data[0] === 0x67 && data[1] === 0x6c && data[2] === 0x54 && data[3] === 0x46; // "glTF"
}

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (meta.endsWith(";base64")) {
    const bin = atob(payload);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

export function parseGltf(data: Uint8Array, lookup: FileLookup): RawScene {
  let json: Json;
  let glbBin: Uint8Array | null = null;
  if (isGlb(data)) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (view.getUint32(4, true) !== 2) throw new UnsupportedError(`glTF version ${view.getUint32(4, true)} isn't supported; only 2.0.`);
    let o = 12;
    while (o + 8 <= data.length) {
      const length = view.getUint32(o, true);
      const type = view.getUint32(o + 4, true);
      const chunk = data.subarray(o + 8, o + 8 + length);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
      else if (type === 0x004e4942) glbBin = chunk;
      o += 8 + length;
    }
    if (!json) throw new Error("GLB file has no JSON chunk.");
  } else {
    json = JSON.parse(new TextDecoder().decode(data));
  }
  if (!String(json.asset?.version ?? "2").startsWith("2")) throw new UnsupportedError(`glTF ${json.asset.version} isn't supported; only 2.0.`);
  const blocked = (json.extensionsRequired ?? []).filter((e: string) => UNSUPPORTED_EXTENSIONS[e] || e.startsWith("KHR_draco") || e.startsWith("EXT_meshopt"));
  if (blocked.length) throw new UnsupportedError(`This glTF uses ${blocked.map((e: string) => UNSUPPORTED_EXTENSIONS[e] ?? e).join(", ")}, which the hand-written parser doesn't decode.`);

  const missing: string[] = [];
  const buffers: (Uint8Array | null)[] = (json.buffers ?? []).map((b: Json, i: number) => {
    if (b.uri === undefined) return i === 0 ? glbBin : null;
    if (b.uri.startsWith("data:")) return decodeDataUri(b.uri);
    const file = lookup(decodeURIComponent(b.uri));
    if (!file) missing.push(decodeURIComponent(b.uri));
    return file;
  });

  const bufferView = (index: number): { bytes: Uint8Array; stride: number } => {
    const bv = json.bufferViews[index];
    const buffer = buffers[bv.buffer];
    if (!buffer) throw new Error(`glTF buffer ${bv.buffer} is missing.`);
    return { bytes: buffer.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride ?? 0 };
  };

  const readComponent = (view: DataView, offset: number, type: number, normalized: boolean): number => {
    switch (type) {
      case 5120: { const v = view.getInt8(offset); return normalized ? Math.max(v / 127, -1) : v; }
      case 5121: { const v = view.getUint8(offset); return normalized ? v / 255 : v; }
      case 5122: { const v = view.getInt16(offset, true); return normalized ? Math.max(v / 32767, -1) : v; }
      case 5123: { const v = view.getUint16(offset, true); return normalized ? v / 65535 : v; }
      case 5125: return view.getUint32(offset, true);
      case 5126: return view.getFloat32(offset, true);
    }
    throw new Error(`Unknown glTF component type ${type}.`);
  };

  const accessorCache = new Map<number, Float64Array>();
  const accessor = (index: number): { values: Float64Array; size: number } => {
    const a = json.accessors[index];
    const size = COMPONENTS[a.type]!;
    let values = accessorCache.get(index);
    if (!values) {
      values = new Float64Array(a.count * size);
      const normalized = !!a.normalized;
      if (a.bufferView !== undefined) {
        const { bytes, stride } = bufferView(a.bufferView);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const elementBytes = BYTES[a.componentType]! * size;
        const step = stride || elementBytes;
        const base = a.byteOffset ?? 0;
        for (let i = 0; i < a.count; i++)
          for (let c = 0; c < size; c++) values[i * size + c] = readComponent(view, base + i * step + c * BYTES[a.componentType]!, a.componentType, normalized);
      }
      if (a.sparse) {
        const s = a.sparse;
        const idx = bufferView(s.indices.bufferView);
        const idxView = new DataView(idx.bytes.buffer, idx.bytes.byteOffset, idx.bytes.byteLength);
        const val = bufferView(s.values.bufferView);
        const valView = new DataView(val.bytes.buffer, val.bytes.byteOffset, val.bytes.byteLength);
        const vb = BYTES[a.componentType]!;
        for (let i = 0; i < s.count; i++) {
          const target = readComponent(idxView, (s.indices.byteOffset ?? 0) + i * BYTES[s.indices.componentType]!, s.indices.componentType, false);
          for (let c = 0; c < size; c++) values[target * size + c] = readComponent(valView, (s.values.byteOffset ?? 0) + (i * size + c) * vb, a.componentType, normalized);
        }
      }
      accessorCache.set(index, values);
    }
    return { values, size };
  };

  // Images and textures.
  const images: RawImage[] = (json.images ?? []).map((img: Json, i: number): RawImage => {
    if (img.bufferView !== undefined) return { data: bufferView(img.bufferView).bytes, mimeType: img.mimeType ?? "image/png", name: img.name ?? `image ${i}` };
    if (img.uri?.startsWith("data:")) return { data: decodeDataUri(img.uri), mimeType: img.uri.slice(5, img.uri.search(/[;,]/)), name: img.name ?? `image ${i}` };
    const name = decodeURIComponent(img.uri ?? "");
    const file = lookup(name);
    if (!file) missing.push(name);
    return { data: file, mimeType: img.mimeType ?? mimeFromName(name), name };
  });
  const wrap = (mode: number | undefined): Wrap => (mode === 33071 ? "clamp" : "repeat"); // 10497 repeat, 33648 mirrored (drawn as repeat)
  const textures: RawTexture[] = [];
  const textureIndex = new Map<number, number>();
  const texture = (info: Json | undefined): number | null => {
    if (!info) return null;
    if (info.texCoord) return null; // only TEXCOORD_0 is read
    let index = textureIndex.get(info.index);
    if (index === undefined) {
      const t = json.textures[info.index];
      const source = t.source ?? t.extensions?.EXT_texture_webp?.source;
      if (source === undefined) return null;
      const sampler = t.sampler !== undefined ? json.samplers[t.sampler] : {};
      textures.push({ image: source, wrapS: wrap(sampler.wrapS), wrapT: wrap(sampler.wrapT), flipY: false });
      index = textures.length - 1;
      textureIndex.set(info.index, index);
    }
    return index;
  };

  const materials: RawMaterial[] = (json.materials ?? []).map((m: Json, i: number): RawMaterial => {
    const pbr = m.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const mode = m.alphaMode ?? "OPAQUE";
    return {
      ...defaultMaterial(m.name ?? `material ${i}`),
      color: [factor[0], factor[1], factor[2]], // already linear
      opacity: mode === "OPAQUE" ? 1 : factor[3],
      transparent: mode === "BLEND",
      alphaCutoff: mode === "MASK" ? (m.alphaCutoff ?? 0.5) : 0,
      side: m.doubleSided ? "double" : "front",
      map: texture(pbr.baseColorTexture),
    };
  });
  let fallbackMaterial = -1;
  const defaultIndex = () => {
    if (fallbackMaterial < 0) {
      materials.push({ ...defaultMaterial("default"), color: [1, 1, 1] });
      fallbackMaterial = materials.length - 1;
    }
    return fallbackMaterial;
  };

  const toF32 = (v: Float64Array) => Float32Array.from(v);
  const primitives: RawPrimitive[] = [];
  const meshPrimitives = (meshIndex: number, matrix: M4) => {
    for (const p of json.meshes[meshIndex].primitives) {
      if (p.extensions?.KHR_draco_mesh_compression) throw new UnsupportedError("This glTF uses Draco-compressed meshes, which the hand-written parser doesn't decode.");
      const mode = p.mode ?? 4;
      if (mode < 4 || p.attributes.POSITION === undefined) continue; // points and lines aren't drawn
      const pos = accessor(p.attributes.POSITION);
      const count = pos.values.length / 3;
      let indices: Uint32Array;
      if (p.indices !== undefined) indices = Uint32Array.from(accessor(p.indices).values);
      else indices = Uint32Array.from({ length: count }, (_, i) => i);
      if (mode === 5 || mode === 6) {
        const tri: number[] = [];
        for (let i = 2; i < indices.length; i++) {
          if (mode === 6) tri.push(indices[0]!, indices[i - 1]!, indices[i]!);
          else if (i % 2 === 0) tri.push(indices[i - 2]!, indices[i - 1]!, indices[i]!);
          else tri.push(indices[i - 1]!, indices[i - 2]!, indices[i]!);
        }
        indices = new Uint32Array(tri);
      }
      let colors: Float32Array | null = null;
      if (p.attributes.COLOR_0 !== undefined) {
        const c = accessor(p.attributes.COLOR_0);
        colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) colors[i * 3 + k] = c.values[i * c.size + k]!;
      }
      const materialIndex = p.material ?? defaultIndex();
      if (colors && p.material !== undefined) {
        // A material can be shared by primitives with and without colours.
        const m = { ...materials[materialIndex]!, vertexColors: true };
        materials.push(m);
      }
      primitives.push({
        positions: toF32(pos.values),
        normals: p.attributes.NORMAL !== undefined ? toF32(accessor(p.attributes.NORMAL).values) : null,
        uvs: p.attributes.TEXCOORD_0 !== undefined ? toF32(accessor(p.attributes.TEXCOORD_0).values) : null,
        colors,
        indices,
        material: colors ? (p.material !== undefined ? materials.length - 1 : (materials[materialIndex]!.vertexColors = true, materialIndex)) : materialIndex,
        creaseAngle: 0, // glTF: flat normals when absent
        matrix,
        clampUnitUVs: false,
      });
    }
  };

  const nodeMatrix = (node: Json): M4 => {
    if (node.matrix) return Float64Array.from(node.matrix);
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    return mulAll(translate(t[0], t[1], t[2]), quat(r[0], r[1], r[2], r[3]), scale(s[0], s[1], s[2]));
  };
  const visit = (index: number, parent: M4, depth: number) => {
    if (depth > 256) throw new Error("glTF node hierarchy is cyclic.");
    const node = json.nodes[index];
    const world = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) meshPrimitives(node.mesh, world);
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  const sceneIndex = json.scene ?? 0;
  if (json.scenes?.[sceneIndex]) for (const root of json.scenes[sceneIndex].nodes ?? []) visit(root, ident(), 0);
  else if (json.meshes) json.meshes.forEach((_: Json, i: number) => meshPrimitives(i, ident()));

  return { primitives, materials, textures, images, missing: [...new Set(missing)] };
}
