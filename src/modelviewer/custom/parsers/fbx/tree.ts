// Shared FBX node tree produced by the binary and ASCII parsers.

export interface FbxProp {
  type: string;
  type2: string;
  flag: string;
  value: number | number[] | string | boolean;
}

export interface FbxNode {
  name: string;
  id?: number;
  attrName?: string;
  attrType?: string;
  /** Single-property nodes store their value here (e.g. Vertices.a). */
  a?: number[] | Float32Array | Float64Array | Int32Array | Uint8Array | boolean[];
  propertyList?: unknown[];
  singleProperty?: boolean;
  /** Connections.C rows: [from, to, relationship?]. */
  connections?: unknown[][];
  [child: string]: unknown;
}

export interface FbxTree {
  [name: string]: FbxNode;
}

export function propValue(node: FbxNode | undefined, key: string): unknown {
  const p = node?.[key] as FbxProp | undefined;
  return p?.value;
}

export function propNumber(node: FbxNode | undefined, key: string, fallback: number): number {
  const v = propValue(node, key);
  return typeof v === "number" ? v : Array.isArray(v) ? Number(v[0]) : fallback;
}

export function propVec3(node: FbxNode | undefined, key: string): number[] | null {
  const v = propValue(node, key);
  return Array.isArray(v) && v.length >= 3 ? [Number(v[0]), Number(v[1]), Number(v[2])] : null;
}
