// Wavefront OBJ + MTL.
import { ident } from "./mat";
import { shininessToRoughness } from "../../lighting";
import { defaultMaterial, mimeFromName, srgbToLinear, type RawImage, type RawMaterial, type RawPrimitive, type RawScene, type RawTexture } from "./types";

export type FileLookup = (reference: string) => Uint8Array | null;

interface MtlEntry {
  material: RawMaterial;
  mapName: string | null;
  alphaName: string | null;
  /** An explicit PBR roughness (Pr) wins over one estimated from Ns. */
  hasPr: boolean;
}

/** The file name at the end of a map statement, after any options such as `-bm 1` or `-s 1 1 1`. */
function mapFileName(args: string): string {
  const tokens = args.trim().split(/\s+/);
  const fixed: Record<string, number> = { "-bm": 1, "-boost": 1, "-mm": 2, "-texres": 1, "-clamp": 1, "-blendu": 1, "-blendv": 1, "-imfchan": 1, "-type": 1, "-cc": 1 };
  const vector = new Set(["-o", "-s", "-t"]); // one to three numbers
  let i = 0;
  while (i < tokens.length - 1) {
    const option = tokens[i]!.toLowerCase();
    if (fixed[option] !== undefined) i += 1 + fixed[option]!;
    else if (vector.has(option)) {
      i++;
      for (let taken = 0; taken < 3 && i < tokens.length - 1 && /^[-+]?(\d|\.\d)/.test(tokens[i]!); taken++) i++;
    } else break;
  }
  return tokens.slice(i).join(" ");
}

export function parseMtl(text: string): Map<string, MtlEntry> {
  const out = new Map<string, MtlEntry>();
  let current: MtlEntry | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const space = line.search(/\s/);
    const key = (space < 0 ? line : line.slice(0, space)).toLowerCase();
    const rest = space < 0 ? "" : line.slice(space + 1).trim();
    if (key === "newmtl") {
      current = { material: { ...defaultMaterial(rest), color: [1, 1, 1] }, mapName: null, alphaName: null, hasPr: false };
      out.set(rest, current);
      continue;
    }
    if (!current) continue;
    const nums = rest.split(/\s+/).map(Number);
    switch (key) {
      case "kd":
        current.material.color = [srgbToLinear(nums[0]!), srgbToLinear(nums[1] ?? nums[0]!), srgbToLinear(nums[2] ?? nums[0]!)];
        break;
      case "d":
        current.material.opacity = nums[nums.length - 1]!; // "d -halo 0.5" form
        break;
      case "tr":
        current.material.opacity = 1 - nums[0]!;
        break;
      case "ns":
        if (!current.hasPr) current.material.roughness = shininessToRoughness(nums[0]!);
        break;
      case "pr":
        current.material.roughness = Math.min(1, Math.max(0, nums[0]!));
        current.hasPr = true;
        break;
      case "pm":
        current.material.metallic = Math.min(1, Math.max(0, nums[0]!));
        break;
      case "map_kd":
        current.mapName = mapFileName(rest);
        break;
      case "map_d":
        current.alphaName = mapFileName(rest);
        break;
    }
  }
  for (const entry of out.values()) {
    if (entry.material.opacity < 1 || entry.alphaName) entry.material.transparent = true;
  }
  return out;
}

/** Resolve an OBJ index (1-based, negative = relative to the end). */
function resolveIndex(token: string | undefined, count: number): number {
  if (!token) return -1;
  const n = parseInt(token, 10);
  if (Number.isNaN(n) || n === 0) return -1;
  return n > 0 ? n - 1 : count + n;
}

