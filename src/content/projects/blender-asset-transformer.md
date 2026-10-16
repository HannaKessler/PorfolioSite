---
title: Blender Asset Transformer
description: A Blender extension that brings assets from a Unity Asset Store library into Blender for rework, then exports them to a Unity 6 project with textures, materials, animation clip settings and attribution.
pubDate: 2026-10-16
featured: true
listed: true
status: Work in progress · Stage 1
tags:
  - Blender
  - Python
  - bpy
  - Blender Extension
  - Unity 6
  - URP
  - FBX
  - Asset Pipeline
  - Tools Programming
  - Game Dev
  - Animation
  - Open Source (GPL-3.0)
  - WIP
githubUrl: https://github.com/HannaKessler/BlenderAssetTransformer
---

<div class="wip-callout">
  <span class="wip-badge">Work in progress · Stage 1</span>
  <a class="button" href="https://github.com/HannaKessler/BlenderAssetTransformer" rel="noreferrer">View the code on GitHub</a>
</div>

## Summary

An asset pipeline, still in development, for reworking and eventually kitbashing Unity Asset Store assets in Blender. It is a Blender 5.1+ extension that takes assets from a Unity library project into Blender and exports them to a Unity 6 project with their textures, materials, animation clip settings and attribution.

The goal is a toolkit for combining assets from different packs into a consistent look: retargeting animations onto new meshes, matching materials across packs, and re-unwrapping UVs to fit a target texture layout. None of that is built yet. The project is in **Stage 1**: making the end-to-end pipeline (Unity library to Blender import, rework, export back to Unity 6) reliable first.

What it demonstrates:

- **Tools programming in Blender:** a full extension in Python using bpy, with 13 operators, a sidebar panel, an Outliner context menu, add-on preferences and drag-and-drop import.
- **Pipeline engineering across two engines:** moving meshes, materials, textures and animation from Unity's asset format into Blender and back, including the settings FBX cannot carry.
- **Working with file formats directly:** reading and writing Unity `.meta` and `.mat` files as text in Unity's exact layout, without a YAML library.
- **Careful data handling:** re-exports keep hand edits and stable GUIDs, licences are never guessed, and anything unexpected stops the export with a clear error.
- **Release tooling:** linting and formatting with ruff, type hints from fake-bpy-module, and GitHub Actions for lint and release.

## What it does

The tool lives in an **Asset Transformer** panel in the 3D Viewport sidebar. The workflow:

1. **Set up:** choose the Unity library project and the Unity editors folder in the add-on preferences.
2. **Browse:** scan the library, then browse by pack, type and file, with filename search. **Open in Unity** opens the library project in the editor version it needs.
3. **Import:** bring in a single mesh, a single material, or every mesh in a pack at once; drag-and-drop also works. Imports land in a *Pack > Meshes* collection, with textures wired into a Principled BSDF.
4. **Rework:** edit the asset in Blender. **Join (Keep Licenses)** merges meshes and keeps their licence records.
5. **Export:** add a target Unity project, stage collections from the sidebar or the Outliner's right-click menu, then run **Export Staged**. Each staged collection becomes its own folder in the target project.

## Technical architecture

- **Platform:** Blender 5.1+ extension (manifest schema 1.0.0), written in Python with bpy, bpy_extras, mathutils and the standard library only. There are no third-party runtime dependencies and no external services: it works with local files and launches the local Unity editor.
- **Modules** (about 3,000 lines across seven):

| Module | Responsibility |
| --- | --- |
| `__init__` | Registration and add-on preferences |
| `ui` | Sidebar panel and UI lists |
| `operators` | The 13 Blender operators |
| `io` | Import and export |
| `unity` | Unity project checks, editor launch, reading and writing `.mat` and `.meta` files |
| `library` | Library scanning and indexing |
| `licensing` | Licence detection and attribution |

- **Operators:** open in Unity, scan library, add target, import mesh, import all (with cancel), import material, stage collection, stage file, unstage collection, clear staged, export staged, and join. A FileHandler provides drag-and-drop import.
- **Formats read:** FBX, OBJ and `.blend` meshes; Unity `.mat`, `.meta` and `.anim` files; PNG, JPG, TGA, PSD, TIF and EXR textures.
- **Formats written to Unity:** FBX files (with PSD leaf masks converted to PNG), an `ATTRIBUTION.md` licence file for each exported asset, and a `materials.json` with the source material values. Work in progress adds the FBX `.meta` (clip settings and material remaps), texture `.meta` files and URP Lit `.mat` files.
- **Tooling:** ruff, fake-bpy-module and GitHub Actions for lint and release. Licensed GPL-3.0-or-later; version 0.1.0, not yet released.

