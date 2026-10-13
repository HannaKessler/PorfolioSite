import * as THREE from "three";

// Material setup for alpha-textured models (foliage cards, decals, fences).
//
// Fully transparent texels must not write depth, otherwise they hide whatever
// is behind them (the ground grid, other leaves). Two cases:
//  - Cutout: texture alpha used as a mask. alphaTest discards transparent
//    texels, depthWrite stays on so cards still sort correctly, and
//    alphaToCoverage smooths the edges when MSAA is on.
//  - Blend: genuinely translucent surfaces (glTF BLEND, opacity < 1).
//    depthWrite off and drawn after opaque geometry; a tiny alphaTest still
//    drops fully transparent texels.

const CUTOUT_THRESHOLD = 0.5;
const BLEND_DISCARD = 0.01;

type TexturedMaterial = THREE.Material & {
  map?: THREE.Texture | null;
  alphaMap?: THREE.Texture | null;
  opacity: number;
};

function asTextured(material: THREE.Material): TexturedMaterial {
  return material as TexturedMaterial;
}

export function applyCutout(material: THREE.Material, antialias: boolean): void {
  material.transparent = false;
  material.alphaTest = CUTOUT_THRESHOLD;
  material.depthWrite = true;
  material.alphaToCoverage = antialias;
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
}

export function applyBlend(material: THREE.Material): void {
  material.transparent = true;
  material.depthWrite = false;
  material.alphaTest = Math.max(material.alphaTest, BLEND_DISCARD);
  material.needsUpdate = true;
}

/** Wait for a texture's image to be decoded (TextureLoader hands back the texture before the image loads). */
function imageReady(texture: THREE.Texture): Promise<unknown> {
  const image = texture.image as unknown;
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement && !image.complete) {
    return new Promise((resolve) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => resolve(null), { once: true });
    });
  }
  if (!image) {
    // Some loaders assign the image later; poll briefly.
    return new Promise((resolve) => {
      let tries = 0;
      const timer = setInterval(() => {
        if (texture.image || ++tries > 100) {
          clearInterval(timer);
          resolve(imageReady(texture));
        }
      }, 50);
    });
  }
  return Promise.resolve(image);
}

/** True when any sampled texel of the texture is noticeably transparent. */
export function textureHasAlpha(texture: THREE.Texture): boolean {
  const image = texture.image as
    | { data?: ArrayLike<number>; width: number; height: number }
    | CanvasImageSource
    | null
    | undefined;
  if (!image) return false;

  // DataTexture (e.g. TGA): read the alpha channel directly.
  const data = (image as { data?: ArrayLike<number> }).data;
  if (data && texture.format === THREE.RGBAFormat) {
    const step = Math.max(4, Math.floor(data.length / 4 / 65536) * 4);
    for (let i = 3; i < data.length; i += step) if (data[i]! < 250) return true;
    return false;
  }

  // Decoded image: draw a downscaled copy and scan its alpha.
  try {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image as CanvasImageSource, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 250) return true;
  } catch {
    // Unreadable image: treat as opaque.
  }
  return false;
}

function materialsOf(object: THREE.Object3D): THREE.Material[] {
  const set = new Set<THREE.Material>();
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach((m) => set.add(m));
    else if (material) set.add(material);
  });
  return [...set];
}

/**
 * Configure alpha handling for every material in a loaded model.
 * `fromGltf`: glTF states its alphaMode explicitly (GLTFLoader maps MASK to
 * alphaTest and BLEND to transparent), so only fix up those. Other formats
 * don't, so texture alpha is detected by inspecting the images once decoded.
 * `onChange` is called after asynchronous changes so the canvas can redraw.
 */
export function setupAlpha(
  object: THREE.Object3D,
  options: { fromGltf: boolean; antialias: boolean; onChange?: () => void },
): void {
  for (const material of materialsOf(object)) {
    const textured = asTextured(material);

    if (options.fromGltf) {
      if (material.alphaTest > 0) applyCutout(material, options.antialias); // MASK
      else if (material.transparent) applyBlend(material); // BLEND
      continue;
    }

    if (textured.alphaMap) {
      applyCutout(material, options.antialias);
      continue;
    }
    if (textured.opacity < 1) {
      applyBlend(material);
      continue;
    }
    // FBX/OBJ loaders sometimes flag textured materials transparent without
    // real alpha; decide from the texture itself.
    if (textured.map) {
      const map = textured.map;
      void imageReady(map).then(() => {
        if (textureHasAlpha(map)) applyCutout(material, options.antialias);
        else if (material.transparent && textured.opacity >= 1) {
          material.transparent = false;
          material.depthWrite = true;
          material.needsUpdate = true;
        }
        options.onChange?.();
      });
    } else if (material.transparent) {
      applyBlend(material);
    }
  }
}
