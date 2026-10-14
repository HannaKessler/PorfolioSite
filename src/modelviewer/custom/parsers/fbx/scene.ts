// Interpret an FBX node tree as a RawScene: geometry, materials, textures,
// transforms (full Autodesk pivot chain), connections, GlobalSettings.
import { euler, ident, mul, mulAll, scale, translate, transposeRotation, type M4 } from "../mat";
import { shininessToRoughness } from "../../../lighting";
import { defaultMaterial, mimeFromName, srgbToLinear, UnsupportedError, type RawImage, type RawMaterial, type RawPrimitive, type RawScene, type RawTexture } from "../types";
import type { FileLookup } from "../obj";
import { isBinaryFbx, parseBinaryFbx } from "./binary";
import { parseAsciiFbx } from "./ascii";
import { propNumber, propValue, propVec3, type FbxNode, type FbxTree } from "./tree";

// FBX extrinsic order → axis sequence for our euler() (applies axes in order).
const EULER_ORDERS = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"];

export async function parseFbx(data: Uint8Array, lookup: FileLookup, flags?: { doubleSided: Set<string>; hidden: Set<string> }): Promise<RawScene> {
  let tree: FbxTree;
  if (isBinaryFbx(data)) tree = await parseBinaryFbx(data);
  else {
    const text = new TextDecoder().decode(data);
    const version = Number(/FBXVersion:\s*(\d+)/.exec(text)?.[1] ?? 7000);
    if (version < 7000) throw new UnsupportedError(`ASCII FBX ${(version / 1000).toFixed(1)} isn't supported by the hand-written parser; re-export as FBX 7.x.`);
    tree = parseAsciiFbx(text);
  }
  return buildFbxScene(tree, lookup, flags);
}

interface Conn {
  parents: { id: number; relationship: string }[];
  children: { id: number; relationship: string }[];
}

function parseConnections(tree: FbxTree): Map<number, Conn> {
  const map = new Map<number, Conn>();
  const ensure = (id: number) => {
    let c = map.get(id);
    if (!c) map.set(id, (c = { parents: [], children: [] }));
    return c;
  };
  for (const row of tree.Connections?.connections ?? []) {
    const from = Number(row[0]), to = Number(row[1]);
    const relationship = String(row[2] ?? "");
    ensure(from).parents.push({ id: to, relationship });
    ensure(to).children.push({ id: from, relationship });
  }
  return map;
}

function layerBuffer(node: FbxNode | undefined): number[] {
  if (!node) return [];
  const a = node.a;
  if (Array.isArray(a)) return a as number[];
  if (a && typeof (a as Float32Array).length === "number") return Array.from(a as ArrayLike<number>);
  return [];
}

interface LayerInfo {
  dataSize: number;
  buffer: number[];
  indices: number[];
  mappingType: string;
  referenceType: string;
}

function parseLayer(node: FbxNode | undefined, dataKey: string, indexKey: string, dataSize: number): LayerInfo | null {
  if (!node || !(dataKey in node)) return null;
  return {
    dataSize,
    buffer: layerBuffer(node[dataKey] as FbxNode),
    indices: layerBuffer(node[indexKey] as FbxNode | undefined),
    mappingType: String((node.MappingInformationType as string) ?? "ByVertice"),
    referenceType: String((node.ReferenceInformationType as string) ?? "Direct"),
  };
}

function getData(polygonVertexIndex: number, polygonIndex: number, vertexIndex: number, info: LayerInfo): number[] {
  let index: number;
  switch (info.mappingType) {
    case "ByPolygonVertex":
      index = polygonVertexIndex;
      break;
    case "ByPolygon":
      index = polygonIndex;
      break;
    case "ByVertice":
    case "ByVertex":
      index = vertexIndex;
      break;
    case "AllSame":
      index = info.indices[0] ?? 0;
      break;
    default:
      index = polygonVertexIndex;
  }
  if (info.referenceType === "IndexToDirect") index = info.indices[index] ?? 0;
  const from = index * info.dataSize;
  return info.buffer.slice(from, from + info.dataSize);
}