## Key technical decisions and trade-offs

- **No Unity-side scripts.** Everything happens in Blender. Writing Unity `.meta` and `.mat` files is a narrow, deliberate exception, because FBX cannot carry Unity's loop settings or material bindings. The trade-off is owning the exact text format of files Unity normally manages.
- **Re-export preserves hand edits.** Only the fields the tool owns are updated and GUIDs are kept, so prefab and scene references survive a re-export. An unrecognised file layout stops the export with an error rather than risking a bad rewrite.
- **No guessing.** There is no automatic content categorisation and no guessed licences. Unknown licences are marked "License unknown" and every unresolved item is reported. This is slower to use than a tool that guesses, but it never produces wrong attribution silently.
- **Read-only source library.** Assets come from Asset Store packs imported through Unity and are never modified; the target is Unity 6 LTS.
- **Standard library only.** No third-party packages keeps installation simple and the extension self-contained, at the cost of hand-writing the Unity file handling instead of using a YAML library.
- **Pipeline before features.** Stage 1 makes the round-trip from Unity to Blender and back reliable before any feature that changes assets is built. Retargeting, material matching and re-unwrapping all depend on assets arriving intact, with their clips, materials and references preserved, so any loss in the round-trip would undermine them.
- **Blender conventions:** ImportHelper with a FileHandler for import, a single classes tuple for registration, and warnings reported to the user through Blender's own reporting.

## Challenges so far

Items marked *in progress* are implemented and checked by hand but not yet on GitHub.

**FBX can't carry Unity loop and clip settings** *(in progress)*
- **Problem:** Unity keeps Loop Time, wrap mode and clip frame ranges in the model's `.meta` file, not in the FBX, so every exported clip arrived in Unity as a one-shot.
- **Why it was hard:** FBX has no field for these settings, and Blender models looping differently, with cyclic playback and Cycles modifiers.
- **Solution:** on import, the clip settings are read from the source `.meta`; each action gets its frame range and cyclic flag, and Cycles modifiers (mirrored for ping-pong) are added to every F-curve in Blender 5's layered actions. On export, the clip entries are written into the target `.meta`, with take names read back from the written FBX so each entry matches its action exactly. A missing or malformed source `.meta` stops the import with an error.

**Duplicate take names and re-import collisions** *(in progress)*
- **Problem:** Blender's FBX exporter prefixes every take with the object name, so actions already starting with that name came out doubled. Separately, re-importing into a scene produced ".001" copies that silently failed to match their Unity clips.
- **Solution:** action names are shortened during export and restored afterwards, even if the export fails; a shortened name that would clash stops the export. Clip matching ignores ".001" suffixes, and a re-import replaces the old actions everywhere they are used before taking over their names. An import where no action matches any clip stops with an error.

**Rewriting `.meta` and `.mat` without losing hand edits or breaking GUIDs** *(in progress)*
- **Problem:** Unity owns these files. A new GUID on each export breaks prefab and scene references, and a full rewrite throws away settings changed in the Unity editor.
- **Why it was hard:** with no YAML library, the files have to be edited as text in Unity's exact format.
- **Solution:** new files are written minimally with a fresh GUID. Existing files keep their GUID and every unrelated line; only the clip fields the tool owns are replaced or appended, stale clips from renamed or deleted actions are removed, and takes split by hand in Unity are left alone. Existing materials keep their edits, with only broken texture references restored. Clip names that would break Unity's YAML parser are quoted, texture copies get their own GUIDs so shared textures don't collide, and an unexpected layout stops the export. Re-exports were checked to keep GUIDs unchanged and prefab references resolving.

**One take holding several clips** *(in progress)*
- **Problem:** some packs define several Unity clips as frame ranges inside one FBX take. Import gave the action only the last clip's range, and export would have lost the clip names.
- **Solution:** import creates one Blender action per clip, each containing only that clip's keyframes, starting at frame 1 with its own loop setting. Export then writes one take per clip, so clip names in Unity match the source.

**Scene unit scale** *(in progress)*
- **Problem:** in a scene with a Unit Scale of 0.01, assets arrived 100 times too small in Unity.
- **Why it was hard:** correcting scale on both import and export doubled the size, because Blender's exporter already writes Blender units as meters.
- **Solution:** only import is scaled (by 1 / Unit Scale, for FBX, OBJ and `.blend`), the correction is reported whenever the Unit Scale isn't 1, and the exported model's root is set to scale 1 in Unity.
- **Open:** child objects keep the source FBX's 0.01 scale, because baking it into the meshes would also rescale the animations.

