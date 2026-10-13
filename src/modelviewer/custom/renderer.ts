// Shared contract and constants for the two hand-written renderers.
import type { CustomScene } from "./customScene";
import type { Mat4, Vec3 } from "../mat4";

export interface FrameParams {
  view: Mat4;
  eye: Vec3;
  fovY: number;
  near: number;
  far: number;
  /** Grid cell size and fade distance, scaled to the model. */
  gridCell: number;
  gridFade: number;
  width: number;
  height: number;
}

export interface CustomRenderer {
  /** Upload a scene, releasing whatever was uploaded before. Pass null to clear. */
  setScene(scene: CustomScene | null): void;
  render(frame: FrameParams): void;
  dispose(): void;
}

/** Background, matching the three.js and Babylon.js panes (sRGB, not tone mapped). */
export const CLEAR_SRGB = [0xf6 / 255, 0xf5 / 255, 0xf3 / 255] as const;

/**
 * Lighting shared by both shaders, set to the three.js pane's values:
 * a hemisphere light plus a key and a fill directional light, Lambert diffuse
 * with a small Blinn-Phong highlight, ACES filmic tone mapping, sRGB output.
 */
export const LIGHTING = {
  skyColor: [1, 1, 1],
  groundColor: [0.2623, 0.2542, 0.2307], // 0x8d8a85 in linear
  hemiIntensity: 1.6,
  key: { direction: [3, 5, 4], intensity: 2.2 },
  fill: { direction: [-4, 2, -3], intensity: 0.6 },
} as const;
