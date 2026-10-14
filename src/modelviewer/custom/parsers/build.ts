// Turns a RawScene from any parser into the renderer-ready CustomScene layout:
// geometry baked to world space, normals filled in, parts grouped by
// material, model centred on the ground plane. Images stay encoded; the
// worker decodes only the ones a material actually uses.
import { uvsWithinUnitSquare } from "../../uv";
import type { Vec3 } from "../../mat4";
import { applyPoint, determinant3, normalMatrix } from "./mat";
import { creasedNormals, deindex, vertexNormals } from "./normals";
import type { RawMaterial, RawScene } from "./types";

export interface BuiltTextureRef {
  image: number;
  repeat: boolean;
  flipY: boolean;
}

export interface BuiltMaterial extends Omit<RawMaterial, "map" | "alphaMap"> {
  map: BuiltTextureRef | null;
  alphaMap: BuiltTextureRef | null;
}

export interface BuiltPart {
  start: number;
  count: number;
  material: BuiltMaterial;
  center: Vec3;
}

export interface BuiltMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array | null;
  parts: BuiltPart[];
}

export interface BuiltScene {
  meshes: BuiltMesh[];
  min: Vec3;
  max: Vec3;
  stats: { vertices: number; triangles: number };
}

export function buildScene(raw: RawScene): BuiltScene {
  const meshes: BuiltMesh[] = [];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let vertexCount = 0;

  for (const prim of raw.primitives) {
    const material = raw.materials[prim.material] ?? raw.materials[0];
    if (!material) continue;
    let positions = prim.positions;
    let normals = prim.normals;
    let uvs = prim.uvs;
    let colors = prim.colors;
    let indices = prim.indices;
    const count = positions.length / 3;
    if (count === 0) continue;

    // Bake the world transform.
    const m = prim.matrix;
    const nm = normalMatrix(m);
    const world = new Float32Array(positions.length);
    for (let i = 0; i < count; i++) {
      const p = applyPoint(m, positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      world[i * 3] = p[0];
      world[i * 3 + 1] = p[1];
      world[i * 3 + 2] = p[2];
    }
    positions = world;
    if (normals) {
      const out = new Float32Array(normals.length);
      for (let i = 0; i < count; i++) {
        const x = normals[i * 3]!, y = normals[i * 3 + 1]!, z = normals[i * 3 + 2]!;
        const nx = nm[0]! * x + nm[3]! * y + nm[6]! * z;
        const ny = nm[1]! * x + nm[4]! * y + nm[7]! * z;
        const nz = nm[2]! * x + nm[5]! * y + nm[8]! * z;
        const len = Math.hypot(nx, ny, nz) || 1;
        out[i * 3] = nx / len;
        out[i * 3 + 1] = ny / len;
        out[i * 3 + 2] = nz / len;
      }
      normals = out;
    }
    // A mirroring transform reverses winding: swap two corners per triangle.
    if (determinant3(m) < 0) {
      if (indices) {
        indices = indices.slice();
        for (let i = 0; i + 2 < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
      } else {
        const swap = (a: Float32Array | null, size: number) => {
          if (!a) return a;
          a = a.slice();
          for (let t = 0; t + 2 < count; t += 3)
            for (let c = 0; c < size; c++) {
              const i = (t + 1) * size + c, j = (t + 2) * size + c;
              [a[i], a[j]] = [a[j]!, a[i]!];
            }
          return a;
        };
        positions = swap(positions, 3)!;
        normals = swap(normals, 3);
        uvs = swap(uvs, 2);
        colors = swap(colors, 3);
      }
    }

    // Fill in missing normals.
    if (!normals) {
      if (indices && prim.creaseAngle >= Math.PI) {
        normals = vertexNormals(positions, indices);
      } else {
        if (indices) {
          positions = deindex(indices, positions, 3);
          uvs = uvs && deindex(indices, uvs, 2);
          colors = colors && deindex(indices, colors, 3);
          indices = null;
        }
        normals = creasedNormals(positions, prim.creaseAngle);
      }
    }

    const vertices = positions.length / 3;
    const indexCount = indices ? indices.length : vertices;
    triangles += Math.floor(indexCount / 3);
    vertexCount += vertices;
    let bmin: Vec3 = [Infinity, Infinity, Infinity];
    let bmax: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices; i++)
      for (let c = 0; c < 3; c++) {
        const v = positions[i * 3 + c]!;
        if (v < bmin[c]!) bmin[c] = v;
        if (v > bmax[c]!) bmax[c] = v;
      }
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c]!, bmin[c]!);
      max[c] = Math.max(max[c]!, bmax[c]!);
    }

    const insideUnit = uvs ? uvsWithinUnitSquare(uvs) : false;
    const ref = (index: number | null): BuiltTextureRef | null => {
      if (index === null) return null;
      const texture = raw.textures[index];
      if (!texture || !raw.images[texture.image]?.data) return null;
      let repeat = texture.wrapS === "repeat" || texture.wrapT === "repeat";
      if (repeat && prim.clampUnitUVs && insideUnit) repeat = false; // see uv.ts
      return { image: texture.image, repeat, flipY: texture.flipY };
    };
    const { map, alphaMap, ...rest } = material;
    meshes.push({
      positions,
      normals,
      uvs: uvs ?? new Float32Array(vertices * 2),
      colors: material.vertexColors && colors ? colors : new Float32Array(vertices * 3).fill(1),
      indices,
      parts: [
        {
          start: 0,
          count: indexCount,
          material: { ...rest, map: ref(map), alphaMap: ref(alphaMap) },
          center: [(bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2],
        },
      ],
    });
  }

  // Centre on the grid with the base at y = 0, like the engine panes.
  if (Number.isFinite(min[0])) {
    const shift: Vec3 = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
    for (const mesh of meshes) {
      for (let i = 0; i < mesh.positions.length; i += 3) {
        mesh.positions[i] = mesh.positions[i]! + shift[0];
        mesh.positions[i + 1] = mesh.positions[i + 1]! + shift[1];
        mesh.positions[i + 2] = mesh.positions[i + 2]! + shift[2];
      }
      for (const part of mesh.parts) part.center = [part.center[0] + shift[0], part.center[1] + shift[1], part.center[2] + shift[2]];
    }
    for (let c = 0; c < 3; c++) {
      min[c] = min[c]! + shift[c]!;
      max[c] = max[c]! + shift[c]!;
    }
  }
  return { meshes, min, max, stats: { vertices: vertexCount, triangles } };
}
