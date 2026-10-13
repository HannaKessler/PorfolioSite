---
title: 3D Model Viewer
description: Open your own glTF, OBJ, STL, FBX or PLY files and compare them side by side in three.js, Babylon.js and hand-written WebGPU and WebGL2 renderers. Nothing is uploaded.
pubDate: 2026-10-13
featured: true
listed: true
tags:
  - TypeScript
  - React
  - three.js
  - Babylon.js
  - WebGL
  - WebGPU
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/model-viewer
---

## Overview

The 3D Model Viewer opens models supplied by the visitor and draws each one four times, side by side: with three.js, with Babylon.js, and with two renderers written for this page without any rendering library, one on WebGPU and one on WebGL2. The two engines are the most widely used WebGL frameworks; the hand-written renderers show what the core of rendering takes when nothing is provided.

Everything happens in the browser. Files are read locally and never leave the visitor's machine, so the demo needs no server, storage or running costs and works on any static host. Four sample models are included and are only downloaded when chosen: a teapot (OBJ), a torus knot (STL), a vase with vertex colours (PLY) and a clump of grass with embedded textures (FBX), which exercises transparency, double-sided surfaces and texture filtering.

The viewer is a React component rendered as an island on an otherwise static Astro page, so the rest of the page ships no JavaScript.

## File loading

**Formats.** glTF and GLB (including Draco and Meshopt compressed meshes), OBJ with MTL materials, STL, FBX and PLY. Other formats are rejected with a clear message rather than half-supported.

**Multi-file models.** A model is often several files: a `.gltf` with `.bin` buffers and textures, or an OBJ with its `.mtl` and images. Visitors can drop or pick them all at once. A small module with no rendering dependencies decides which file is the model (preferring the format that carries the most scene information), which `.mtl` belongs to an OBJ (the one named by its `mtllib` line, then one with the same name, then the only one), and how each reference inside the model maps onto the supplied files, ignoring folders and letter case. Each engine plugs that same matching into its own loading mechanism: a loading manager that rewrites URLs to local `blob:` URLs for three.js, and Babylon's in-memory file store for Babylon.js. Referenced files that weren't supplied are listed under the viewer instead of failing silently.

## Import-setting fidelity

Model files carry settings that change how a model looks but that loaders don't always apply. The viewer reads and applies the ones that are visible and can be read reliably, in every pane where they're relevant:

- **FBX double-sided and hidden objects.** FBX stores per-object culling and visibility flags that neither engine's FBX loader honours. A small parser reads them directly from binary and ASCII FBX files; objects marked double-sided render both faces, and objects marked hidden are removed.
- **STL colour and transparency.** Binary STL headers can carry a colour with an alpha value. three.js reads the colour; the viewer adds the alpha, so a translucent STL renders translucent.
- **OBJ smoothing without normals.** An OBJ that turns smoothing on but stores no normals would otherwise render faceted. Smooth normals are rebuilt for those meshes, keeping edges sharper than 60 degrees crisp.
- **Texture edges: clamp versus repeat.** FBX and OBJ textures default to repeating. When a mesh's texture coordinates never leave the unit square, nothing actually tiles, and repeating only makes filtering at the edges blend in pixels from the opposite side of the image, which shows up as faint dotted lines along the edges of foliage cards. Those textures are clamped instead, unless the file offsets or scales them or another mesh tiles them.
- **Transparency and depth.** Alpha-blended, textured surfaces such as grass cards are usually a single mesh whose faces can't be sorted against each other. If they write depth, a fully transparent part of one card hides the blades behind it. Depth writes are turned off for those surfaces so overlapping cards blend correctly, without resorting to alpha testing and its hard, aliased edges.
- **Greyscale opacity maps.** FBX opacity maps are greyscale images. three.js reads them as alpha maps; Babylon.js expects alpha in the alpha channel, so the Babylon pane is told to read it from the colour channels.

## The three.js pane

**How it's built.** three.js through React Three Fiber, with orbit controls and an infinite ground grid from drei. Each format uses three.js's own loader; Draco decoding uses decoder files served from the site rather than a third-party CDN. Lighting is a hemisphere light plus a key and a fill directional light, with ACES filmic tone mapping. When a model loads it is centred on the grid with its base at ground level, and the camera is placed to fit its bounding sphere whatever its scale, from millimetre CAD parts to large scenes; grid spacing and clipping planes follow the model's size.

**What it handles.** All five formats, multi-file models, vertex colours, and the import settings above. It is also the source of the geometry and textures for the two hand-written renderers.

**Trade-offs and limits.** Parsing runs on the main thread, so a very large file can briefly pause the page; a Web Worker would avoid that at the cost of considerably more code. glTF files using KTX2 compressed textures aren't supported, because that needs an additional transcoder.

## The Babylon.js pane

**How it's built.** `@babylonjs/core`, `@babylonjs/loaders` and `@babylonjs/materials`, imported by deep ES module paths so only the parts in use are bundled, with each format's loader plugin fetched on demand. The scene mirrors the three.js setup as closely as the engines allow, so differences come from the engines rather than the staging: a right-handed coordinate system, the same background and tone mapping, an arc-rotate camera framed with the same maths, similar lights, and a ground grid from Babylon's `GridMaterial` scaled to the model.

