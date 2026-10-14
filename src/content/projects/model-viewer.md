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

## Summary

A browser-based 3D model viewer that draws the same file four times, side by side: with three.js, with Babylon.js, and with two renderers written from scratch, one on WebGPU and one on WebGL2. A live table underneath compares how each one performs. Files are read locally and never uploaded.

What it demonstrates:

- **Graphics programming without a library:** buffers, textures and mipmaps, GLSL and WGSL shaders, blending and depth state, camera and grid, on both WebGL2 and WebGPU.
- **File-format parsing:** my own parsers for binary and ASCII FBX, glTF/GLB, OBJ with MTL, STL and PLY, running in a Web Worker.
- **Engine integration:** three.js through React Three Fiber, and Babylon.js, set up so the two match as closely as the engines allow.
- **React and TypeScript:** a lazily loaded island on a static Astro page.
- **Performance measurement:** load time, first frame, CPU and GPU frame time (GPU timer queries), draw calls and code size, measured the same way in every pane.
- **Testing:** 74 unit tests covering the parsers, file matching and camera maths.

## What you can do with it

- Open glTF/GLB, OBJ + MTL, STL, FBX or PLY files, including multi-file models (a `.gltf` with its `.bin` and textures, an OBJ with its `.mtl` and images), or pick one of four samples.
- Orbit, pan and zoom each pane; every model is centred and framed automatically, from millimetre parts to large scenes.
- Compare the four renderers live, or press **Benchmark** to make all panes render continuously and orbit identically for a fair frame-time comparison.

## Architecture

- **Page:** a static Astro page; the viewer is a React island that hydrates on its own.
- **File matching:** a small dependency-free module picks the main model file and resolves references (textures, buffers, materials) to the supplied files, ignoring folders and letter case.
- **three.js pane:** React Three Fiber with three.js's loaders, fed through a loading manager that maps references to local `blob:` URLs.
- **Babylon.js pane:** Babylon's loaders reading from its in-memory file store; loaded on demand.
- **Custom panes:** one Web Worker parses the files into a plain scene description (meshes, materials, textures as `ImageBitmap`s). The WebGPU and WebGL2 backends each upload and draw that same scene.
- **Measurement:** a shared module collects timings and counters from every pane for the readouts and table.

## Engineering decisions and trade-offs

- **Parsing in a Web Worker.** The custom panes parse off the main thread, so a large file never freezes the page, and parsing happens once for both backends. The cost is a message boundary and plain data instead of shared objects.
- **Redrawing on demand.** The three.js and custom panes draw only when the camera moves or a model changes, so an idle viewer uses no GPU time. Babylon.js renders continuously; Benchmark mode equalises them.
- **Lazy loading.** Only the three.js pane ships with the page. Babylon.js and the custom renderers are downloaded when a model is first opened, and each Babylon format loader only when that format is used.
- **Confining failures to a pane.** Each renderer sits behind its own error boundary. A failed download, loader error or lost GPU context is shown in that pane while the others keep working.
- **Honouring file settings.** Loaders often ignore settings that change how a model looks. The viewer applies them consistently: FBX per-object double-sided and hidden flags (read by a small parser of its own, since neither engine's FBX loader applies them), STL header colour and transparency, and smooth normals for OBJs that request smoothing but store none.
- **Texture clamping.** FBX and OBJ textures repeat by default. When a mesh's UVs stay inside the unit square, nothing actually tiles, so textures are clamped to stop filtering from pulling in pixels from the opposite edge.
- **Transparency and depth.** Alpha-blended textured surfaces, such as grass cards, don't write depth, so overlapping cards blend instead of hiding each other, without falling back to the hard, aliased edges of alpha testing.

## Results

Measured in Microsoft Edge on a desktop PC with all four panes on screen, in Benchmark mode (redrawing continuously). Load includes downloading the pane's code the first time; the custom panes parse in a worker, the engines on the main thread. Code is the compressed JavaScript each pane downloads.

| Model | Pane | Load (ms) | Frame CPU (ms) | GPU (ms) | Code (KB) |
| --- | --- | ---: | ---: | ---: | ---: |
| Teapot (OBJ, 2.3k triangles) | three.js | 18 | 0.13 | 0.16 | 295 |
| | Babylon.js | 521 | 0.22 | 0.45 | 281 |
| | Custom WebGPU | 556 | 0.18 | 0.07 | 22 |
| | Custom WebGL2 | 555 | 0.08 | 0.30 | 21 |
| Frog (FBX, 28.7k triangles) | three.js | 204 | 0.23 | 0.08 | 295 |
| | Babylon.js | 955 | 0.26 | 0.06 | 281 |
| | Custom WebGPU | 588 | 0.17 | 0.05 | 22 |
| | Custom WebGL2 | 585 | 0.06 | 0.06 | 21 |

The three.js code figure includes the viewer interface, which loads with the page. The clearest contrast is code size: the hand-written renderers need under a tenth of the download because they implement only what the viewer uses. Frame times stay well under a millisecond at these sizes. All four panes share one GPU and main thread, so the numbers compare renderers on one machine rather than serve as absolute benchmarks.

## Testing

74 Vitest unit tests cover the logic that doesn't need a GPU:

- **Parsers:** OBJ/MTL, STL (ASCII and binary, with colours), PLY (ASCII and binary, both byte orders), glTF and GLB (accessors, node hierarchy, alpha modes, refusal of unsupported compression) and FBX (ASCII and binary, compressed arrays, transforms, materials and textures).
- **File handling:** choosing the main file, matching materials and references to supplied files, and reading FBX double-sided and hidden flags.
- **Geometry and camera:** UV range checks, normal generation, projection and view matrices, orbit, pan, zoom and framing.

Rendering is checked by loading sample and real-world models in a headless browser and comparing the panes.

## Limitations

- The custom renderers support static meshes only: no skinning, animation, texture transforms or second UV sets, and no Draco, Meshopt or KTX2 compression.
- Shading is a simple matched lighting model, not full PBR.
- Babylon.js has no PLY mesh loader, so that pane shows a note for PLY files; its STL loader ignores stored colours.
- GPU timings need timer-query support, which Safari and Firefox don't expose by default; those cells show "n/a".
- Four GPU contexts cost memory; a production viewer would use one renderer.
- Files are held in browser memory, so the size limit depends on the device.
