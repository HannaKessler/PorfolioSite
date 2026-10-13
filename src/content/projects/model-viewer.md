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
  - Babylon.js
  - WebGL
  - WebGPU
githubUrl: https://github.com/HannaKessler/PorfolioSite
demoUrl: /projects/model-viewer
---

## Overview

The 3D Model Viewer opens models that the visitor supplies, either by dragging them onto the stage or through a file picker, and renders them with WebGL. It reads glTF and GLB (including Draco and Meshopt compressed meshes), OBJ with MTL materials, STL, FBX and PLY. Everything happens in the browser: files are read locally and never leave the visitor's machine, so the demo has no server, no storage and no running costs, and it can be embedded on any static host. Three small sample models are included so there is something to look at straight away. They are only downloaded when one is chosen.

Each model is shown twice, side by side (stacked on a phone): once in three.js and once in Babylon.js, the two most widely used WebGL engines. The same file feeds both panes, each with its own loader, so the comparison shows how the engines' importers and renderers really differ on that file.

A second row shows the same model drawn by two renderers written for this page without any rendering library: one on WebGPU and one on WebGL2. Together the four panes show what the engines contribute and what it takes to do the core of it by hand.

## How it's built

The viewer is a React component rendered as an island on an otherwise static Astro page, so the rest of the page ships no JavaScript. Rendering uses three.js through React Three Fiber, with orbit controls and an infinite ground grid from drei.

Loading is kept separate from rendering. A small module with no three.js dependency decides which of the dropped files is the model, which `.mtl` file belongs to an OBJ (the one named by its `mtllib` line, then one with the same name, then the only one), and how references inside a model map onto the files supplied. Each file is turned into a temporary `blob:` URL, and a three.js loading manager rewrites every texture, buffer and material reference to the supplied file with the same name, ignoring folders and letter case. This is what lets a glTF with separate `.bin` and texture files, or an OBJ with its materials and images, load correctly from a single drop. Any referenced file that wasn't supplied is listed under the viewer instead of failing silently. That matching logic is covered by Vitest unit tests.

When a model loads, it is centred on the grid with its base at ground level, and the camera is placed to fit its bounding sphere whatever its scale, whether that's millimetres from a CAD export or hundreds of metres from a scene. Grid spacing and camera clipping planes follow the model's size. STL and PLY files contain bare geometry, so they get a neutral material, with per-vertex colors used when a PLY includes them.

## The Babylon.js pane

The Babylon.js side mirrors the three.js setup as closely as the engines allow, so differences come from the engines rather than the staging: a right-handed scene, the same background and ACES tone mapping, an arc-rotate camera framed with the same maths, similar hemisphere and directional lights, and a ground grid from Babylon's `GridMaterial` scaled to the model. Dropped textures, `.mtl` and `.bin` files are resolved through the same file-matching module used for three.js, plugged into Babylon's in-memory file store. A few file settings that one engine's loader honours and the other's doesn't are applied on the Babylon side as well: FBX double-sided and hidden flags, greyscale FBX opacity maps, and depth writes turned off on textured, blended surfaces such as foliage, which can't be sorted face by face.

Babylon.js loads glTF/GLB, OBJ with MTL, STL and FBX natively. It has no loader for PLY meshes (its `.ply` support is for Gaussian splats), so for a PLY the Babylon pane shows an empty grid and says that the format isn't compatible, rather than quietly showing something three.js converted.

## The hand-written renderers

The custom panes don't parse files themselves. They take the model three.js has already loaded and copy it into plain arrays (positions, normals, UVs, vertex colours and indices, baked into world space) plus each material's base colour, colour texture, opacity map, opacity, side and transparency. Everything after that is written from scratch for each API: buffer and texture upload, mipmap generation (WebGL2 has a built-in call; WebGPU doesn't, so a small render pass downsamples each level), the shaders in GLSL and WGSL, pipeline and blend state, and the draw loop.

The shading is deliberately simple but matched to the three.js pane: the same hemisphere, key and fill light values, Lambert diffuse with a small specular highlight, ACES filmic tone mapping and sRGB output. Colour textures are decoded as sRGB, opacity maps as linear data, and textures clamp or repeat exactly as the loader decided. Opaque parts are drawn first, then transparent ones sorted back to front with depth writes off, the same rule that fixed overlapping foliage in the three.js pane. Double-sided materials turn off culling and flip the normal on back faces so both sides are lit correctly. The ground grid is a single quad whose fragment shader draws the lines and fades them with distance. The orbit camera, framing and projection maths are a small module of their own, covered by unit tests, including the different depth ranges of WebGL and WebGPU.

Both panes draw only when something changes, release their GPU buffers and textures when a new model is opened, and are loaded only once a model is open (the WebGPU code isn't fetched by the WebGL2 pane and vice versa). If the browser has no WebGPU, that pane says so instead of falling back silently, and any failure stays inside its own pane.

What the engines provide that these renderers leave out is the clearest result of the comparison: shadows, image-based lighting and reflections, full physically based materials (metalness, roughness, normal, emissive and occlusion maps), skinning, morph targets and animation, instancing, frustum culling, compressed textures and the long tail of file-format quirks. Each of those is a substantial piece of work, which is why the custom panes reuse three.js's parsing rather than reimplementing it.

## Performance and resource handling

The canvas renders on demand: frames are drawn only while the camera moves or a new model arrives, so an idle viewer uses no GPU time. Pixel density is capped at 2× on high-DPI screens. When a model is replaced, its geometries, materials and textures are disposed and its `blob:` URLs are revoked, so opening many files in a row doesn't leak GPU or browser memory. If a newer file is opened while an older one is still loading, the older result is discarded. Babylon.js is never part of the initial page: it is fetched only when the first model is opened, using tree-shaken ES module imports and on-demand loader plugins so only the parts in use are downloaded. Its engine, scene and loaded assets are disposed when the viewer unmounts, and each new model replaces the previous asset container. Draco decoding uses the decoder files served from the site itself rather than a third-party CDN.

## Trade-offs

- Supported formats are limited to the ones three.js reads reliably. Formats such as USDZ, STEP or Blender files are rejected with a clear message rather than half-supported.
- Parsing runs on the main thread. For typical models it takes a fraction of a second, but a very large file can briefly pause the page. Moving parsing into a Web Worker would avoid that at the cost of considerably more code, which isn't justified for a viewer of this scope.
- Everything is held in browser memory, so the practical size limit is set by the visitor's device rather than the site.
- Rendering every model four times costs four GPU contexts and more memory. The Babylon pane also redraws continuously, which is simpler than an on-demand loop. For a comparison demo that's acceptable, but a production viewer would pick one engine. Transparent parts in the custom panes are sorted per mesh part rather than per triangle, the same limitation the engines have.
- The viewer is deliberately simple: viewing only, with no measuring, editing or scene inspection tools.