function invertTranslate(t: M4): M4 {
  return translate(-(t[12] ?? 0), -(t[13] ?? 0), -(t[14] ?? 0));
}

/** Local transform: T · Roff · Rp · Rpre · R · Rpost⁻¹ · Rp⁻¹ · Soff · Sp · S · Sp⁻¹. */
function localTransform(node: FbxNode): M4 {
  const order = EULER_ORDERS[propNumber(node, "RotationOrder", 0)] ?? "XYZ";
  const t = propVec3(node, "Lcl_Translation") ?? [0, 0, 0];
  const r = propVec3(node, "Lcl_Rotation") ?? [0, 0, 0];
  const s = propVec3(node, "Lcl_Scaling") ?? [1, 1, 1];
  const pre = propVec3(node, "PreRotation");
  const post = propVec3(node, "PostRotation");
  const roff = propVec3(node, "RotationOffset") ?? [0, 0, 0];
  const rp = propVec3(node, "RotationPivot") ?? [0, 0, 0];
  const soff = propVec3(node, "ScalingOffset") ?? [0, 0, 0];
  const sp = propVec3(node, "ScalingPivot") ?? [0, 0, 0];

  const T = translate(t[0]!, t[1]!, t[2]!);
  const Roff = translate(roff[0]!, roff[1]!, roff[2]!);
  const Rp = translate(rp[0]!, rp[1]!, rp[2]!);
  const Rpre = pre ? euler([pre[0]!, pre[1]!, pre[2]!], "XYZ") : ident();
  const R = euler([r[0]!, r[1]!, r[2]!], order);
  const Rpost = post ? transposeRotation(euler([post[0]!, post[1]!, post[2]!], "XYZ")) : ident();
  const Soff = translate(soff[0]!, soff[1]!, soff[2]!);
  const Sp = translate(sp[0]!, sp[1]!, sp[2]!);
  const S = scale(s[0]!, s[1]!, s[2]!);
  return mulAll(T, Roff, Rp, Rpre, R, Rpost, invertTranslate(Rp), Soff, Sp, S, invertTranslate(Sp));
}

function geometricTransform(node: FbxNode): M4 {
  const t = propVec3(node, "GeometricTranslation") ?? [0, 0, 0];
  const r = propVec3(node, "GeometricRotation") ?? [0, 0, 0];
  const s = propVec3(node, "GeometricScaling") ?? [1, 1, 1];
  if (t.every((v) => v === 0) && r.every((v) => v === 0) && s.every((v) => v === 1)) return ident();
  return mulAll(translate(t[0]!, t[1]!, t[2]!), euler([r[0]!, r[1]!, r[2]!], EULER_ORDERS[propNumber(node, "RotationOrder", 0)] ?? "XYZ"), scale(s[0]!, s[1]!, s[2]!));
}

