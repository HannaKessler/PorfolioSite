import { describe, expect, it } from "vitest";
import { parseAsciiFbx } from "../../../src/modelviewer/custom/parsers/fbx/ascii";
import { parseBinaryFbx } from "../../../src/modelviewer/custom/parsers/fbx/binary";
import { parseFbx } from "../../../src/modelviewer/custom/parsers/fbx/scene";
import { srgbToLinear } from "../../../src/modelviewer/custom/parsers/types";
import { C, P, p70, writeBinaryFbx, type Node } from "./fbxWriter";
import { lookupFrom, noFiles, size, text, triangleCount, worldBounds } from "./helpers";

// A unit quad (one polygon, 4 corners) on the XY plane.
const QUAD_VERTS = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
const QUAD_INDEX = [0, 1, 2, -4];

const ascii = (body: string, header = "") => `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXVersion: 7400
}
${header}Objects:  {
${body}
}
`;

const geometryAscii = (extra = "") => `	Geometry: 100, "Geometry::Quad", "Mesh" {
		Vertices: *12 {
			a: ${QUAD_VERTS.join(",")}
		} 
		PolygonVertexIndex: *4 {
			a: ${QUAD_INDEX.join(",")}
		} 
${extra}	}`;

const modelAscii = (props = "", name = "Quad") => `	Model: 200, "Model::${name}", "Mesh" {
		Version: 232
		Properties70:  {
${props}		}
		Culling: "CullingOff"
	}`;

const connections = (rows: string) => `Connections:  {
${rows}
}
`;

describe("FBX ASCII", () => {
  it("parses nodes, Properties70 and multi-line arrays", () => {
    const tree = parseAsciiFbx(`Objects:  {
	Geometry: 1, "Geometry::G", "Mesh" {
		Vertices: *6 {
			a: 1,2,3,
4,5,6
		} 
	}
	Model: 2, "Model::M", "Mesh" {
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",1,2,3
			P: "RotationOrder", "enum", "", "",4
		}
	}
}
`);
    const objects = tree.Objects!;
    const geo = (objects.Geometry as Record<string, { Vertices: { a: number[] } }>)[1]!;
    expect(geo.Vertices.a).toEqual([1, 2, 3, 4, 5, 6]);
    const model = (objects.Model as Record<string, Record<string, { value: unknown }>>)[2]!;
    expect(model.Lcl_Translation!.value).toEqual([1, 2, 3]);
    expect(model.RotationOrder!.value).toBe(4);
  });

  it("triangulates polygons, applies Lcl transforms, double-sided culling and materials", async () => {
    const file =
      ascii(
        `${geometryAscii(`		LayerElementNormal: 0 {
			MappingInformationType: "ByVertice"
			ReferenceInformationType: "Direct"
			Normals: *12 {
				a: 0,0,1,0,0,1,0,0,1,0,0,1
			} 
		}
		LayerElementUV: 0 {
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {
				a: 0,0,1,0,1,1,0,1
			} 
			UVIndex: *4 {
				a: 0,1,2,3
			} 
		}
`)}
${modelAscii(`			P: "Lcl Translation", "Lcl Translation", "", "A",5,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",2,3,1
`)}
	Material: 300, "Material::Leaf", "" {
		Properties70:  {
			P: "DiffuseColor", "Color", "", "A",0.5,0.5,0.5
			P: "TransparencyFactor", "Number", "", "A",0.25
		}
	}`,
      ) +
      connections(`	C: "OO",200,0
	C: "OO",100,200
	C: "OO",300,200`);
    const raw = await parseFbx(text(file), noFiles, { doubleSided: new Set(["Quad"]), hidden: new Set() });
    expect(triangleCount(raw)).toBe(2);
    expect(worldBounds(raw)).toEqual({ min: [5, 0, 0], max: [7, 3, 0] });
    const prim = raw.primitives[0]!;
    expect(Array.from(prim.normals!.slice(0, 3))).toEqual([0, 0, 1]);
    expect(Array.from(prim.uvs!.slice(0, 6))).toEqual([0, 0, 1, 0, 1, 1]);
    const m = raw.materials[prim.material]!;
    expect(m.color[0]).toBeCloseTo(srgbToLinear(0.5));
    expect(m.opacity).toBe(0.75);
    expect(m.transparent).toBe(true);
    expect(m.side).toBe("double");
  });

  it("follows rotation order, pre-rotation and GeometricTranslation", async () => {
    const file =
      ascii(
        `${geometryAscii()}
${modelAscii(`			P: "PreRotation", "Vector3D", "Vector", "",0,0,90
			P: "GeometricTranslation", "Vector3D", "Vector", "",10,0,0
`)}`,
      ) + connections(`	C: "OO",200,0
	C: "OO",100,200`);
    const raw = await parseFbx(text(file), noFiles);
    // Geometry offset by +10 X, then rotated 90° about Z: x → y.
    expect(worldBounds(raw)).toEqual({ min: [-1, 10, 0], max: [0, 11, 0] });
  });

  it("converts Z-up files and skips hidden models", async () => {
    const settings = `GlobalSettings:  {
	Version: 1000
	Properties70:  {
		P: "UpAxis", "int", "Integer", "",2
		P: "UnitScaleFactor", "double", "Number", "",1
	}
}
`;
    const file = ascii(`${geometryAscii()}\n${modelAscii()}`, settings) + connections(`	C: "OO",200,0\n	C: "OO",100,200`);
    const raw = await parseFbx(text(file), noFiles);
    // Quad in XY becomes XZ with -90° about X.
    expect(size(raw)).toEqual([1, 0, 1]);
    const hidden = await parseFbx(text(file), noFiles, { doubleSided: new Set(), hidden: new Set(["Quad"]) });
    expect(hidden.primitives).toHaveLength(0);
  });

  it("wires textures through Video content and reports missing files", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const file =
      ascii(
        `${geometryAscii()}
${modelAscii()}
	Material: 300, "Material::M", "" {
	}
	Texture: 400, "Texture::Diffuse", "" {
		Properties70:  {
			P: "WrapModeU", "enum", "", "",1
		}
	}
	Video: 500, "Video::Diffuse", "Clip" {
		RelativeFilename: "textures\\\\leaf.png"
	}
	Texture: 401, "Texture::Alpha", "" {
	}
	Video: 501, "Video::Alpha", "Clip" {
		RelativeFilename: "alpha.png"
		Content: ,
			"${Buffer.from(png).toString("base64")}"
	}`,
      ) +
      connections(`	C: "OO",200,0
	C: "OO",100,200
	C: "OO",300,200
	C: "OP",400,300, "DiffuseColor"
	C: "OO",500,400
	C: "OP",401,300, "TransparentColor"
	C: "OO",501,401`);
    const raw = await parseFbx(text(file), lookupFrom({}));
    const m = raw.materials[raw.primitives[0]!.material]!;
    expect(m.map).not.toBeNull();
    expect(m.alphaMap).not.toBeNull();
    expect(m.transparent).toBe(true);
    expect(raw.textures[m.map!]!.wrapS).toBe("clamp");
    expect(raw.missing).toEqual(["leaf.png"]);
    expect(Array.from(raw.images[raw.textures[m.alphaMap!]!.image]!.data!)).toEqual(Array.from(png));

    const found = await parseFbx(text(file), lookupFrom({ "leaf.png": png }));
    expect(found.missing).toEqual([]);
  });
});

