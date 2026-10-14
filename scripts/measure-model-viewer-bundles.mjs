// Measures the compressed JavaScript each model-viewer pane downloads, from the
// production build in dist/. Run after `npm run build`; writes the numbers the
// comparison table shows (src/modelviewer/bundleSizes.json).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const dir = "dist/_astro/";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
const find = (prefix) => {
  const hit = files.find((f) => f.startsWith(prefix));
  if (!hit) throw new Error(`No chunk starting with ${prefix}`);
  return hit;
};
const staticImports = (file) =>
  [...readFileSync(dir + file, "utf8").matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
const closure = (...roots) => {
  const seen = new Set();
  const visit = (f) => {
    if (seen.has(f) || !files.includes(f)) return;
    seen.add(f);
    staticImports(f).forEach(visit);
  };
  roots.forEach(visit);
  return seen;
};
const kb = (set, minus = new Set()) =>
  Math.round([...set].filter((f) => !minus.has(f)).reduce((sum, f) => sum + gzipSync(readFileSync(dir + f)).length, 0) / 1024);

const page = closure(find("client."));
const viewer = closure(find("Viewer."));
const loaded = new Set([...page, ...viewer]);
const custom = (backend) => closure(find("CustomPane."), find(`${backend}.`), find("parser.worker"));
const sizes = {
  three: kb(viewer, page),
  babylon: kb(closure(find("BabylonPane.")), loaded),
  webgpu: kb(custom("webgpu"), loaded),
  webgl2: kb(custom("webgl2"), loaded),
};
writeFileSync("src/modelviewer/bundleSizes.json", JSON.stringify(sizes, null, 2) + "\n");
console.log(sizes);
