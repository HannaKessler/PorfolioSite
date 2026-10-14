import { describe, expect, it } from "vitest";
import { parseGltf } from "../../../src/modelviewer/custom/parsers/gltf";
import { UnsupportedError } from "../../../src/modelviewer/custom/parsers/types";
import { lookupFrom, noFiles, size, text, triangleCount, worldBounds } from "./helpers";

// One triangle: positions (float), indices (ushort), uv.
function triangleBuffer(): Uint8Array {
  const buf = new ArrayBuffer(36 + 8 + 24);
  const f = new Float32Array(buf, 0, 9);
  f.set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Uint16Array(buf, 36, 3).set([0, 1, 2]);
  new Float32Array(buf, 44, 6).set([0, 0, 1, 0, 0, 1]);
  return new Uint8Array(buf);
}
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function baseJson(uri: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 68, ...(uri !== undefined ? { uri } : {}) }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC2" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 1, 0.4] }, alphaMode: "BLEND", doubleSided: true }],
    nodes: [{ mesh: 0, translation: [10, 0, 0], scale: [2, 2, 2] }],
    scenes: [{ nodes: [0] }],
    ...extra,
  };
}

describe("glTF", () => {
  it("reads a data-URI buffer, indices, node TRS and PBR material", () => {
    const raw = parseGltf(text(JSON.stringify(baseJson(`data:application/octet-stream;base64,${b64(triangleBuffer())}`))), noFiles);
    expect(triangleCount(raw)).toBe(1);
    expect(worldBounds(raw)).toEqual({ min: [10, 0, 0], max: [12, 2, 0] });
    const m = raw.materials[0]!;
    expect(m.color).toEqual([0.5, 0.25, 1]);
    expect(m.opacity).toBe(0.4);
    expect(m.transparent).toBe(true);
    expect(m.side).toBe("double");
    expect(Array.from(raw.primitives[0]!.uvs!)).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("resolves an external .bin and reports a missing texture", () => {
    const json = baseJson("tri.bin", {
      images: [{ uri: "tex%20ture.png" }],
      textures: [{ source: 0, sampler: 0 }],
      samplers: [{ wrapS: 33071, wrapT: 10497 }],
    });
    (json.materials[0] as Record<string, unknown>).pbrMetallicRoughness = { baseColorTexture: { index: 0 } };
    const raw = parseGltf(text(JSON.stringify(json)), lookupFrom({ "tri.bin": triangleBuffer() }));
    expect(triangleCount(raw)).toBe(1);
    expect(raw.missing).toEqual(["tex ture.png"]);
    expect(raw.textures[0]).toMatchObject({ wrapS: "clamp", wrapT: "repeat", flipY: false });
  });

  it("reads GLB with a BIN chunk", () => {
    const json = text(JSON.stringify(baseJson(undefined)));
    const pad = (n: number) => (4 - (n % 4)) % 4;
    const jsonLen = json.length + pad(json.length);
    const bin = triangleBuffer();
    const total = 12 + 8 + jsonLen + 8 + bin.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    out.set(text("glTF"));
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20);
    out.fill(0x20, 20 + json.length, 20 + jsonLen);
    dv.setUint32(20 + jsonLen, bin.length, true);
    dv.setUint32(24 + jsonLen, 0x004e4942, true);
    out.set(bin, 28 + jsonLen);
    const raw = parseGltf(out, noFiles);
    expect(triangleCount(raw)).toBe(1);
  });

  it("applies sparse accessors over a zero-initialised base", () => {
    const buf = new ArrayBuffer(4 + 12);
    new Uint16Array(buf, 0, 1).set([2]);
    new Float32Array(buf, 4, 3).set([0, 5, 0]);
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 16, uri: `data:application/octet-stream;base64,${b64(new Uint8Array(buf))}` }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 2 }, { buffer: 0, byteOffset: 4, byteLength: 12 }],
      accessors: [{ componentType: 5126, count: 3, type: "VEC3", sparse: { count: 1, indices: { bufferView: 0, componentType: 5123 }, values: { bufferView: 1 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
    };
    const raw = parseGltf(text(JSON.stringify(json)), noFiles);
    expect(Array.from(raw.primitives[0]!.positions)).toEqual([0, 0, 0, 0, 0, 0, 0, 5, 0]);
  });

  it("composes the node hierarchy and normalized, strided attributes", () => {
    // Interleaved: position (3 x float) + normalized ubyte colour (4) per vertex, stride 16.
    const buf = new ArrayBuffer(48);
    const dv = new DataView(buf);
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]].forEach((p, i) => {
      p.forEach((x, k) => dv.setFloat32(i * 16 + k * 4, x, true));
      dv.setUint8(i * 16 + 12, 255);
      dv.setUint8(i * 16 + 13, 0);
      dv.setUint8(i * 16 + 14, 0);
      dv.setUint8(i * 16 + 15, 255);
    });
    const json = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 48, uri: `data:application/octet-stream;base64,${b64(new Uint8Array(buf))}` }],
      bufferViews: [{ buffer: 0, byteLength: 48, byteStride: 16 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 0, byteOffset: 12, componentType: 5121, normalized: true, count: 3, type: "VEC4" },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }],
      nodes: [{ children: [1], translation: [0, 5, 0] }, { mesh: 0, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
      scenes: [{ nodes: [0] }],
    };
    const raw = parseGltf(text(JSON.stringify(json)), noFiles);
    const b = worldBounds(raw);
    expect(b.min).toEqual([-1, 5, 0]);
    expect(b.max).toEqual([0, 6, 0]);
    expect(Array.from(raw.primitives[0]!.colors!.slice(0, 3))).toEqual([1, 0, 0]);
    expect(raw.materials[raw.primitives[0]!.material]!.vertexColors).toBe(true);
    expect(size(raw)).toEqual([1, 1, 0]);
  });

  it("converts triangle strips and fans", () => {
    const json = baseJson(`data:application/octet-stream;base64,${b64(triangleBuffer())}`);
    (json.meshes[0]!.primitives[0] as Record<string, unknown>).mode = 5;
    expect(triangleCount(parseGltf(text(JSON.stringify(json)), noFiles))).toBe(1);
  });

  it("treats MASK as alpha test and states Draco is unsupported", () => {
    const json = baseJson(`data:application/octet-stream;base64,${b64(triangleBuffer())}`);
    json.materials[0] = { alphaMode: "MASK", alphaCutoff: 0.3 } as never;
    const m = parseGltf(text(JSON.stringify(json)), noFiles).materials[0]!;
    expect(m.alphaCutoff).toBe(0.3);
    expect(m.transparent).toBe(false);

    const draco = { ...baseJson(undefined), extensionsRequired: ["KHR_draco_mesh_compression"] };
    expect(() => parseGltf(text(JSON.stringify(draco)), noFiles)).toThrow(UnsupportedError);
    expect(() => parseGltf(text(JSON.stringify(draco)), noFiles)).toThrow(/Draco/);
  });
});
