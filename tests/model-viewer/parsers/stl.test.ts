import { describe, expect, it } from "vitest";
import { isBinaryStl, parseStl } from "../../../src/modelviewer/custom/parsers/stl";
import { srgbToLinear } from "../../../src/modelviewer/custom/parsers/types";
import { size, text, triangleCount } from "./helpers";

function binaryStl(faces: { n: number[]; v: number[][]; attr?: number }[], header = ""): Uint8Array {
  const out = new Uint8Array(84 + faces.length * 50);
  out.set(new TextEncoder().encode(header).subarray(0, 80));
  const dv = new DataView(out.buffer);
  dv.setUint32(80, faces.length, true);
  faces.forEach((f, i) => {
    const o = 84 + i * 50;
    [...f.n, ...f.v.flat()].forEach((x, k) => dv.setFloat32(o + k * 4, x, true));
    dv.setUint16(o + 48, f.attr ?? 0, true);
  });
  return out;
}

const tri = { n: [0, 0, 1], v: [[0, 0, 0], [2, 0, 0], [0, 3, 0]] };

describe("STL", () => {
  it("parses ASCII facets", () => {
    const raw = parseStl(text(`solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
facet normal 0 0 1
 outer loop
  vertex 1 0 0
  vertex 1 1 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`));
    expect(triangleCount(raw)).toBe(2);
    expect(size(raw)).toEqual([1, 1, 0]);
    expect(raw.primitives[0]!.normals![2]).toBe(1);
  });

  it("detects binary even when the header starts with 'solid'", () => {
    const data = binaryStl([tri], "solid but binary");
    expect(isBinaryStl(data)).toBe(true);
    const raw = parseStl(data);
    expect(triangleCount(raw)).toBe(1);
    expect(size(raw)).toEqual([2, 3, 0]);
  });

  it("uses the neutral colour without header colour", () => {
    const raw = parseStl(binaryStl([tri]));
    expect(raw.materials[0]!.vertexColors).toBe(false);
    expect(raw.primitives[0]!.colors).toBeNull();
  });

  it("reads COLOR= header with alpha and per-face colours", () => {
    const header = new Uint8Array(80);
    header.set(new TextEncoder().encode("COLOR="), 10);
    header.set([255, 0, 0, 128], 16);
    const data = binaryStl([tri, { ...tri, attr: 0x1f /* red 31, valid (bit 15 = 0) */ }, { ...tri, attr: 0x8000 }]);
    data.set(header, 0);
    const raw = parseStl(data);
    const m = raw.materials[0]!;
    expect(m.opacity).toBeCloseTo(128 / 255);
    expect(m.transparent).toBe(true);
    expect(m.vertexColors).toBe(true);
    const c = raw.primitives[0]!.colors!;
    // Face 0 attr 0 → valid colour (0,0,0) per VisCAM; face 1 → red; face 2 bit15 set → header default (red).
    expect(Array.from(c.slice(9, 12))).toEqual([1, 0, 0]);
    expect(c[18]).toBeCloseTo(srgbToLinear(1));
  });

  it("drops all-zero normals so they get computed", () => {
    const raw = parseStl(binaryStl([{ n: [0, 0, 0], v: tri.v }]));
    expect(raw.primitives[0]!.normals).toBeNull();
  });
});
