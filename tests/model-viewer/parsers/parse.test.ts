import { describe, expect, it } from "vitest";
import { parseFiles } from "../../../src/modelviewer/custom/parsers/parse";

const file = (name: string, s: string | Uint8Array) => ({ name, data: (typeof s === "string" ? new TextEncoder().encode(s) : s).slice().buffer as ArrayBuffer });

describe("parseFiles", () => {
  it("picks the model and resolves sidecars case-insensitively", async () => {
    const { scene, main } = await parseFiles([
      file("Leaf.MTL", "newmtl A\nKd 1 0 0\nmap_Kd Leaf.png\n"),
      file("leaf.png", new Uint8Array([1])),
      file("tree.obj", "mtllib leaf.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl A\nf 1 2 3\n"),
    ]);
    expect(main).toBe("tree.obj");
    expect(scene.missing).toEqual([]);
    expect(scene.materials[0]!.map).toBe(0);
  });
  it("falls back to the only supplied MTL when mtllib names another", async () => {
    const { scene } = await parseFiles([file("a.obj", "mtllib other.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl A\nf 1 2 3\n"), file("x.mtl", "newmtl A\nKd 0 1 0\n")]);
    expect(scene.materials[0]!.color).toEqual([0, 1, 0]);
  });
  it("rejects unsupported file sets", async () => {
    await expect(parseFiles([file("x.txt", "hi")])).rejects.toThrow(/supported/);
  });
});
