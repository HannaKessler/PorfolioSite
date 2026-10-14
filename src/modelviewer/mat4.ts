// Tiny column-major 4x4 matrix and orbit-camera helpers for the hand-written
// renderers. No dependencies, so the maths is unit-tested on its own.

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a × b (apply b first, then a). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * Right-handed perspective projection. WebGL2 clips depth to [-1, 1];
 * WebGPU to [0, 1], selected with zeroToOne.
 */
export function perspective(fovY: number, aspect: number, near: number, far: number, zeroToOne: boolean): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[11] = -1;
  if (zeroToOne) {
    m[10] = far / (near - far);
    m[14] = (far * near) / (near - far);
  } else {
    m[10] = (far + near) / (near - far);
    m[14] = (2 * far * near) / (near - far);
  }
  return m;
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** View matrix looking from eye at target (camera looks down its local -Z). */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const z = normalize(subtract(eye, target));
  let x = cross(up, z);
  if (Math.hypot(...x) < 1e-9) x = cross([0, 0, 1], z);
  x = normalize(x);
  const y = cross(z, x);
  const m = identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -dot(x, eye);
  m[13] = -dot(y, eye);
  m[14] = -dot(z, eye);
  return m;
}

/** Multiply a point by m, including the perspective divide. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!;
  const y = m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!;
  const z = m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!;
  const w = m[3]! * p[0] + m[7]! * p[1] + m[11]! * p[2] + m[15]!;
  return [x / w, y / w, z / w];
}

/** Orbit camera: azimuth around +Y measured from +Z, polar angle measured down from +Y. */
export interface Orbit {
  target: Vec3;
  radius: number;
  azimuth: number;
  polar: number;
}

export function orbitEye(orbit: Orbit): Vec3 {
  const s = Math.sin(orbit.polar);
  return [
    orbit.target[0] + orbit.radius * s * Math.sin(orbit.azimuth),
    orbit.target[1] + orbit.radius * Math.cos(orbit.polar),
    orbit.target[2] + orbit.radius * s * Math.cos(orbit.azimuth),
  ];
}

export function anglesFromDirection(direction: Vec3): { azimuth: number; polar: number } {
  const d = normalize(direction);
  return { azimuth: Math.atan2(d[0], d[2]), polar: Math.acos(Math.min(1, Math.max(-1, d[1]))) };
}

const MIN_POLAR = 0.01;

/** Rotate by a pointer drag, the way three.js OrbitControls does (a full-height drag = one turn). */
export function rotateOrbit(orbit: Orbit, dx: number, dy: number, viewportHeight: number): Orbit {
  const scale = (2 * Math.PI) / Math.max(viewportHeight, 1);
  const polar = Math.min(Math.PI - MIN_POLAR, Math.max(MIN_POLAR, orbit.polar - dy * scale));
  return { ...orbit, azimuth: orbit.azimuth - dx * scale, polar };
}

/** Wheel zoom: 5% per 100 units of deltaY, positive deltaY zooms out (as in three.js). */
export function zoomOrbit(orbit: Orbit, deltaY: number, minRadius: number, maxRadius: number): Orbit {
  const radius = orbit.radius * Math.pow(0.95, -deltaY / 100);
  return { ...orbit, radius: Math.min(maxRadius, Math.max(minRadius, radius)) };
}

/** Pan the target in the view plane so the model follows the pointer. */
export function panOrbit(orbit: Orbit, dx: number, dy: number, viewportHeight: number, fovY: number): Orbit {
  const eye = orbitEye(orbit);
  const forward = normalize(subtract(orbit.target, eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const perPixel = (2 * orbit.radius * Math.tan(fovY / 2)) / Math.max(viewportHeight, 1);
  const t = orbit.target;
  return {
    ...orbit,
    target: [
      t[0] - right[0] * dx * perPixel + up[0] * dy * perPixel,
      t[1] - right[1] * dx * perPixel + up[1] * dy * perPixel,
      t[2] - right[2] * dx * perPixel + up[2] * dy * perPixel,
    ],
  };
}

/** Distance at which a sphere of this radius fills the vertical field of view, with a little margin. */
export function frameDistance(boundingRadius: number, fovY: number): number {
  return (Math.max(boundingRadius, 1e-6) / Math.sin(fovY / 2)) * 1.15;
}

/** Orbit that frames an axis-aligned box from the same direction as the three.js pane. */
export function frameBox(min: Vec3, max: Vec3, fovY: number): Orbit {
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const radius = frameDistance(Math.hypot(...size) / 2, fovY);
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { target: center, radius, ...anglesFromDirection([1, 0.7, 1.2]) };
}

/** Grid cell size: a power of ten close to the model size, matching the three.js pane. */
export function gridCell(boundingRadius: number): number {
  return Math.pow(10, Math.floor(Math.log10(Math.max(boundingRadius, 1e-6))) - 1) * 2;
}
