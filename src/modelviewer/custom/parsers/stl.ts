// STL, binary and ASCII. Binary files may carry a default colour with alpha in
// the header ("COLOR=" + RGBA bytes, Materialise Magics) and 15-bit per-face colours.
import { ident } from "./mat";
import { defaultMaterial, srgbToLinear, type RawScene } from "./types";

/** Neutral colour for formats with no material, matching the three.js pane (#b9b4ad). */
export const NEUTRAL: [number, number, number] = [srgbToLinear(0xb9 / 255), srgbToLinear(0xb4 / 255), srgbToLinear(0xad / 255)];

export function isBinaryStl(data: Uint8Array): boolean {
  if (data.length < 84) return false;
  const faces = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
  if (84 + faces * 50 === data.length) return true;
  // Not an exact binary size: ASCII if it starts with "solid" and has facets.
  const head = new TextDecoder().decode(data.subarray(0, Math.min(1024, data.length)));
  return !(/^\s*solid/i.test(head) && /facet/i.test(new TextDecoder().decode(data.subarray(0, Math.min(data.length, 4096)))));
}

export function parseStl(data: Uint8Array): RawScene {
  return isBinaryStl(data) ? parseBinary(data) : parseAscii(new TextDecoder().decode(data));
}

function finish(positions: number[], normals: number[], colors: number[] | null, opacity: number): RawScene {
  const material = defaultMaterial("stl");
  material.color = colors ? [1, 1, 1] : NEUTRAL;
  material.vertexColors = !!colors;
  if (opacity < 1) {
    material.opacity = opacity;
    material.transparent = true;
  }
  const n = new Float32Array(normals);
  // Some exporters write zero normals; let the builder compute flat ones instead.
  const usable = n.some((x) => x !== 0);
  return {
    primitives: [
      {
        positions: new Float32Array(positions),
        normals: usable ? n : null,
        uvs: null,
        colors: colors ? new Float32Array(colors) : null,
        indices: null,
        material: 0,
        creaseAngle: 0,
        matrix: ident(),
        clampUnitUVs: false,
      },
    ],
    materials: [material],
    textures: [],
    images: [],
    missing: [],
  };
}

function parseBinary(data: Uint8Array): RawScene {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const faces = view.getUint32(80, true);
  let defaultColor: [number, number, number] | null = null;
  let opacity = 1;
  for (let i = 0; i < 70; i++) {
    if (view.getUint32(i, false) === 0x434f4c4f /* COLO */ && view.getUint8(i + 4) === 0x52 /* R */ && view.getUint8(i + 5) === 0x3d /* = */) {
      defaultColor = [srgbToLinear(view.getUint8(i + 6) / 255), srgbToLinear(view.getUint8(i + 7) / 255), srgbToLinear(view.getUint8(i + 8) / 255)];
      opacity = view.getUint8(i + 9) / 255;
      break;
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] | null = defaultColor ? [] : null;
  for (let f = 0; f < faces; f++) {
    const o = 84 + f * 50;
    const nx = view.getFloat32(o, true), ny = view.getFloat32(o + 4, true), nz = view.getFloat32(o + 8, true);
    let rgb = defaultColor;
    if (colors) {
      const packed = view.getUint16(o + 48, true);
      if ((packed & 0x8000) === 0) rgb = [srgbToLinear((packed & 0x1f) / 31), srgbToLinear(((packed >> 5) & 0x1f) / 31), srgbToLinear(((packed >> 10) & 0x1f) / 31)];
    }
    for (let k = 0; k < 3; k++) {
      const p = o + 12 + k * 12;
      positions.push(view.getFloat32(p, true), view.getFloat32(p + 4, true), view.getFloat32(p + 8, true));
      normals.push(nx, ny, nz);
      if (colors && rgb) colors.push(...rgb);
    }
  }
  return finish(positions, normals, colors, opacity);
}

function parseAscii(text: string): RawScene {
  const positions: number[] = [];
  const normals: number[] = [];
  const facet = /facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)([\s\S]*?)endfacet/gi;
  const vertex = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  for (const match of text.matchAll(facet)) {
    const n = [+match[1]!, +match[2]!, +match[3]!];
    const corners = [...match[4]!.matchAll(vertex)].map((v) => [+v[1]!, +v[2]!, +v[3]!]);
    for (let k = 1; k + 1 < corners.length; k++)
      for (const c of [corners[0]!, corners[k]!, corners[k + 1]!]) {
        positions.push(c[0]!, c[1]!, c[2]!);
        normals.push(n[0]!, n[1]!, n[2]!);
      }
  }
  return finish(positions, normals, null, 1);
}
