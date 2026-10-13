---
title: 3D Model Viewer
description: Open your own glTF, OBJ, STL, FBX or PLY files and inspect them in the browser. Nothing is uploaded.
pubDate: 2026-10-13
featured: true
listed: true
tags:
  - TypeScript
  - React
  - three.js
  - WebGL
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/model-viewer
---

## Overview

The 3D Model Viewer opens models that the visitor supplies, either by dragging them onto the stage or through a file picker, and renders them with WebGL. It reads glTF and GLB (including Draco and Meshopt compressed meshes), OBJ with MTL materials, STL, FBX and PLY. Everything happens in the browser: files are read locally and never leave the visitor's machine, so the demo has no server, no storage and no running costs, and it can be embedded on any static host. Three small sample models are included so there is something to look at straight away. They are only downloaded when one is chosen.

## How it's built

The viewer is a React component rendered as an island on an otherwise static Astro page, so the rest of the page ships no JavaScript. Rendering uses three.js through React Three Fiber, with orbit controls and an infinite ground grid from drei.

Loading is kept separate from rendering. A small module with no three.js dependency decides which of the dropped files is the model, which `.mtl` file belongs to an OBJ (the one named by its `mtllib` line, then one with the same name, then the only one), and how references inside a model map onto the files supplied. Each file is turned into a temporary `blob:` URL, and a three.js loading manager rewrites every texture, buffer and material reference to the supplied file with the same name, ignoring folders and letter case. This is what lets a glTF with separate `.bin` and texture files, or an OBJ with its materials and images, load correctly from a single drop. Any referenced file that wasn't supplied is listed under the viewer instead of failing silently. That matching logic is covered by Vitest unit tests.

When a model loads, it is centred on the grid with its base at ground level, and the camera is placed to fit its bounding sphere whatever its scale, whether that's millimetres from a CAD export or hundreds of metres from a scene. Grid spacing and camera clipping planes follow the model's size. STL and PLY files contain bare geometry, so they get a neutral material, with per-vertex colors used when a PLY includes them.

## Performance and resource handling

The canvas renders on demand: frames are drawn only while the camera moves or a new model arrives, so an idle viewer uses no GPU time. Pixel density is capped at 2× on high-DPI screens. When a model is replaced, its geometries, materials and textures are disposed and its `blob:` URLs are revoked, so opening many files in a row doesn't leak GPU or browser memory. If a newer file is opened while an older one is still loading, the older result is discarded. Draco decoding uses the decoder files served from the site itself rather than a third-party CDN.

## Trade-offs

- Supported formats are limited to the ones three.js reads reliably. Formats such as USDZ, STEP or Blender files are rejected with a clear message rather than half-supported.
- Parsing runs on the main thread. For typical models it takes a fraction of a second, but a very large file can briefly pause the page. Moving parsing into a Web Worker would avoid that at the cost of considerably more code, which isn't justified for a viewer of this scope.
- Everything is held in browser memory, so the practical size limit is set by the visitor's device rather than the site.
- The viewer is deliberately simple: viewing only, with no measuring, editing or scene inspection tools.
