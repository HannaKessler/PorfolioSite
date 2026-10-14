// Double-precision 4x4 helpers for scene transforms (column-major).
export type M4 = Float64Array;

export function ident(): M4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  return o;
}

export function mulAll(...ms: M4[]): M4 {
  return ms.reduce((acc, m) => mul(acc, m), ident());
}

export function translate(x: number, y: number, z: number): M4 {
  const m = ident();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scale(x: number, y: number, z: number): M4 {
  const m = ident();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

function axisRotation(axis: 0 | 1 | 2, radians: number): M4 {
  const m = ident();
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const [i, j] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  m[i * 4 + i] = c;
  m[j * 4 + j] = c;
  m[i * 4 + j] = s;
  m[j * 4 + i] = -s;
  return m;
}

/**
 * Euler rotation in degrees. `order` names the axes in the order they are
 * applied (FBX eEulerXYZ = rotate about X, then Y, then Z).
 */
export function euler(degrees: [number, number, number], order = "XYZ"): M4 {
  const rad = degrees.map((d) => (d * Math.PI) / 180);
  let m = ident();
  for (const ch of order) {
    const axis = ch === "X" ? 0 : ch === "Y" ? 1 : 2;
    m = mul(axisRotation(axis, rad[axis]!), m);
  }
  return m;
}

export function quat(x: number, y: number, z: number, w: number): M4 {
  const m = ident();
  m[0] = 1 - 2 * (y * y + z * z);
  m[1] = 2 * (x * y + z * w);
  m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);
  m[5] = 1 - 2 * (x * x + z * z);
  m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);
  m[9] = 2 * (y * z - x * w);
  m[10] = 1 - 2 * (x * x + y * y);
  return m;
}

/** Inverse of a rotation-only matrix (its transpose). */
export function transposeRotation(m: M4): M4 {
  const o = ident();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c]!;
  return o;
}

export function applyPoint(m: M4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

export function determinant3(m: M4): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[9]! * m[6]!) -
    m[4]! * (m[1]! * m[10]! - m[9]! * m[2]!) +
    m[8]! * (m[1]! * m[6]! - m[5]! * m[2]!)
  );
}

/** Inverse-transpose of the upper 3x3, for transforming normals (column-major 3x3). */
export function normalMatrix(m: M4): Float64Array {
  const a = m[0]!, b = m[4]!, c = m[8]!, d = m[1]!, e = m[5]!, f = m[9]!, g = m[2]!, h = m[6]!, i = m[10]!;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g) || 1;
  // cofactor matrix / det = (inverse)^T
  const out = new Float64Array(9);
  out[0] = (e * i - f * h) / det;
  out[3] = -(d * i - f * g) / det;
  out[6] = (d * h - e * g) / det;
  out[1] = -(b * i - c * h) / det;
  out[4] = (a * i - c * g) / det;
  out[7] = -(a * h - b * g) / det;
  out[2] = (b * f - c * e) / det;
  out[5] = -(a * f - c * d) / det;
  out[8] = (a * e - b * d) / det;
  // out is stored so that n' = [out0 out3 out6; out1 out4 out7; out2 out5 out8] * n
  return out;
}
