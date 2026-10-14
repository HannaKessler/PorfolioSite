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

**What it handles.** All five formats, multi-file models, vertex colours, and the import settings above.

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

**Own parsers, shared scene, two backends.** The custom panes are fully independent of three.js. Dropped files are parsed in a Web Worker by our own format readers into a plain scene (meshes with positions, normals, UVs, colours and indices; materials with base colour or texture, opacity or opacity map, side, transparency and optional alpha cutoff; node transforms baked to world space). Both panes upload that same scene. Parsing runs once per file set and is shared; array buffers and ImageBitmaps cross the worker boundary as transferables. Sidecar textures, `.bin` buffers and `.mtl` files are matched by case-insensitive base name, the same way the engine loaders resolve them.

**Formats.**

- **glTF / GLB:** JSON and binary chunks; accessors including optional sparse; node TRS / matrix hierarchy; PBR base colour and texture; `OPAQUE` / `MASK` / `BLEND` and double-sided; embedded and external images. Draco, Meshopt and KTX2 are refused with a clear in-pane message rather than silently ignored.
- **OBJ + MTL:** faces with negative indices, n-gon fan triangulation, smoothing groups (crease when no `vn`), `map_Kd` / `map_d`, `d` / `Tr`.
- **STL:** binary and ASCII, including Materialise Magics header colour with alpha and 15-bit per-face colours.
- **PLY:** ASCII and binary little- and big-endian, with vertex colours and polygon faces.
- **FBX (binary and ASCII):** geometry with negative polygon end markers and n-gon triangulation; `LayerElementNormal` / `UV` with `ByPolygonVertex` / `ByVertice` and `Direct` / `IndexToDirect`; the full Autodesk local transform (`Lcl` T/R/S, rotation order, pre/post rotation, pivots and offsets) plus geometric translation; Connections; materials (`DiffuseColor`, opacity via `TransparencyFactor` / `Opacity`); textures and Video content (embedded or external); Culling / Visibility flags; GlobalSettings up-axis (Z-up → Y-up, matching three.js). Binary 7.x includes 64-bit offsets (7500+) and zlib-compressed arrays (inflated with `DecompressionStream`). Skinning, animation, NURBS, texture transforms and UV sets beyond the first are not supported.

Missing normals are filled in (smooth across edges under an angle threshold, or flat). When UVs stay in the unit square, repeating textures are clamped so filtered samples don't wrap across the seam.

**How the backends are built.** Everything after the shared scene is written from scratch for each API:

- buffer and texture upload, with colour textures stored as sRGB and opacity maps as linear data;
- mipmap generation: WebGL2 has a built-in call, WebGPU doesn't, so a small render pass downsamples each level;
- shaders in GLSL and WGSL (including alpha-test discard for glTF `MASK`), pipelines, blend and depth state, 4× MSAA and the draw loop;
- a procedural ground grid: one quad whose fragment shader draws the lines and fades them with distance;
- an orbit camera with drag to rotate, right-drag to pan and wheel to zoom, plus framing by bounding box, in a small matrix module of its own.

**Shading.** Lighting is matched to the three.js pane: the same hemisphere, key and fill light values, Lambert diffuse with a small specular highlight, ACES filmic tone mapping and sRGB output. Opaque parts are drawn first, then transparent parts sorted back to front with depth writes off. Double-sided materials disable culling and flip the normal on back faces so both sides are lit. If the browser has no WebGPU, that pane says so instead of falling back to WebGL.

**Trade-offs and limits.** What the engines provide and these renderers leave out is the clearest result of the comparison: shadows, image-based lighting and reflections, full physically based materials (metalness, roughness, normal, emissive and occlusion maps), skinning, morph targets and animation, instancing, frustum culling and compressed textures. Transparent parts are sorted per mesh part rather than per triangle, the same limitation the engines have. On the file side, the FBX limits above and the glTF compression extensions are the main gaps versus the library panes.

## Measuring performance

Each pane shows a small readout in its corner, and a table under the grid compares all four, refreshed twice a second from counters the panes update as they draw. Every pane is measured the same way:

