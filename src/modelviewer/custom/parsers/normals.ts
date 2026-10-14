// Normal generation for meshes that don't carry their own.

export interface Expanded {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
}

/** Copy indexed attributes out to one vertex per triangle corner. */
export function deindex(indices: Uint32Array, data: Float32Array, size: number): Float32Array {
  const out = new Float32Array(indices.length * size);
  for (let i = 0; i < indices.length; i++) {
    const src = indices[i]! * size;
    for (let c = 0; c < size; c++) out[i * size + c] = data[src + c]!;
  }
  return out;
}

/**
 * Normals for a non-indexed triangle list. Corners that share a position
 * average the normals of their faces when those faces meet at less than
 * `creaseAngle`; sharper edges stay hard. creaseAngle 0 gives flat shading.
 * Face normals are area-weighted (unnormalised cross products).
 */
export function creasedNormals(positions: Float32Array, creaseAngle: number): Float32Array {
  const triangles = Math.floor(positions.length / 9);
  const face = new Float32Array(triangles * 3);
  const unit = new Float32Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const p = t * 9;
    const ux = positions[p + 3]! - positions[p]!, uy = positions[p + 4]! - positions[p + 1]!, uz = positions[p + 5]! - positions[p + 2]!;
    const vx = positions[p + 6]! - positions[p]!, vy = positions[p + 7]! - positions[p + 1]!, vz = positions[p + 8]! - positions[p + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    face[t * 3] = nx;
    face[t * 3 + 1] = ny;
    face[t * 3 + 2] = nz;
    const len = Math.hypot(nx, ny, nz) || 1;
    unit[t * 3] = nx / len;
    unit[t * 3 + 1] = ny / len;
    unit[t * 3 + 2] = nz / len;
  }
  const normals = new Float32Array(positions.length);
  if (creaseAngle <= 0) {
    for (let t = 0; t < triangles; t++)
      for (let k = 0; k < 3; k++) normals.set(unit.subarray(t * 3, t * 3 + 3), t * 9 + k * 3);
    return normals;
  }

  // Group corners by (quantised) position.
  const groups = new Map<string, number[]>();
  const keyOf = (i: number) => `${Math.round(positions[i * 3]! * 1e5)},${Math.round(positions[i * 3 + 1]! * 1e5)},${Math.round(positions[i * 3 + 2]! * 1e5)}`;
  for (let i = 0; i < triangles * 3; i++) {
    const key = keyOf(i);
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(i);
  }
  const cosLimit = Math.cos(creaseAngle);
  for (const corners of groups.values()) {
    for (const corner of corners) {
      const t = Math.floor(corner / 3);
      let sx = 0, sy = 0, sz = 0;
      for (const other of corners) {
        const u = Math.floor(other / 3);
        const cos = unit[t * 3]! * unit[u * 3]! + unit[t * 3 + 1]! * unit[u * 3 + 1]! + unit[t * 3 + 2]! * unit[u * 3 + 2]!;
        if (u === t || cos >= cosLimit) {
          sx += face[u * 3]!;
          sy += face[u * 3 + 1]!;
          sz += face[u * 3 + 2]!;
        }
      }
      const len = Math.hypot(sx, sy, sz) || 1;
      normals[corner * 3] = sx / len;
      normals[corner * 3 + 1] = sy / len;
      normals[corner * 3 + 2] = sz / len;
    }
  }
  return normals;
}

/** Smooth normals for an indexed mesh: shared vertices average their faces (as three.js computeVertexNormals). */
export function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] = normals[v]! + nx;
      normals[v + 1] = normals[v + 1]! + ny;
      normals[v + 2] = normals[v + 2]! + nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!) || 1;
    normals[i] = normals[i]! / len;
    normals[i + 1] = normals[i + 1]! / len;
    normals[i + 2] = normals[i + 2]! / len;
  }
  return normals;
}