**Rig import for a third-party character** *(in progress)*
- **Problem:** Blender's FBX importer brought one third-party rig in without an armature, so its clips couldn't attach to the character.
- **Solution:** import was changed so the rig comes in as an armature; its clips attach to the matching character and arrive in Unity with the right loop settings.

**PSD leaf masks and foliage materials**
- **Problem:** foliage arrived white in Unity.
- **Why it was hard:** Blender's preview node group sat between the texture and the shader, hiding the texture link from the FBX exporter, and the PSD leaf masks loaded without pixel data in a way that broke the usual pixel access in Blender 5.1.
- **Solution:** image pixels are loaded from disk and read in bulk, and the PSD masks are converted to PNG with alpha. The foliage preview stays Blender-only and is never baked into textures. An attempt to fake cutout with URP's transparent mode rendered leaf cards as glassy planes and was reverted.

**Material round-trip and URP shader compatibility** *(in progress)*
- **Problem:** Unity rebuilds materials from the FBX as plain Lit, losing the metallic map, smoothness source, alpha cutout and double-sided setting.
- **Why it was hard:** source packs use Built-in Standard, Amplify, HDRP-style and toon shaders, and many don't compile in URP.
- **Solution:** export writes a `.mat` for each material and remaps it through the model's `.meta`. Shaders that already work in URP are shipped with their original GUIDs; everything else is converted to URP Lit, with translated values listed in the export message. Textures referenced by a source material but not wired up in Blender are copied from the library, and materials with no source `.mat` get a Lit material built from their Blender values.
- **Still being tested:** support for material variants that inherit from a library material.

**Per-asset export isolation** *(in progress, being re-tested)*
- **Problem:** Blender's FBX exporter writes every action that can play on an object, so one asset's animations leaked into another asset's FBX.
- **Approach:** export is limited to each asset's own actions. This is still being re-tested against a case where assets share an action.

**Licence attribution**
- A licensing module looks for licence information in the source packs and writes an `ATTRIBUTION.md` into each export. Licences are never guessed: unknown ones are marked "License unknown", and Join (Keep Licenses) merges licence records when meshes are combined.

**Matching the Unity editor version**
- **Open in Unity** opens each library project in the editor version that project needs, found in the configured Unity editors folder.

## Status and roadmap

- **On GitHub now:** library browser and search, Open in Unity, single and batch import with Principled BSDF wiring, foliage material preview, collection-based export staging, and FBX export with textures and attribution.
- **In progress (Stage 1, implemented but not yet published):** Unity animation loop and frame-range settings carried both ways, one action per clip, unit-scale correction, URP Lit material generation and remapping with stable GUIDs, shipping URP-compatible pack shaders with the export, rig import fixes, and per-asset export isolation.
- **Planned, after Stage 1 (not built):**
  - **Animation retargeting:** take animations from one asset and apply them to a new mesh.
  - **Cross-pack material matching:** make an asset fit another pack's style, for example swapping a tree's trunk material to match trees from a different pack. When the packs use different texture designs (tiling, repeating textures versus fully hand-painted unique textures), the material is reworked rather than simply swapped.
  - **UV detection and re-unwrapping:** detect a mesh's existing UV layout and re-unwrap it to fit the target texture layout (tiling, or an atlas or hand-painted texture). This supports material matching across packs.
  - **Look Transfer (Phase 2):** bake a source asset's look onto a target mesh's UVs, with a preview and saved presets. This builds on material matching and re-unwrapping: once a mesh has UVs that fit the target layout, the source look can be baked onto it.

## Testing

Testing is manual for now: changes are checked by importing and exporting real library assets and inspecting the results in Blender and Unity. There are no automated tests yet, and no measured results are published here.

## Limitations

- Version 0.1.0 and unreleased; much of the Stage 1 work above is not yet on GitHub.
- No retargeting, material-matching, re-unwrapping or look-transfer features yet; these are planned.
- Child objects can keep the source FBX's 0.01 scale after export.
- Shaders that don't compile in URP are converted to URP Lit, so some original shading is approximated.
- Requires Blender 5.1 or later and targets Unity 6 LTS with URP.
- No screenshots are shown, because the assets used in testing are third-party Asset Store content that isn't licensed for reuse.