function axisConversion(tree: FbxTree): M4 {
  const gs = tree.GlobalSettings;
  if (!gs) return ident();
  // Match three.js: only correct Z-up → Y-up. UnitScaleFactor is recorded by
  // three.js but not applied to geometry, so we leave it alone too.
  const up = propNumber(gs, "UpAxis", 1);
  return up === 2 ? euler([-90, 0, 0], "XYZ") : ident();
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function materialOpacity(node: FbxNode): number {
  let opacity = 1 - (typeof propValue(node, "TransparencyFactor") === "number" ? (propValue(node, "TransparencyFactor") as number) : 0);
  if (opacity === 1 || opacity === 0) {
    const o = propValue(node, "Opacity");
    opacity = typeof o === "number" ? o : 1;
  }
  return opacity;
}

/** Roughness estimated from the Phong shininess exponent, when the file has one. */
function materialRoughness(node: FbxNode): number {
  const s = propValue(node, "ShininessExponent") ?? propValue(node, "Shininess");
  return typeof s === "number" ? shininessToRoughness(s) : 0.5;
}

function materialColor(node: FbxNode): [number, number, number] {
  const c = propVec3(node, "Diffuse") ?? propVec3(node, "DiffuseColor") ?? [0.8, 0.8, 0.8];
  return [srgbToLinear(c[0]!), srgbToLinear(c[1]!), srgbToLinear(c[2]!)];
}

export function buildFbxScene(tree: FbxTree, lookup: FileLookup, flags?: { doubleSided: Set<string>; hidden: Set<string> }): RawScene {
  const connections = parseConnections(tree);
  const objects = tree.Objects as FbxNode | undefined;
  if (!objects) return { primitives: [], materials: [], textures: [], images: [], missing: [] };

  const missing: string[] = [];
  const images: RawImage[] = [];
  const textures: RawTexture[] = [];
  const materials: RawMaterial[] = [];
  const imageByVideo = new Map<number, number>();
  const textureById = new Map<number, number>();
  const materialById = new Map<number, number>();

  // Videos → images.
  const videos = (objects.Video ?? {}) as Record<string, FbxNode>;
  for (const [idStr, video] of Object.entries(videos)) {
    const id = Number(idStr);
    const fileName = String(video.RelativeFilename ?? video.Filename ?? video.attrName ?? `video_${id}`);
    const base = fileName.split(/[/\\]/).pop()!;
    let data: Uint8Array | null = null;
    const content = video.Content;
    if (content instanceof Uint8Array) data = content;
    else if (typeof content === "string" && content.length > 0) data = decodeBase64(content);
    else {
      data = lookup(base) ?? lookup(fileName);
      if (!data) missing.push(base);
    }
    imageByVideo.set(id, images.length);
    images.push({ data, mimeType: mimeFromName(base), name: base });
  }

  // Textures.
  const textureNodes = (objects.Texture ?? {}) as Record<string, FbxNode>;
  for (const [idStr, tex] of Object.entries(textureNodes)) {
    const id = Number(idStr);
    const kids = connections.get(id)?.children ?? [];
    const videoId = kids.find((c) => imageByVideo.has(c.id))?.id;
    const image = videoId !== undefined ? imageByVideo.get(videoId)! : -1;
    if (image < 0) continue;
    const wrapU = propNumber(tex, "WrapModeU", 0); // 0 = repeat, 1 = clamp
    const wrapV = propNumber(tex, "WrapModeV", 0);
    textureById.set(id, textures.length);
    textures.push({
      image,
      wrapS: wrapU === 1 ? "clamp" : "repeat",
      wrapT: wrapV === 1 ? "clamp" : "repeat",
      flipY: true,
    });
  }

  // Materials.
  const materialNodes = (objects.Material ?? {}) as Record<string, FbxNode>;
  for (const [idStr, mat] of Object.entries(materialNodes)) {
    const id = Number(idStr);
    const opacity = materialOpacity(mat);
    let map: number | null = null;
    let alphaMap: number | null = null;
    for (const child of connections.get(id)?.children ?? []) {
      const tex = textureById.get(child.id);
      if (tex === undefined) continue;
      if (child.relationship === "DiffuseColor" || child.relationship === "Maya|TEX_color_map") map = tex;
      if (child.relationship === "TransparentColor" || child.relationship === "TransparencyFactor" || child.relationship === "Opacity") {
        alphaMap = tex;
      }
    }
    materialById.set(id, materials.length);
    materials.push({
      ...defaultMaterial(mat.attrName ?? `material_${id}`),
      color: materialColor(mat),
      roughness: materialRoughness(mat),
      opacity,
      transparent: opacity < 1 || alphaMap !== null,
      map,
      alphaMap,
    });
  }
  if (!materials.length) materials.push({ ...defaultMaterial("default"), color: [1, 1, 1] });

  // Models + world matrices.
  const modelNodes = (objects.Model ?? {}) as Record<string, FbxNode>;
  const world = new Map<number, M4>();
  const geoOf = new Map<number, number[]>(); // model → geometry ids
  const matOf = new Map<number, number[]>(); // model → material ids
  const modelName = new Map<number, string>();

  for (const [idStr, model] of Object.entries(modelNodes)) {
    const id = Number(idStr);
    modelName.set(id, model.attrName ?? `Model_${id}`);
    const geos: number[] = [];
    const mats: number[] = [];
    for (const child of connections.get(id)?.children ?? []) {
      if ((objects.Geometry as Record<string, FbxNode> | undefined)?.[child.id]) geos.push(child.id);
      if (materialById.has(child.id)) mats.push(child.id);
    }
    geoOf.set(id, geos);
    matOf.set(id, mats);
  }

  const visiting = new Set<number>();
  const computeWorld = (id: number): M4 => {
    if (world.has(id)) return world.get(id)!;
    if (visiting.has(id)) return ident();
    visiting.add(id);
    const model = modelNodes[id]!;
    const local = localTransform(model);
    const parents = (connections.get(id)?.parents ?? []).filter((p) => modelNodes[p.id]);
    const parentM = parents.length ? computeWorld(parents[0]!.id) : axisConversion(tree);
    const m = mul(parentM, local);
    world.set(id, m);
    visiting.delete(id);
    return m;
  };
  for (const id of Object.keys(modelNodes).map(Number)) computeWorld(id);

  // Geometry → primitives.
  const geometryNodes = (objects.Geometry ?? {}) as Record<string, FbxNode>;
  const primitives: RawPrimitive[] = [];
  const defaultMat = 0;

  const buildGeometry = (geoId: number, matrix: M4, materialIds: number[], modelLabel: string) => {
    const geo = geometryNodes[geoId];
    if (!geo || geo.attrType === "Shape" || geo.attrType === "NurbsCurve") return;
    const vertices = layerBuffer(geo.Vertices as FbxNode | undefined);
    const indices = layerBuffer(geo.PolygonVertexIndex as FbxNode | undefined);
    if (!vertices.length || !indices.length) return;

    // First LayerElement* of each kind.
    const pickLayer = (key: string): FbxNode | undefined => {
      const group = geo[key];
      if (!group) return undefined;
      if ((group as FbxNode).MappingInformationType) return group as FbxNode;
      const values = Object.values(group as Record<string, FbxNode>);
      return values.find((v) => v && (v as FbxNode).MappingInformationType) as FbxNode | undefined;
    };

    const normals = parseLayer(pickLayer("LayerElementNormal"), "Normals", "NormalsIndex", 3);
    const uvs = parseLayer(pickLayer("LayerElementUV"), "UV", "UVIndex", 2);
    const colors = parseLayer(pickLayer("LayerElementColor"), "Colors", "ColorIndex", 4);
    const materialsLayer = parseLayer(pickLayer("LayerElementMaterial"), "Materials", "Materials", 1);

    const positions: number[] = [];
    const normalsOut: number[] = [];
    const uvsOut: number[] = [];
    const colorsOut: number[] = [];
    const materialBuckets = new Map<number, number[]>(); // materialIndex → triangle corner indices into positions

    // Walk once, storing per-corner attributes.
    const cornerN: number[][] = [];
    const cornerU: number[][] = [];
    const cornerC: number[][] = [];
    const cornerV: number[] = [];
    const cornerPoly: number[] = [];
    let face: number[] = [];
    let polygonIndex = 0;
    let polygonVertexIndex = 0;
    for (const raw of indices) {
      const end = raw < 0;
      const vertexIndex = end ? ~raw : raw;
      face.push(vertexIndex);
      cornerV.push(vertexIndex);
      cornerPoly.push(polygonIndex);
      if (normals) cornerN.push(getData(polygonVertexIndex, polygonIndex, vertexIndex, normals));
      if (uvs) cornerU.push(getData(polygonVertexIndex, polygonIndex, vertexIndex, uvs));
      if (colors) cornerC.push(getData(polygonVertexIndex, polygonIndex, vertexIndex, colors));
      polygonVertexIndex++;
      if (end) {
        // Fan-triangulate this face using the corners just collected.
        const faceStart = polygonVertexIndex - face.length;
        let matSlot = 0;
        if (materialsLayer && materialsLayer.buffer.length) {
          matSlot = materialsLayer.mappingType === "ByPolygon" ? (materialsLayer.buffer[polygonIndex] ?? 0) : materialsLayer.buffer[0]!;
        }
        const matId = materialIds[matSlot] ?? materialIds[0];
        const matIndex = matId !== undefined ? (materialById.get(matId) ?? defaultMat) : defaultMat;
        let bucket = materialBuckets.get(matIndex);
        if (!bucket) materialBuckets.set(matIndex, (bucket = []));

        for (let k = 1; k + 1 < face.length; k++) {
          for (const corner of [faceStart, faceStart + k, faceStart + k + 1]) {
            const vi = cornerV[corner]!;
            const base = positions.length / 3;
            positions.push(vertices[vi * 3]!, vertices[vi * 3 + 1]!, vertices[vi * 3 + 2]!);
            if (normals) {
              const n = cornerN[corner]!;
              normalsOut.push(n[0]!, n[1]!, n[2]!);
            }
            if (uvs) {
              const u = cornerU[corner]!;
              uvsOut.push(u[0]!, u[1]!);
            }
            if (colors) {
              const c = cornerC[corner]!;
              colorsOut.push(srgbToLinear(c[0]!), srgbToLinear(c[1]!), srgbToLinear(c[2]!));
            }
            bucket.push(base);
          }
        }
        polygonIndex++;
        face = [];
      }
    }
    void modelLabel;

    if (!positions.length) return;

    // One primitive per material bucket (keeps multi-material meshes correct).
    for (const [matIndex, corners] of materialBuckets) {
      const p = new Float32Array(corners.length * 3);
      const n = normals ? new Float32Array(corners.length * 3) : null;
      const u = uvs ? new Float32Array(corners.length * 2) : null;
      const c = colors ? new Float32Array(corners.length * 3) : null;
      corners.forEach((src, i) => {
        p[i * 3] = positions[src * 3]!;
        p[i * 3 + 1] = positions[src * 3 + 1]!;
        p[i * 3 + 2] = positions[src * 3 + 2]!;
        if (n) {
          n[i * 3] = normalsOut[src * 3]!;
          n[i * 3 + 1] = normalsOut[src * 3 + 1]!;
          n[i * 3 + 2] = normalsOut[src * 3 + 2]!;
        }
        if (u) {
          u[i * 2] = uvsOut[src * 2]!;
          u[i * 2 + 1] = uvsOut[src * 2 + 1]!;
        }
        if (c) {
          c[i * 3] = colorsOut[src * 3]!;
          c[i * 3 + 1] = colorsOut[src * 3 + 1]!;
          c[i * 3 + 2] = colorsOut[src * 3 + 2]!;
        }
      });
      let material = matIndex;
      if (colors) {
        const m = { ...materials[material]!, vertexColors: true };
        materials.push(m);
        material = materials.length - 1;
      }
      if (flags?.doubleSided.has(modelLabel)) {
        const m = { ...materials[material]!, side: "double" as const };
        materials.push(m);
        material = materials.length - 1;
      }
      primitives.push({
        positions: p,
        normals: n,
        uvs: u,
        colors: c,
        indices: null,
        material,
        creaseAngle: n ? 0 : Math.PI / 3,
        matrix,
        clampUnitUVs: true,
      });
    }
  };

  for (const [idStr, model] of Object.entries(modelNodes)) {
    const id = Number(idStr);
    const name = modelName.get(id) ?? "";
    if (flags?.hidden.has(name)) continue;
    if (model.attrType === "Camera" || model.attrType === "Light" || model.attrType === "LimbNode" || model.attrType === "Null") continue;
    const geos = geoOf.get(id) ?? [];
    if (!geos.length) continue;
    const matrix = mul(world.get(id) ?? ident(), geometricTransform(model));
    const mats = matOf.get(id) ?? [];
    for (const geoId of geos) buildGeometry(geoId, matrix, mats, name);
  }

  return { primitives, materials, textures, images, missing: [...new Set(missing)] };
}
