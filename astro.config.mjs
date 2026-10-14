// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://example.com',
  // React is only used by the Film Graph explorer island.
  integrations: [react()],
  vite: {
    // Film Graph runs PGlite (Postgres in WASM) in a module worker.
    // Babylon.js is native ES modules imported by deep subpath and loaded lazily;
    // pre-bundling it made Vite re-optimize mid-session whenever a new subpath
    // was first seen, breaking the lazy import with '504 Outdated Optimize Dep'.
    optimizeDeps: {
      // Pre-bundled up front: first discovered when PBR mode loads, which would otherwise force a mid-session re-optimize.
      include: ['three/examples/jsm/environments/RoomEnvironment.js'],
      exclude: ['@electric-sql/pglite', '@babylonjs/core', '@babylonjs/loaders', '@babylonjs/materials'] },
    worker: { format: 'es' },
    server: {
      proxy: {
        '/v1': 'http://127.0.0.1:8787',
        '/health': 'http://127.0.0.1:8787',
      },
    },
  },
});
