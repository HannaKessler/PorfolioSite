import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLES } from "../../src/modelviewer/samples";
import { parseMtl, parseObj } from "../../src/modelviewer/custom/parsers/obj";
import { lookupFrom } from "./parsers/helpers";

const dir = "public/projects/model-viewer/samples/";

describe("teapot sample", () => {
  it("ships its .mtl alongside the .obj", () => {
    const teapot = SAMPLES.find((s) => s.file === "teapot.obj")!;
    expect(teapot.extras).toEqual(["teapot.mtl"]);
  });

  it("uses the glazed ceramic material with PBR values", () => {
    const mtl = readFileSync(dir + "teapot.mtl", "utf8");
    const m = parseMtl(mtl).get("glazed_ceramic")!.material;
    expect(m).toMatchObject({ roughness: 0.18, metallic: 0 });
    const raw = parseObj(readFileSync(dir + "teapot.obj", "utf8"), lookupFrom({ "teapot.mtl": new TextEncoder().encode(mtl) }));
    expect(raw.missing).toEqual([]);
    expect(raw.materials.map((x) => x.name)).toEqual(["glazed_ceramic"]);
  });
});
