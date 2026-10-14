// Lighting mode shared by all four panes: "simple" (hemisphere + two
// directional lights, the original look) or "pbr" (physically based shading
// with image-based lighting from an environment generated in the browser).

export type LightingMode = "simple" | "pbr";

let mode: LightingMode = "simple";
const listeners = new Set<() => void>();

export function getLighting(): LightingMode {
  return mode;
}

export function setLighting(next: LightingMode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
}

export function subscribeLighting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Perceptual roughness from a Phong/Blinn shininess exponent (OBJ Ns, FBX
 * ShininessExponent), via the usual Blinn-Phong to Beckmann mapping
 * alpha = sqrt(2 / (n + 2)) and roughness = sqrt(alpha).
 */
export function shininessToRoughness(shininess: number): number {
  const n = Math.max(0, Number.isFinite(shininess) ? shininess : 0);
  const alpha = Math.sqrt(2 / (n + 2));
  return Math.min(1, Math.max(0.04, Math.sqrt(alpha)));
}

/**
 * The procedural environment used for image-based lighting in the Babylon.js
 * and hand-written panes: a bright sky, a soft horizon, a warm dark floor and
 * one soft "softbox" light in the key light's direction. Linear RGB radiance.
 * The GLSL and WGSL shaders evaluate the same function analytically.
 */
export const ENV = {
  zenith: [0.6, 0.6, 0.64],
  horizon: [0.44, 0.43, 0.42],
  floor: [0.11, 0.1, 0.09],
  softbox: { direction: [3, 5, 4], intensity: 4, exponent: 64 },
} as const;

function normalize3(v: readonly number[]): [number, number, number] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

export function envRadiance(direction: readonly number[]): [number, number, number] {
  const d = normalize3(direction);
  const y = d[1];
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = y >= 0 ? ENV.horizon[i]! + (ENV.zenith[i]! - ENV.horizon[i]!) * Math.sqrt(y) : ENV.horizon[i]! + (ENV.floor[i]! - ENV.horizon[i]!) * Math.min(1, -y * 4);
  }
  const k = normalize3(ENV.softbox.direction);
  const lobe = ENV.softbox.intensity * Math.pow(Math.max(0, d[0] * k[0] + d[1] * k[1] + d[2] * k[2]), ENV.softbox.exponent);
  return [out[0] + lobe, out[1] + lobe, out[2] + lobe];
}

/** Cube-map face data (RGBA float) in Babylon's / WebGL's face order: +X, -X, +Y, -Y, +Z, -Z. */
export function envCubeFaces(size: number): Float32Array[] {
  const faces: Float32Array[] = [];
  const dir = (face: number, u: number, v: number): number[] => {
    switch (face) {
      case 0: return [1, -v, -u];
      case 1: return [-1, -v, u];
      case 2: return [u, 1, v];
      case 3: return [u, -1, -v];
      case 4: return [u, -v, 1];
      default: return [-u, -v, -1];
    }
  };
  for (let face = 0; face < 6; face++) {
    const data = new Float32Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        const c = envRadiance(dir(face, u, v));
        data.set([c[0], c[1], c[2], 1], (y * size + x) * 4);
      }
    }
    faces.push(data);
  }
  return faces;
}

/** Karis' analytic approximation of the split-sum environment BRDF: returns [scale, bias] for F0. */
export function envBrdfApprox(roughness: number, nDotV: number): [number, number] {
  const r = [roughness * -1 + 1, roughness * -0.0275 + 0.0425, roughness * -0.572 + 1.04, roughness * 0.022 - 0.04];
  const a004 = Math.min(r[0]! * r[0]!, Math.pow(2, -9.28 * nDotV)) * r[0]! + r[1]!;
  return [a004 * -1.04 + r[2]!, a004 * 1.04 + r[3]!];
}