export function parseObj(text: string, lookup: FileLookup): RawScene {
  const v: number[] = [];
  const vc: number[] = [];
  const vt: number[] = [];
  const vn: number[] = [];
  let hasVertexColors = false;
  let mtlText: string | null = null;
  const mtlNames: string[] = [];
  let smoothing = false;

  // One bucket per (material, smoothing on/off).
  interface Bucket { material: string; smooth: boolean; p: number[]; n: number[]; t: number[]; c: number[]; hasN: boolean; hasT: boolean }
  const buckets = new Map<string, Bucket>();
  let material = "";
  const bucket = () => {
    const key = `${material}\u0000${smoothing}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material, smooth: smoothing, p: [], n: [], t: [], c: [], hasN: true, hasT: true }));
    return b;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const space = line.search(/\s/);
    const key = space < 0 ? line : line.slice(0, space);
    line = space < 0 ? "" : line.slice(space + 1).trim();
    const parts = line.split(/\s+/);
    switch (key) {
      case "v":
        v.push(+parts[0]!, +parts[1]!, +parts[2]!);
        if (parts.length >= 6) {
          hasVertexColors = true;
          vc.push(srgbToLinear(+parts[3]!), srgbToLinear(+parts[4]!), srgbToLinear(+parts[5]!));
        } else vc.push(1, 1, 1);
        break;
      case "vt":
        vt.push(+parts[0]!, +(parts[1] ?? 0));
        break;
      case "vn":
        vn.push(+parts[0]!, +parts[1]!, +parts[2]!);
        break;
      case "f": {
        const corners = parts.map((token) => {
          const [a, b, c] = token.split("/");
          return { v: resolveIndex(a, v.length / 3), t: resolveIndex(b, vt.length / 2), n: resolveIndex(c, vn.length / 3) };
        });
        if (corners.length < 3 || corners.some((c) => c.v < 0 || c.v >= v.length / 3)) break;
        const b = bucket();
        // Fan triangulation of convex n-gons.
        for (let k = 1; k + 1 < corners.length; k++) {
          for (const c of [corners[0]!, corners[k]!, corners[k + 1]!]) {
            b.p.push(v[c.v * 3]!, v[c.v * 3 + 1]!, v[c.v * 3 + 2]!);
            b.c.push(vc[c.v * 3]!, vc[c.v * 3 + 1]!, vc[c.v * 3 + 2]!);
            if (c.t >= 0) b.t.push(vt[c.t * 2]!, vt[c.t * 2 + 1]!);
            else {
              b.t.push(0, 0);
              b.hasT = false;
            }
            if (c.n >= 0) b.n.push(vn[c.n * 3]!, vn[c.n * 3 + 1]!, vn[c.n * 3 + 2]!);
            else {
              b.n.push(0, 0, 0);
              b.hasN = false;
            }
          }
        }
        break;
      }
      case "usemtl":
        material = line;
        break;
      case "mtllib":
        mtlNames.push(line);
        break;
      case "s":
        smoothing = !(line === "0" || line.toLowerCase() === "off");
        break;
    }
  }

  const missing: string[] = [];
  for (const name of mtlNames) {
    const data = lookup(name);
    if (data) mtlText = (mtlText ?? "") + "\n" + new TextDecoder().decode(data);
    else missing.push(name);
  }
  const mtl = mtlText !== null ? parseMtl(mtlText) : new Map<string, MtlEntry>();

  const images: RawImage[] = [];
  const textures: RawTexture[] = [];
  const imageIndex = new Map<string, number>();
  const textureFor = (name: string | null): number | null => {
    if (!name) return null;
    let index = imageIndex.get(name);
    if (index === undefined) {
      const data = lookup(name);
      if (!data) missing.push(name);
      images.push({ data, mimeType: mimeFromName(name), name });
      textures.push({ image: images.length - 1, wrapS: "repeat", wrapT: "repeat", flipY: true });
      index = textures.length - 1;
      imageIndex.set(name, index);
    }
    return index;
  };

  const materials: RawMaterial[] = [];
  const materialIndex = new Map<string, number>();
  const materialFor = (name: string) => {
    let index = materialIndex.get(name);
    if (index === undefined) {
      const entry = mtl.get(name);
      const m: RawMaterial = entry ? { ...entry.material } : { ...defaultMaterial(name || "default"), color: [1, 1, 1] };
      if (entry) {
        m.map = textureFor(entry.mapName);
        m.alphaMap = textureFor(entry.alphaName);
      }
      m.vertexColors = hasVertexColors;
      materials.push(m);
      index = materials.length - 1;
      materialIndex.set(name, index);
    }
    return index;
  };

  const primitives: RawPrimitive[] = [];
  for (const b of buckets.values()) {
    if (!b.p.length) continue;
    primitives.push({
      positions: new Float32Array(b.p),
      normals: b.hasN ? new Float32Array(b.n) : null,
      uvs: b.hasT ? new Float32Array(b.t) : null,
      colors: hasVertexColors ? new Float32Array(b.c) : null,
      indices: null,
      material: materialFor(b.material),
      creaseAngle: b.smooth ? Math.PI / 3 : 0,
      matrix: ident(),
      clampUnitUVs: true,
    });
  }
  return { primitives, materials, textures, images, missing: [...new Set(missing)] };
}
