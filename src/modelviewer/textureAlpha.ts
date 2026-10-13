import * as THREE from "three";

// Some OBJ/FBX exports load alpha-textured surfaces (foliage cards) as opaque
// materials. Opaque materials write depth across the whole polygon, including
// texels that are fully transparent, which hides the ground grid behind them.
// For those materials only, switch to standard three.js transparency:
// transparent = true, depthWrite = false. Nothing else is changed.

type Textured = THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };

/** Resolve once the texture's image is decoded (loaders return textures before their images load). */
function imageReady(texture: THREE.Texture, tries = 0): Promise<void> {
  const image = texture.image as unknown;
  if (!image) {
    if (tries > 100) return Promise.resolve();
    return new Promise((resolve) => setTimeout(() => resolve(imageReady(texture, tries + 1)), 50));
  }
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement && !image.complete) {
    return new Promise((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }
  return Promise.resolve();
}

/** True when the texture has an alpha channel containing at least one non-opaque pixel. */
export function textureHasAlpha(texture: THREE.Texture): boolean {
  const image = texture.image as { data?: ArrayLike<number>; width?: number; height?: number } | null;
  if (!image) return false;

  // Data textures (e.g. TGA): scan the alpha channel of RGBA data directly.
  if (image.data) {
    if (texture.format !== THREE.RGBAFormat) return false;
    for (let i = 3; i < image.data.length; i += 4) if (image.data[i]! < 255) return true;
    return false;
  }

  // Decoded images: draw at native size to a canvas and scan the alpha channel.
  try {
    const width = image.width ?? 0;
    const height = image.height ?? 0;
    if (!width || !height) return false;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image as unknown as CanvasImageSource, 0, 0);
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! < 255) return true;
  } catch {
    // Unreadable image: leave the material alone.
  }
  return false;
}

/** For non-glTF models: make opaque materials whose map/alphaMap has real alpha use standard transparency. */
export function enableTextureTransparency(object: THREE.Object3D, onChange: () => void): void {
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach((m) => materials.add(m));
    else if (material) materials.add(material);
  });

  for (const material of materials) {
    if (material.transparent) continue;
    const { map, alphaMap } = material as Textured;
    const textures = [map, alphaMap].filter((t): t is THREE.Texture => Boolean(t));
    if (textures.length === 0) continue;
    void Promise.all(textures.map((t) => imageReady(t))).then(() => {
      if (material.transparent || !textures.some(textureHasAlpha)) return;
      material.transparent = true;
      material.depthWrite = false;
      material.needsUpdate = true;
      onChange();
    });
  }
}
