import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasOpenEdges } from "../../src/modelviewer/openEdges";
import { parseFiles } from "../../src/modelviewer/custom/parsers/parse";

// Unit tetrahedron (closed) and the same with one face removed (open).
const P = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const TET = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];

describe("hasOpenEdges", () => {
  it("is false for a closed mesh and true once a face is removed", () => {
    expect(hasOpenEdges(P, TET)).toBe(false);
    expect(hasOpenEdges(P, TET.slice(3))).toBe(true);
  });

  it("welds split vertices, so UV/normal seams aren't openings", () => {
    // Non-indexed copy of the closed tetrahedron: every corner is its own vertex.
    const flat = TET.flatMap((i) => P.slice(i * 3, i * 3 + 3));
    expect(hasOpenEdges(flat, null)).toBe(false);
  });

  it("checks only the given index range", () => {
    expect(hasOpenEdges(P, [...TET, 0, 1, 2], 0, 12)).toBe(false);
  });
});

describe("open meshes without sidedness info", () => {
  const file = (name: string) => {
    const b = readFileSync(`public/projects/model-viewer/samples/${name}`);
    return { name, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  };

  it("draws the teapot (open spout) double-sided", async () => {
    const { scene } = await parseFiles([file("teapot.obj"), file("teapot.mtl")]);
    expect(scene.materials.every((m) => m.side === "double")).toBe(true);
  });

  it("leaves a closed OBJ single-sided", async () => {
    const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n";
    const data = new TextEncoder().encode(obj).buffer as ArrayBuffer;
    const { scene } = await parseFiles([{ name: "tet.obj", data }]);
    expect(scene.materials[0]!.side).toBe("front");
  });
});
