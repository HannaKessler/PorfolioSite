import { describe, expect, it } from "vitest";
import {
  baseName,
  buildFileMap,
  extensionOf,
  pickMainFile,
  objNeedsSmoothNormals,
  pickMaterialFile,
  resolveReference,
} from "../../src/modelviewer/files";

const f = (name: string) => ({ name });

describe("baseName / extensionOf", () => {
  it("strips folders, queries and URL escapes", () => {
    expect(baseName("blob:http://localhost:4321/textures/My%20Wood.PNG?x=1#y")).toBe("My Wood.PNG");
    expect(baseName("..\\maps\\diffuse.jpg")).toBe("diffuse.jpg");
    expect(extensionOf("Scene.GLTF")).toBe("gltf");
    expect(extensionOf(".hidden")).toBe("");
  });
});

describe("resolveReference", () => {
  it("matches references to supplied files case-insensitively by name", () => {
    const map = buildFileMap([f("scene.bin"), f("Wood Diffuse.png")]);
    expect(resolveReference("blob:http://x/textures/wood%20diffuse.PNG", map)?.name).toBe("Wood Diffuse.png");
    expect(resolveReference("Scene.bin", map)?.name).toBe("scene.bin");
    expect(resolveReference("missing.jpg", map)).toBeUndefined();
  });
});

describe("pickMainFile", () => {
  it("prefers glTF over other formats and ignores sidecars", () => {
    const result = pickMainFile([f("a.png"), f("model.obj"), f("model.mtl"), f("scene.gltf"), f("scene.bin")]);
    expect(result.ok && result.main.name).toBe("scene.gltf");
  });
  it("picks an OBJ when it is the only model", () => {
    const result = pickMainFile([f("tex.jpg"), f("Chair.OBJ"), f("chair.mtl")]);
    expect(result.ok && result.format).toBe("obj");
  });
  it("reports unsupported files clearly", () => {
    const result = pickMainFile([f("model.usdz"), f("notes.txt")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("model.usdz");
  });
  it("reports an empty drop", () => {
    expect(pickMainFile([]).ok).toBe(false);
  });
});

describe("pickMaterialFile", () => {
  const mtls = [f("other.mtl"), f("chair.mtl"), f("Materials.MTL")];
  it("uses the mtllib line first", () => {
    expect(pickMaterialFile("chair.obj", "# x\nmtllib materials.mtl\nv 0 0 0", mtls)?.name).toBe("Materials.MTL");
  });
  it("falls back to a matching base name", () => {
    expect(pickMaterialFile("Chair.obj", "v 0 0 0", mtls)?.name).toBe("chair.mtl");
  });
  it("returns nothing when no material file is present", () => {
    expect(pickMaterialFile("chair.obj", "mtllib chair.mtl", [f("chair.png")])).toBeUndefined();
  });
});

describe("objNeedsSmoothNormals", () => {
  it("is true only for smoothing on without vn normals", () => {
    expect(objNeedsSmoothNormals("v 0 0 0\ns 1\nf 1 2 3")).toBe(true);
    expect(objNeedsSmoothNormals("v 0 0 0\nvn 0 1 0\ns 1\nf 1//1 2//1 3//1")).toBe(false);
    expect(objNeedsSmoothNormals("v 0 0 0\ns off\nf 1 2 3")).toBe(false);
    expect(objNeedsSmoothNormals("v 0 0 0\ns 0\nf 1 2 3")).toBe(false);
    expect(objNeedsSmoothNormals("v 0 0 0\nf 1 2 3")).toBe(false);
  });
});
