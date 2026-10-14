// Open (non-watertight) surfaces, such as a teapot spout modelled as a tube
// with an open tip. OBJ, STL and PLY carry no single/double-sided flag, so
// rendering them with back faces culled lets you look into the opening and
// straight through the far wall. Such meshes are drawn double-sided instead,
// with back faces lit using their flipped normal.

/**
 * True when some edge of the triangle list belongs to only one triangle.
 * Vertices are welded by position first, so seams where a file splits
 * vertices for UVs or normals don't count as openings.
 */
export function hasOpenEdges(positions: ArrayLike<number>, indices: ArrayLike<number> | null, start = 0, count?: number): boolean {
  const total = indices ? indices.length : positions.length / 3;
  const end = Math.min(total, start + (count ?? total));
  const welded = new Map<string, number>();
  const id = (vertex: number) => {
    const key = `${Math.round(positions[vertex * 3]! * 1e5)},${Math.round(positions[vertex * 3 + 1]! * 1e5)},${Math.round(positions[vertex * 3 + 2]! * 1e5)}`;
    let value = welded.get(key);
    if (value === undefined) welded.set(key, (value = welded.size));
    return value;
  };
  const edges = new Map<number, number>();
  const corner = new Array<number>(3);
  for (let t = start; t + 2 < end; t += 3) {
    for (let k = 0; k < 3; k++) corner[k] = id(indices ? indices[t + k]! : t + k);
    for (let k = 0; k < 3; k++) {
      const a = corner[k]!;
      const b = corner[(k + 1) % 3]!;
      if (a === b) continue; // degenerate
      const key = a < b ? a * 0x200000 + b : b * 0x200000 + a;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n === 1) return true;
  return false;
}

/** Formats with no sidedness information, where open meshes are drawn double-sided. */
export const NO_SIDE_INFO = new Set(["obj", "stl", "ply"]);