- **Load** runs from opening the file to the model being ready to draw in that pane. three.js and Babylon.js parse on the main thread; the custom panes share one parse in a Web Worker and add their own GPU upload. The first time a pane is used, its code download is included.
- **First frame** is the time from opening the file to the first frame drawn with the model.
- **CPU frame time** is the JavaScript time spent inside the pane's render call (scene traversal, sorting, state changes and command submission), averaged with a 95th percentile over the last 120 frames. It excludes the browser's own compositing.
- **GPU frame time** comes from timer queries: `EXT_disjoint_timer_query_webgl2` around the render call for the three WebGL panes, and `timestamp-query` around the main render pass for WebGPU. Results arrive a frame or two later and are dropped when the GPU reports a disjoint period. Browsers that expose neither (including Safari and Firefox by default) show "n/a".
- **Triangles** counts the model's geometry once per triangle, without the grid, so it is comparable across panes. **Tris drawn** and **draw calls** are what each renderer actually submitted in its last frame, including the ground grid and any extra passes. They differ by design: three.js draws double-sided transparent materials in two passes (back faces, then front faces) for correct blending, so on the grass sample it submits 2 grid + 2 × 8 grass = 18 triangles in 3 draw calls, where Babylon.js and the custom renderers submit 2 + 8 = 10 in 2.
- **GPU memory** is an estimate: vertex and index buffers plus RGBA textures with a full mip chain. Drivers add padding and render targets that aren't counted. The **JS heap** is shown when the browser exposes `performance.memory` (Chromium only).

**Benchmark mode.** Normally the three.js and custom panes draw only when something changes, and Babylon.js draws continuously, so their frame rates can't be compared. The Benchmark button makes every pane render continuously and turn the camera around its target by the same angle at the same rate, then clears the frame counters so the numbers describe only the benchmark. Nothing extra runs until it's pressed.

**Caveats.** All four panes share one GPU and one main thread, so they slow each other down; frame rates are capped by the display's refresh rate, so frame times are the more useful comparison. The first frames after a load include shader compilation and texture uploads, which is why idle averages can look high until the camera moves. The numbers are for comparing renderers on one machine, not absolute benchmarks.

## Layout

The four panes form a 2 × 2 grid on desktop, library engines on top and hand-written renderers below, each labelled with its renderer, with the performance table beneath. Pane height is derived from the viewport so the grid, the sample controls and the status line fit on one screen at common sizes from 1280 × 720 to 1920 × 1080, with a minimum height for small screens and a maximum for large ones. The grid's width is capped relative to that height so panes stay well proportioned on ultrawide monitors. On phones the panes stack in a single column. Every pane resizes its drawing buffer with its element and renders at the screen's pixel density (capped at 2× in the three.js and custom panes).

A failure in one renderer, whether a download that fails, a loader error or a lost GPU context, is caught at that pane's boundary and shown inside it; the other panes keep working.

## Performance and resource handling

- **Lazy loading.** Only the three.js viewer loads with the page (about 200 KB compressed, including three.js, React Three Fiber, drei and the loaders). Babylon.js (about 60 KB compressed for the core chunk, plus each format's loader when first used) and the custom renderers (parsers plus WebGPU / WebGL2 backends in separate chunks) are fetched only once a model is opened.
- **Drawing on demand.** The three.js and custom panes draw only while the camera moves or a new model arrives, so an idle viewer uses no GPU time. The Babylon pane is the exception noted above.
- **Clean replacement.** When a model is replaced, every pane releases its geometry, materials, textures and GPU buffers, and the temporary `blob:` URLs are revoked, so opening many files in a row doesn't leak memory. If a newer file is opened while an older one is still loading, the older result is discarded.
- **Costs.** Drawing every model four times needs four GPU contexts and more memory than a single viewer would. For a comparison demo that's acceptable; a production viewer would pick one renderer. Everything is held in browser memory, so the practical size limit is set by the visitor's device.

## Testing

Logic that doesn't need a GPU is covered by Vitest unit tests:

- **File handling (10 tests):** choosing the main model file, matching `.mtl` files and references to supplied files, and detecting OBJ files that need smooth normals.
- **FBX flags (2 tests):** reading double-sided and hidden flags from synthetic binary and ASCII FBX files.
- **Texture coordinates (2 tests):** deciding when a mesh's UVs stay within the unit square.
- **Camera and matrix maths (10 tests):** projection for both depth conventions, view matrices, orbit rotation, zoom and pan, and framing.
- **Custom parsers (50 tests):** OBJ/MTL (n-gons, relative indices, smoothing, maps, vertex colours); STL ASCII/binary with header and per-face colour; PLY ASCII and binary LE/BE with colours and UVs; glTF JSON with data URIs and external buffers, GLB, sparse accessors, node hierarchy, strided normalised attributes, strip/fan modes, MASK and Draco refusal; FBX ASCII and binary (including zlib arrays and 64-bit 7500+), transforms, materials, textures and GlobalSettings; matrix helpers, crease normals and the scene builder; the multi-file entry point.
