import { describe, expect, it } from "vitest";
import { buildScene } from "../../../src/modelviewer/custom/parsers/build";
import { euler, mul, scale, translate, applyPoint, normalMatrix, quat } from "../../../src/modelviewer/custom/parsers/mat";
import { creasedNormals, deindex, vertexNormals } from "../../../src/modelviewer/custom/parsers/normals";
import { defaultMaterial, type RawScene } from "../../../src/modelviewer/custom/parsers/types";

const near = (a: ArrayLike<number>, b: number[]) => b.forEach((v, i) => expect(a[i]!).toBeCloseTo(v, 5));

describe("mat", () => {
  it("euler applies axes in the named order", () => {
    // XYZ: rotate about X first, then Z. (0,1,0) → X 90° → (0,0,1) → Z 90° → (0,0,1).
    near(applyPoint(euler([90, 0, 90], "XYZ"), 0, 1, 0), [0, 0, 1]);
    // ZYX: Z first: (0,1,0) → (-1,0,0) → X 90° → (-1,0,0).
    near(applyPoint(euler([90, 0, 90], "ZYX"), 0, 1, 0), [-1, 0, 0]);
  });
  it("quat matches a 90° Z rotation", () => {
    near(applyPoint(quat(0, 0, Math.SQRT1_2, Math.SQRT1_2), 1, 0, 0), [0, 1, 0]);
  });
  it("normal matrix is the inverse transpose", () => {
    const nm = normalMatrix(scale(2, 1, 1));
    expect(nm[0]).toBeCloseTo(0.5);
    const m = mul(translate(1, 2, 3), scale(1, 1, 1));
    near(applyPoint(m, 0, 0, 0), [1, 2, 3]);
  });
});

describe("normals", () => {
  // Two triangles meeting at a 90° fold along the X axis.
  const fold = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
  it("flat when crease is 0", () => {
    const n = creasedNormals(fold, 0);
    near(n.slice(0, 3), [0, -1, 0]);
    near(n.slice(9, 12), [0, 0, -1]);
  });
  it("smooths across the fold under a wide crease angle", () => {
    const n = creasedNormals(fold, Math.PI);
    near(n.slice(0, 3), [0, -Math.SQRT1_2, -Math.SQRT1_2]);
  });
  it("keeps the fold sharp under a 60° crease angle", () => {
    near(creasedNormals(fold, Math.PI / 3).slice(0, 3), [0, -1, 0]);
  });
  it("vertexNormals averages indexed faces; deindex expands", () => {
    const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    near(vertexNormals(p, new Uint32Array([0, 1, 2])).slice(0, 3), [0, 0, 1]);
    expect(Array.from(deindex(new Uint32Array([2, 0]), p, 3))).toEqual([0, 1, 0, 0, 0, 0]);
  });
});

describe("buildScene", () => {
  const raw = (matrix: Float64Array): RawScene => ({
    primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: null, uvs: new Float32Array([0, 0, 1, 0, 0, 1]), colors: null, indices: null, material: 0, creaseAngle: 0, matrix, clampUnitUVs: true }],
    materials: [{ ...defaultMaterial(), map: 0 }],
    textures: [{ image: 0, wrapS: "repeat", wrapT: "repeat", flipY: true }],
    images: [{ data: new Uint8Array([1]), mimeType: "image/png", name: "a.png" }],
    missing: [],
  });
  it("bakes transforms, centres on the ground and computes normals", () => {
    const built = buildScene(raw(translate(5, 5, 5)));
    expect(built.min).toEqual([-0.5, 0, 0]);
    expect(built.max).toEqual([0.5, 1, 0]);
    near(built.meshes[0]!.normals.slice(0, 3), [0, 0, 1]);
    expect(built.stats).toEqual({ vertices: 3, triangles: 1 });
  });
  it("clamps repeat textures when UVs stay in the unit square", () => {
    expect(buildScene(raw(translate(0, 0, 0))).meshes[0]!.parts[0]!.material.map).toEqual({ image: 0, repeat: false, flipY: true });
  });
  it("keeps front faces under a mirroring transform", () => {
    const built = buildScene(raw(scale(-1, 1, 1)));
    near(built.meshes[0]!.normals.slice(0, 3), [0, 0, 1]);
  });
  it("defaults vertex colours to white", () => {
    expect(Array.from(buildScene(raw(translate(0, 0, 0))).meshes[0]!.colors)).toEqual(new Array(9).fill(1));
  });
});
