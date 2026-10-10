// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://example.com',
  vite: {
    // Film Graph runs PGlite (Postgres in WASM) in a module worker.
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    worker: { format: 'es' },
    server: {
      proxy: {
        '/v1': 'http://127.0.0.1:8787',
        '/health': 'http://127.0.0.1:8787',
      },
    },
  },
});
