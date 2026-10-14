import { buildScene } from "../../../src/modelviewer/custom/parsers/build";
import type { RawScene } from "../../../src/modelviewer/custom/parsers/types";

export const text = (s: string) => new TextEncoder().encode(s);
export const noFiles = () => null;
export const lookupFrom = (files: Record<string, Uint8Array>) => (ref: string) => {
  const key = ref.split(/[\\/]/).pop()!.toLowerCase();
  for (const [name, data] of Object.entries(files)) if (name.toLowerCase() === key) return data;
  return null;
};

export function triangleCount(raw: RawScene): number {
  return raw.primitives.reduce((n, p) => n + (p.indices ? p.indices.length : p.positions.length / 3) / 3, 0);
}

export function size(raw: RawScene): number[] {
  const built = buildScene(raw);
  return [0, 1, 2].map((c) => +(built.max[c]! - built.min[c]!).toFixed(5));
}

/** World-space bounds before the builder recentres the model. */
export function worldBounds(raw: RawScene): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of raw.primitives) {
    const m = p.matrix;
    for (let i = 0; i < p.positions.length; i += 3) {
      const x = p.positions[i]!, y = p.positions[i + 1]!, z = p.positions[i + 2]!;
      const w = [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c]!, w[c]!);
        max[c] = Math.max(max[c]!, w[c]!);
      }
    }
  }
  return { min: min.map((v) => +v.toFixed(5)), max: max.map((v) => +v.toFixed(5)) };
}
