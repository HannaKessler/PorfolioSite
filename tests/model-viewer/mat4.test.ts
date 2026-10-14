import { describe, expect, it } from "vitest";
import {
  anglesFromDirection,
  frameBox,
  frameDistance,
  gridCell,
  identity,
  lookAt,
  multiply,
  orbitEye,
  panOrbit,
  perspective,
  rotateOrbit,
  transformPoint,
  zoomOrbit,
  type Orbit,
  type Vec3,
} from "../../src/modelviewer/mat4";

const close = (a: ArrayLike<number>, b: ArrayLike<number>, digits = 5) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i]!, digits);
};

describe("matrices", () => {
  it("multiplies with identity and composes in order", () => {
    const view = lookAt([1, 2, 3], [0, 0, 0]);
    close(multiply(identity(), view), view);
    close(multiply(view, identity()), view);
  });

  it("lookAt puts the eye at the origin and the target straight ahead (-Z)", () => {
    const view = lookAt([3, 4, 5], [1, 1, 1]);
    close(transformPoint(view, [3, 4, 5]), [0, 0, 0]);
    const ahead = transformPoint(view, [1, 1, 1]);
    close(ahead.slice(0, 2), [0, 0]);
    expect(ahead[2]).toBeCloseTo(-Math.hypot(2, 3, 4));
  });

  it("lookAt survives looking straight down", () => {
    const view = lookAt([0, 5, 0], [0, 0, 0]);
    expect([...view].every(Number.isFinite)).toBe(true);
    close(transformPoint(view, [0, 0, 0]), [0, 0, -5]);
  });

  it("perspective maps near and far to the API's depth range", () => {
    const gl = perspective(Math.PI / 3, 1.5, 0.1, 100, false);
    const gpu = perspective(Math.PI / 3, 1.5, 0.1, 100, true);
    expect(transformPoint(gl, [0, 0, -0.1])[2]).toBeCloseTo(-1);
    expect(transformPoint(gl, [0, 0, -100])[2]).toBeCloseTo(1);
    expect(transformPoint(gpu, [0, 0, -0.1])[2]).toBeCloseTo(0);
    expect(transformPoint(gpu, [0, 0, -100])[2]).toBeCloseTo(1);
    // A point on the top edge of the frustum lands on y = 1.
    expect(transformPoint(gpu, [0, Math.tan(Math.PI / 6) * 10, -10])[1]).toBeCloseTo(1);
  });
});

describe("orbit camera", () => {
  const base: Orbit = { target: [1, 2, 3], radius: 10, azimuth: 0.4, polar: 1.1 };

  it("places the eye at the radius and round-trips its direction", () => {
    const eye = orbitEye(base);
    const offset: Vec3 = [eye[0] - 1, eye[1] - 2, eye[2] - 3];
    expect(Math.hypot(...offset)).toBeCloseTo(10);
    const angles = anglesFromDirection(offset);
    expect(angles.azimuth).toBeCloseTo(0.4);
    expect(angles.polar).toBeCloseTo(1.1);
  });

  it("rotates a full turn per viewport height and clamps at the poles", () => {
    expect(rotateOrbit(base, 500, 0, 500).azimuth).toBeCloseTo(0.4 - 2 * Math.PI);
    expect(rotateOrbit(base, 0, 10000, 500).polar).toBeGreaterThan(0);
    expect(rotateOrbit(base, 0, -10000, 500).polar).toBeLessThan(Math.PI);
  });

  it("zooms out on positive wheel delta and respects limits", () => {
    expect(zoomOrbit(base, 100, 0.1, 1000).radius).toBeCloseTo(10 / 0.95);
    expect(zoomOrbit(base, -100, 0.1, 1000).radius).toBeCloseTo(10 * 0.95);
    expect(zoomOrbit(base, 1e6, 0.1, 50).radius).toBe(50);
  });

  it("pans in the view plane without changing the distance", () => {
    const panned = panOrbit(base, 100, 0, 500, Math.PI / 4);
    const moved = Math.hypot(panned.target[0] - 1, panned.target[1] - 2, panned.target[2] - 3);
    expect(moved).toBeCloseTo((2 * 10 * Math.tan(Math.PI / 8) * 100) / 500);
    expect(panned.target[1]).toBeCloseTo(2); // horizontal drag keeps height
  });

  it("frames a box so its bounding sphere fits the field of view", () => {
    const fov = (40 * Math.PI) / 180;
    const orbit = frameBox([-1, 0, -1], [1, 2, 1], fov);
    expect(orbit.target).toEqual([0, 1, 0]);
    expect(orbit.radius).toBeCloseTo(frameDistance(Math.sqrt(3), fov));
    expect(Math.sin(fov / 2) * orbit.radius).toBeGreaterThan(Math.sqrt(3));
  });

  it("picks grid cells near the model scale", () => {
    expect(gridCell(1)).toBeCloseTo(0.2);
    expect(gridCell(35)).toBeCloseTo(2);
    expect(gridCell(0.004)).toBeCloseTo(0.0002);
  });
});
