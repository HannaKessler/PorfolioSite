import { describe, expect, it } from "vitest";
import { parsePly } from "../../../src/modelviewer/custom/parsers/ply";
import { size, text, triangleCount } from "./helpers";

const HEADER = (format: string, extra = "") => `ply
format ${format} 1.0
comment test
element vertex 4
property float x
property float y
property float z
${extra}element face 1
property list uchar int vertex_indices
end_header
`;

function binaryPly(little: boolean): Uint8Array {
  const head = new TextEncoder().encode(HEADER(little ? "binary_little_endian" : "binary_big_endian", "property uchar red\nproperty uchar green\nproperty uchar blue\n"));
  const body = new DataView(new ArrayBuffer(4 * 15 + 1 + 16));
  let o = 0;
  const verts = [[0, 0, 0], [1, 0, 0], [1, 2, 0], [0, 2, 0]];
  for (const v of verts) {
    for (const x of v) {
      body.setFloat32(o, x, little);
      o += 4;
    }
    body.setUint8(o++, 255);
    body.setUint8(o++, 0);
    body.setUint8(o++, 0);
  }
  body.setUint8(o++, 4);
  for (const i of [0, 1, 2, 3]) {
    body.setInt32(o, i, little);
    o += 4;
  }
  const out = new Uint8Array(head.length + o);
  out.set(head);
  out.set(new Uint8Array(body.buffer, 0, o), head.length);
  return out;
}

describe("PLY", () => {
  it("parses ASCII with a quad face", () => {
    const raw = parsePly(text(HEADER("ascii") + "0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n"));
    expect(triangleCount(raw)).toBe(2);
    expect(Array.from(raw.primitives[0]!.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(raw.primitives[0]!.normals).toBeNull();
    expect(raw.primitives[0]!.creaseAngle).toBe(Math.PI);
  });

  it.each([true, false])("parses binary (little endian: %s) with vertex colours", (little) => {
    const raw = parsePly(binaryPly(little));
    expect(triangleCount(raw)).toBe(2);
    expect(size(raw)).toEqual([1, 2, 0]);
    expect(Array.from(raw.primitives[0]!.colors!.slice(0, 3))).toEqual([1, 0, 0]);
    expect(raw.materials[0]!.vertexColors).toBe(true);
  });

  it("reads normals and texture coordinates", () => {
    const head = `ply
format ascii 1.0
element vertex 3
property float x
property float y
property float z
property float nx
property float ny
property float nz
property float s
property float t
element face 1
property list uchar uint vertex_indices
end_header
`;
    const raw = parsePly(text(head + "0 0 0 0 0 1 0 0\n1 0 0 0 0 1 1 0\n0 1 0 0 0 1 0 1\n3 0 1 2\n"));
    expect(Array.from(raw.primitives[0]!.normals!.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(raw.primitives[0]!.uvs!)).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it("rejects files without a header", () => {
    expect(() => parsePly(text("nope"))).toThrow(/PLY/);
  });
});
