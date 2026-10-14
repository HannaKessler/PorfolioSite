// PLY, ASCII and binary (little- and big-endian): vertices with optional
// normals, texture coordinates and colours, and polygon faces.
import { ident } from "./mat";
import { NEUTRAL } from "./stl";
import { defaultMaterial, srgbToLinear, type RawScene } from "./types";

type Scalar = "int8" | "uint8" | "int16" | "uint16" | "int32" | "uint32" | "float32" | "float64";
const ALIASES: Record<string, Scalar> = {
  char: "int8", int8: "int8", uchar: "uint8", uint8: "uint8", short: "int16", int16: "int16", ushort: "uint16", uint16: "uint16",
  int: "int32", int32: "int32", uint: "uint32", uint32: "uint32", float: "float32", float32: "float32", double: "float64", float64: "float64",
};
const SIZES: Record<Scalar, number> = { int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, float32: 4, float64: 8 };

interface Property { name: string; type: Scalar; listCount?: Scalar }
interface Element { name: string; count: number; properties: Property[] }

export function parsePlyHeader(data: Uint8Array): { format: "ascii" | "binary_little_endian" | "binary_big_endian"; elements: Element[]; bodyOffset: number } {
  const limit = Math.min(data.length, 64 * 1024);
  const head = new TextDecoder("latin1").decode(data.subarray(0, limit));
  const end = head.search(/end_header\r?\n/);
  if (!head.startsWith("ply") || end < 0) throw new Error("Not a PLY file (missing header).");
  const bodyOffset = end + head.slice(end).indexOf("\n") + 1;
  let format: "ascii" | "binary_little_endian" | "binary_big_endian" = "ascii";
  const elements: Element[] = [];
  for (const line of head.slice(0, end).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t[0] === "format") format = t[1] as typeof format;
    else if (t[0] === "element") elements.push({ name: t[1]!, count: parseInt(t[2]!, 10), properties: [] });
    else if (t[0] === "property") {
      const element = elements[elements.length - 1];
      if (!element) continue;
      if (t[1] === "list") element.properties.push({ name: t[4]!, type: ALIASES[t[3]!]!, listCount: ALIASES[t[2]!]! });
      else element.properties.push({ name: t[2]!, type: ALIASES[t[1]!]! });
    }
  }
  if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(format)) throw new Error(`Unsupported PLY format "${format}".`);
  return { format, elements, bodyOffset };
}

export function parsePly(data: Uint8Array): RawScene {
  const { format, elements, bodyOffset } = parsePlyHeader(data);
  const rows: Record<string, (number | number[])[][]> = {};

  if (format === "ascii") {
    const tokens = new TextDecoder().decode(data.subarray(bodyOffset)).trim().split(/\s+/);
    let t = 0;
    for (const element of elements) {
      const list: (number | number[])[][] = (rows[element.name] = []);
      for (let i = 0; i < element.count; i++) {
        const row: (number | number[])[] = [];
        for (const p of element.properties) {
          if (p.listCount) {
            const n = +tokens[t++]!;
            row.push(tokens.slice(t, t + n).map(Number));
            t += n;
          } else row.push(+tokens[t++]!);
        }
        list.push(row);
      }
    }
  } else {
    const little = format === "binary_little_endian";
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let o = bodyOffset;
    const read = (type: Scalar): number => {
      let v: number;
      switch (type) {
        case "int8": v = view.getInt8(o); break;
        case "uint8": v = view.getUint8(o); break;
        case "int16": v = view.getInt16(o, little); break;
        case "uint16": v = view.getUint16(o, little); break;
        case "int32": v = view.getInt32(o, little); break;
        case "uint32": v = view.getUint32(o, little); break;
        case "float32": v = view.getFloat32(o, little); break;
        case "float64": v = view.getFloat64(o, little); break;
      }
      o += SIZES[type];
      return v;
    };
    for (const element of elements) {
      const list: (number | number[])[][] = (rows[element.name] = []);
      for (let i = 0; i < element.count; i++) {
        const row: (number | number[])[] = [];
        for (const p of element.properties) {
          if (p.listCount) {
            const n = read(p.listCount);
            const values: number[] = [];
            for (let k = 0; k < n; k++) values.push(read(p.type));
            row.push(values);
          } else row.push(read(p.type));
        }
        list.push(row);
      }
    }
  }

  const vertexElement = elements.find((e) => e.name === "vertex");
  if (!vertexElement) throw new Error("PLY file has no vertex element.");
  const col = (...names: string[]) => vertexElement.properties.findIndex((p) => names.includes(p.name));
  const ix = col("x"), iy = col("y"), iz = col("z");
  const inx = col("nx"), iny = col("ny"), inz = col("nz");
  const iu = col("s", "u", "texture_u", "texture_s"), iv = col("t", "v", "texture_v", "texture_t");
  const ir = col("red", "diffuse_red", "r"), ig = col("green", "diffuse_green", "g"), ib = col("blue", "diffuse_blue", "b");
  const vertices = rows.vertex!;
  const n = vertices.length;
  const positions = new Float32Array(n * 3);
  const normals = inx >= 0 ? new Float32Array(n * 3) : null;
  const uvs = iu >= 0 && iv >= 0 ? new Float32Array(n * 2) : null;
  const colors = ir >= 0 ? new Float32Array(n * 3) : null;
  const colorScale = ir >= 0 && vertexElement.properties[ir]!.type.startsWith("float") ? 1 : 255;
  vertices.forEach((row, i) => {
    positions.set([row[ix] as number, row[iy] as number, row[iz] as number], i * 3);
    if (normals) normals.set([row[inx] as number, row[iny] as number, row[inz] as number], i * 3);
    if (uvs) uvs.set([row[iu] as number, row[iv] as number], i * 2);
    if (colors) colors.set([srgbToLinear((row[ir] as number) / colorScale), srgbToLinear((row[ig] as number) / colorScale), srgbToLinear((row[ib] as number) / colorScale)], i * 3);
  });

  const faceElement = elements.find((e) => e.name === "face");
  let indices: Uint32Array | null = null;
  if (faceElement) {
    const listColumn = faceElement.properties.findIndex((p) => p.listCount && (p.name === "vertex_indices" || p.name === "vertex_index"));
    const out: number[] = [];
    for (const row of rows.face ?? []) {
      const poly = row[listColumn] as number[];
      for (let k = 1; k + 1 < poly.length; k++) out.push(poly[0]!, poly[k]!, poly[k + 1]!);
    }
    indices = new Uint32Array(out);
  }
  const material = defaultMaterial("ply");
  material.color = colors ? [1, 1, 1] : NEUTRAL;
  material.vertexColors = !!colors;
  return {
    primitives: [{ positions, normals, uvs, colors, indices, material: 0, creaseAngle: Math.PI, matrix: ident(), clampUnitUVs: false }],
    materials: [material],
    textures: [],
    images: [],
    missing: [],
  };
}
