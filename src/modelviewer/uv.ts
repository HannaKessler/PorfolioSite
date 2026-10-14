// Pure helper shared by the three.js and Babylon.js panes; no engine imports, so it is unit-testable.

/**
 * True when every UV coordinate lies inside the unit square (with a tiny
 * tolerance for exporter rounding). Such a mesh never relies on texture
 * repetition, so its textures can be clamped at the edges instead of
 * wrapping: with Repeat, bilinear and mipmap filtering at a UV edge blends in
 * texels from the opposite side of the image.
 */
export function uvsWithinUnitSquare(uvs: ArrayLike<number> | null | undefined, epsilon = 1e-4): boolean {
  if (!uvs || uvs.length === 0) return false;
  for (let i = 0; i < uvs.length; i++) {
    const value = uvs[i]!;
    if (!(value >= -epsilon && value <= 1 + epsilon)) return false;
  }
  return true;
}
