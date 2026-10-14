import { describe, expect, it } from "vitest";
import { envBrdfApprox, envCubeFaces, envRadiance, ENV, getLighting, setLighting, shininessToRoughness, subscribeLighting } from "../../src/modelviewer/lighting";
import { parseMtl } from "../../src/modelviewer/custom/parsers/obj";
import { parseGltf } from "../../src/modelviewer/custom/parsers/gltf";
import { defaultMaterial } from "../../src/modelviewer/custom/parsers/types";
import { noFiles, text } from "./parsers/helpers";

describe("lighting mode", () => {
  it("defaults to simple and notifies on change only", () => {
    expect(getLighting()).toBe("simple");
    let calls = 0;
    const off = subscribeLighting(() => calls++);
    setLighting("pbr");
    setLighting("pbr");
    expect(getLighting()).toBe("pbr");
    setLighting("simple");
    off();
    setLighting("pbr");
    expect(calls).toBe(2);
    setLighting("simple");
  });
});

describe("shininessToRoughness", () => {
  it("maps high shininess to smooth and low to rough, within [0.04, 1]", () => {
    expect(shininessToRoughness(0)).toBe(1);
    expect(shininessToRoughness(1000)).toBeLessThan(0.3);
    expect(shininessToRoughness(1e9)).toBe(0.04);
    expect(shininessToRoughness(10)).toBeGreaterThan(shininessToRoughness(100));
    expect(shininessToRoughness(Number.NaN)).toBe(1);
  });
});

describe("procedural environment", () => {
  it("is brighter above than below, and brightest toward the softbox", () => {
    const up = envRadiance([0, 1, 0]);
    const down = envRadiance([0, -1, 0]);
    expect(up[1]).toBeGreaterThan(down[1]);
    down.forEach((c, i) => expect(c).toBeCloseTo(ENV.floor[i]!));
    const toward = envRadiance(ENV.softbox.direction);
    expect(toward[0]).toBeGreaterThan(ENV.softbox.intensity);
  });

  it("builds six RGBA float faces", () => {
    const faces = envCubeFaces(4);
    expect(faces).toHaveLength(6);
    for (const f of faces) expect(f.length).toBe(4 * 4 * 4);
    // +Y face (index 2) looks at the sky, -Y (index 3) at the floor.
    expect(faces[2]![1]!).toBeGreaterThan(faces[3]![1]!);
  });

  it("environment BRDF terms stay in range and lose energy with roughness at grazing angles", () => {
    for (const r of [0, 0.25, 0.5, 1]) {
      for (const nv of [0.05, 0.5, 1]) {
        const [a, b] = envBrdfApprox(r, nv);
        expect(a + b).toBeGreaterThan(0);
        expect(a + b).toBeLessThanOrEqual(1.05);
      }
    }
    expect(envBrdfApprox(0, 1)[0]).toBeGreaterThan(envBrdfApprox(1, 1)[0]);
  });
});

describe("material metallic/roughness", () => {
  it("defaults to a dielectric", () => {
    expect(defaultMaterial()).toMatchObject({ metallic: 0, roughness: 0.5 });
  });

  it("OBJ: Pr/Pm are read, Ns estimates roughness, explicit Pr wins", () => {
    const m = parseMtl("newmtl A\nNs 900\nnewmtl B\nPr 0.3\nPm 1\nNs 5\n");
    expect(m.get("A")!.material.roughness).toBeCloseTo(shininessToRoughness(900));
    expect(m.get("B")!.material).toMatchObject({ roughness: 0.3, metallic: 1 });
  });

  it("glTF: metallicFactor and roughnessFactor, defaulting to 1 as in the spec", () => {
    const json = (pbr: Record<string, unknown>) => ({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString("base64")}` }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: pbr }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
    });
    expect(parseGltf(text(JSON.stringify(json({ metallicFactor: 0.2, roughnessFactor: 0.7 }))), noFiles).materials[0]).toMatchObject({ metallic: 0.2, roughness: 0.7 });
    expect(parseGltf(text(JSON.stringify(json({}))), noFiles).materials[0]).toMatchObject({ metallic: 1, roughness: 1 });
  });
});
