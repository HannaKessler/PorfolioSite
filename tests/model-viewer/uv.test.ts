import { describe, expect, it } from "vitest";
import { uvsWithinUnitSquare } from "../../src/modelviewer/uv";

describe("uvsWithinUnitSquare", () => {
  it("accepts UVs inside [0, 1], allowing exporter rounding", () => {
    expect(uvsWithinUnitSquare(new Float32Array([0, 0, 1, 1, 0.5, 0.25]))).toBe(true);
    expect(uvsWithinUnitSquare([-0.00001, 1.00001])).toBe(true);
  });

  it("rejects tiling, negative or missing UVs", () => {
    expect(uvsWithinUnitSquare([0, 0, 2, 1])).toBe(false);
    expect(uvsWithinUnitSquare([-0.5, 0.5])).toBe(false);
    expect(uvsWithinUnitSquare([0, Number.NaN])).toBe(false);
    expect(uvsWithinUnitSquare([])).toBe(false);
    expect(uvsWithinUnitSquare(undefined)).toBe(false);
  });
});
