import { describe, expect, it } from "vitest";
import { parseMtl, parseObj } from "../../../src/modelviewer/custom/parsers/obj";
import { srgbToLinear } from "../../../src/modelviewer/custom/parsers/types";
import { lookupFrom, noFiles, size, triangleCount } from "./helpers";

const QUAD = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1 4/4/1
`;

describe("OBJ", () => {
  it("fan-triangulates n-gons and keeps uv/normal per corner", () => {
    const raw = parseObj(QUAD, noFiles);
    expect(triangleCount(raw)).toBe(2);
    const p = raw.primitives[0]!;
    expect(Array.from(p.normals!.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(p.uvs!.slice(0, 6))).toEqual([0, 0, 1, 0, 1, 1]);
    expect(size(raw)).toEqual([1, 1, 0]);
  });

  it("resolves negative (relative) indices", () => {
    const raw = parseObj("v 0 0 0\nv 2 0 0\nv 0 3 0\nf -3 -2 -1\n", noFiles);
    expect(Array.from(raw.primitives[0]!.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 0]);
  });

  it("supports v//vn and v/vt forms and pentagons", () => {
    const raw = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv .5 2 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1 4//1 5//1\n", noFiles);
    expect(triangleCount(raw)).toBe(3);
    expect(raw.primitives[0]!.uvs).toBeNull();
  });

  it("maps smoothing groups to crease angles when normals are missing", () => {
    const raw = parseObj("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\ns 1\nf 1 2 3\ns off\nf 1 3 4\n", noFiles);
    const angles = raw.primitives.map((p) => p.creaseAngle).sort();
    expect(angles).toEqual([0, Math.PI / 3]);
    expect(raw.primitives.every((p) => p.normals === null)).toBe(true);
  });

  it("splits by usemtl and reads MTL colour, opacity and maps", () => {
    const mtl = `newmtl Leaf
Kd 0.5 0.25 1
d 0.5
map_Kd -s 1 1 1 textures/leaf.png
map_d leaf_alpha.png
newmtl Bark
Kd 1 1 1
Tr 0.25
`;
    const obj = "mtllib scene.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nusemtl Leaf\nf 1/1 2/2 3/3\nusemtl Bark\nf 3/3 2/2 1/1\n";
    const raw = parseObj(obj, lookupFrom({ "scene.mtl": new TextEncoder().encode(mtl), "leaf.png": new Uint8Array([1]) }));
    expect(raw.primitives).toHaveLength(2);
    const leaf = raw.materials.find((m) => m.name === "Leaf")!;
    const bark = raw.materials.find((m) => m.name === "Bark")!;
    expect(leaf.color[0]).toBeCloseTo(srgbToLinear(0.5));
    expect(leaf.opacity).toBe(0.5);
    expect(leaf.transparent).toBe(true);
    expect(raw.images[raw.textures[leaf.map!]!.image]!.name).toBe("textures/leaf.png");
    expect(leaf.alphaMap).not.toBeNull();
    expect(bark.opacity).toBe(0.75);
    expect(raw.missing).toEqual(["leaf_alpha.png"]);
    expect(raw.textures[leaf.map!]!.flipY).toBe(true);
  });

  it("reports a missing MTL and falls back to white", () => {
    const raw = parseObj("mtllib gone.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", noFiles);
    expect(raw.missing).toEqual(["gone.mtl"]);
    expect(raw.materials[0]!.color).toEqual([1, 1, 1]);
  });

  it("reads per-vertex colours from v x y z r g b", () => {
    const raw = parseObj("v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nf 1 2 3\n", noFiles);
    expect(Array.from(raw.primitives[0]!.colors!.slice(0, 3))).toEqual([1, 0, 0]);
    expect(raw.materials[0]!.vertexColors).toBe(true);
  });

  it("parseMtl ignores comments and handles d -halo", () => {
    const m = parseMtl("# c\nnewmtl A\nd -halo 0.3\n").get("A")!;
    expect(m.material.opacity).toBe(0.3);
  });
});
