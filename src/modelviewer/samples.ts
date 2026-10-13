// Small sample models bundled in public/projects/model-viewer/samples/.
// They are generated procedurally for this site and released under CC0.
export interface Sample {
  title: string;
  file: string;
  url: string;
}

const base = "/projects/model-viewer/samples/";

export const SAMPLES: Sample[] = [
  { title: "Teapot (OBJ)", file: "teapot.obj", url: `${base}teapot.obj` },
  { title: "Torus knot (STL)", file: "torus-knot.stl", url: `${base}torus-knot.stl` },
  { title: "Vase (PLY, vertex colors)", file: "vase.ply", url: `${base}vase.ply` },
];