function binaryScene(version: number, zip: boolean): Uint8Array {
  const geometry: Node = {
    name: "Geometry",
    props: [["L", 100], ["S", "Quad\u0000\u0001Geometry"], ["S", "Mesh"]],
    children: [
      { name: "Vertices", props: [["d", QUAD_VERTS, { zip }]] },
      { name: "PolygonVertexIndex", props: [["i", QUAD_INDEX, { zip }]] },
      {
        name: "LayerElementNormal",
        props: [["I", 0]],
        children: [
          { name: "MappingInformationType", props: [["S", "ByPolygonVertex"]] },
          { name: "ReferenceInformationType", props: [["S", "Direct"]] },
          { name: "Normals", props: [["d", [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], { zip }]] },
        ],
      },
    ],
  };
  const model: Node = {
    name: "Model",
    props: [["L", 200], ["S", "Quad\u0000\u0001Model"], ["S", "Mesh"]],
    children: [p70(P("Lcl Translation", "Lcl Translation", ["D", 0], ["D", 2], ["D", 0]), P("Lcl Rotation", "Lcl Rotation", ["D", 0], ["D", 0], ["D", 90]))],
  };
  return writeBinaryFbx(
    [
      { name: "FBXHeaderExtension", children: [{ name: "FBXVersion", props: [["I", version]] }] },
      { name: "Objects", children: [geometry, model] },
      { name: "Connections", children: [C("OO", 200, 0), C("OO", 100, 200)] },
    ],
    version,
  );
}

describe("FBX binary", () => {
  it.each([
    [7400, false],
    [7400, true],
    [7500, true],
  ])("reads version %i (zlib arrays: %s)", async (version, zip) => {
    const data = binaryScene(version, zip);
    const tree = await parseBinaryFbx(data);
    expect(Object.keys(tree)).toEqual(["FBXHeaderExtension", "Objects", "Connections"]);
    const raw = await parseFbx(data, noFiles);
    expect(triangleCount(raw)).toBe(2);
    // Rotated 90° about Z then moved up 2: x ∈ [-1, 0], y ∈ [2, 3].
    expect(worldBounds(raw)).toEqual({ min: [-1, 2, 0], max: [0, 3, 0] });
    expect(Array.from(raw.primitives[0]!.normals!.slice(0, 3))).toEqual([0, 0, 1]);
  });

  it("strips the binary name separator from model names", async () => {
    const tree = await parseBinaryFbx(binaryScene(7400, false));
    const model = (tree.Objects!.Model as Record<string, { attrName: string }>)[200]!;
    expect(model.attrName).toBe("Quad");
  });

  it("reads embedded Video content bytes", async () => {
    const png = new Uint8Array([1, 2, 3]);
    const data = writeBinaryFbx([
      {
        name: "Objects",
        children: [{ name: "Video", props: [["L", 5], ["S", "V\u0000\u0001Video"], ["S", "Clip"]], children: [{ name: "RelativeFilename", props: [["S", "a.png"]] }, { name: "Content", props: [["R", png]] }] }],
      },
    ]);
    const tree = await parseBinaryFbx(data);
    const video = (tree.Objects!.Video as Record<string, { Content: Uint8Array }>)[5]!;
    expect(Array.from(video.Content)).toEqual([1, 2, 3]);
  });
});

describe("FBX versions", () => {
  it("refuses ASCII FBX 6.x with a clear message", async () => {
    await expect(parseFbx(text("; FBX 6.1.0 project file\nFBXHeaderExtension:  {\n\tFBXVersion: 6100\n}\n"), noFiles)).rejects.toThrow(/6\.1 isn't supported/);
  });
});