**What it handles.** glTF/GLB, OBJ with MTL, STL and FBX through Babylon's own loaders, with the same multi-file matching and the relevant import-setting fixes.

**Trade-offs and limits.**
- Babylon.js has no loader for PLY meshes (its `.ply` support is for Gaussian splats), so for a PLY this pane shows an empty grid and says the format isn't compatible, rather than showing something converted by another engine.
- Babylon's STL loader ignores colours stored in the file, so coloured STLs look plain here.
- STL files are kept in their stored orientation, matching three.js, instead of Babylon's default axis swap.
- The pane redraws continuously, which is simpler than an on-demand loop but uses GPU time while idle.

## The hand-written renderers: WebGPU and WebGL2

**How they're built.** The custom panes don't parse files. They take the model three.js has loaded and copy it into plain arrays (positions, normals, texture coordinates, vertex colours and indices, baked into world space) plus each material's base colour, colour texture, opacity map, opacity, side and transparency. Everything after that is written from scratch for each API:

- buffer and texture upload, with colour textures stored as sRGB and opacity maps as linear data;
- mipmap generation: WebGL2 has a built-in call, WebGPU doesn't, so a small render pass downsamples each level;
- shaders in GLSL and WGSL, pipelines, blend and depth state, multisampled anti-aliasing and the draw loop;
- a procedural ground grid: one quad whose fragment shader draws the lines and fades them with distance;
- an orbit camera with drag to rotate, right-drag to pan and wheel to zoom, plus framing by bounding box, in a small matrix module of its own.

**What they handle.** Everything three.js can load, drawn with lighting matched to the three.js pane: the same hemisphere, key and fill light values, Lambert diffuse with a small specular highlight, ACES filmic tone mapping and sRGB output. Opaque parts are drawn first, then transparent parts sorted back to front with depth writes off. Double-sided materials disable culling and flip the normal on back faces so both sides are lit. Textures clamp or repeat exactly as the loader decided. If the browser has no WebGPU, that pane says so instead of falling back to WebGL.

**Trade-offs and limits.** What the engines provide and these renderers leave out is the clearest result of the comparison: shadows, image-based lighting and reflections, full physically based materials (metalness, roughness, normal, emissive and occlusion maps), skinning, morph targets and animation, instancing, frustum culling, compressed textures and the long tail of file-format quirks. Each is a substantial piece of work, which is why the custom panes reuse three.js's parsing. Transparent parts are sorted per mesh part rather than per triangle, the same limitation the engines have.

## Layout

The four panes form a 2 × 2 grid on desktop, library engines on top and hand-written renderers below, each labelled with its renderer. Pane height is derived from the viewport so the grid, the sample controls and the status line fit on one screen at common sizes from 1280 × 720 to 1920 × 1080, with a minimum height for small screens and a maximum for large ones. The grid's width is capped relative to that height so panes stay well proportioned on ultrawide monitors. On phones the panes stack in a single column. Every pane resizes its drawing buffer with its element and renders at the screen's pixel density (capped at 2× in the three.js and custom panes).

A failure in one renderer, whether a download that fails, a loader error or a lost GPU context, is caught at that pane's boundary and shown inside it; the other panes keep working.

## Performance and resource handling

- **Lazy loading.** Only the three.js viewer loads with the page (about 200 KB compressed, including three.js, React Three Fiber, drei and the loaders). Babylon.js (about 60 KB compressed for the core chunk, plus each format's loader when first used) and the custom renderers (about 4 KB compressed each, with the WebGPU and WebGL2 code in separate chunks) are fetched only once a model is opened.
- **Drawing on demand.** The three.js and custom panes draw only while the camera moves or a new model arrives, so an idle viewer uses no GPU time. The Babylon pane is the exception noted above.
- **Clean replacement.** When a model is replaced, every pane releases its geometry, materials, textures and GPU buffers, and the temporary `blob:` URLs are revoked, so opening many files in a row doesn't leak memory. If a newer file is opened while an older one is still loading, the older result is discarded.
- **Costs.** Drawing every model four times needs four GPU contexts and more memory than a single viewer would. For a comparison demo that's acceptable; a production viewer would pick one renderer. Everything is held in browser memory, so the practical size limit is set by the visitor's device.

## Testing

Logic that doesn't need a GPU is covered by 24 Vitest unit tests in four files:

- **File handling (10 tests):** choosing the main model file, matching `.mtl` files and references to supplied files, and detecting OBJ files that need smooth normals.
- **FBX flags (2 tests):** reading double-sided and hidden flags from synthetic binary and ASCII FBX files.
- **Texture coordinates (2 tests):** deciding when a mesh's UVs stay within the unit square.
- **Camera and matrix maths (10 tests):** projection for both depth conventions, view matrices, orbit rotation, zoom and pan, and framing.
