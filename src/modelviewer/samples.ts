// Small sample models bundled in public/projects/model-viewer/samples/.
// They are fetched only when chosen. Teapot, torus knot and vase are generated
// procedurally for this site and released under CC0 (the teapot with its own
// glazed-ceramic .mtl); the grass is an FBX with
// embedded textures supplied by the site owner.
export interface Sample {
  title: string;
  file: string;
  url: string;
  /** Sidecar files (materials, textures) fetched with the model and opened together. */
  extras?: string[];
}

const base = "/projects/model-viewer/samples/";

export const SAMPLES: Sample[] = [
  { title: "Teapot (OBJ)", file: "teapot.obj", url: `${base}teapot.obj`, extras: ["teapot.mtl"] },
  { title: "Torus knot (STL)", file: "torus-knot.stl", url: `${base}torus-knot.stl` },
  { title: "Vase (PLY, vertex colors)", file: "vase.ply", url: `${base}vase.ply` },
  { title: "Grass (FBX)", file: "grass.fbx", url: `${base}grass.fbx` },
];
