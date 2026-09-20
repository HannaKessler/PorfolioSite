# Portfolio site

Astro site for Hanna Kessler — games (itch.io), software, and optional on-site demos. Hosted on Cloudflare Pages.

## Local

```powershell
npm install
npm run dev
```

Open http://localhost:4321

## Add a project

1. Copy a file in `src/content/projects/`
2. Set `kind` to `game` or `software`
3. Fill in `itchUrl`, `githubUrl`, `liveUrl`, and/or `demoUrl`
4. Put screenshots in `public/images/projects/`

On-site playable builds go in `public/demos/<name>/` (engine web export). Then set `demoUrl: /demos/<name>/`.

Site-wide name, email, and profile links live in `src/site.ts`.

## Cloudflare

This is a static Astro site. Cloudflare Workers serves `dist/` as assets (see `wrangler.jsonc`). The Worker name must stay `hannakesslerportfolio` to match the connected GitHub build.

Live URL: `https://hannakesslerportfolio.hanna-kessler10-portfolio.workers.dev`

| Setting | Value |
|---|---|
| Framework | Astro |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` (see `.nvmrc`) |

| Variable | Example |
|---|---|
| `PUBLIC_SITE_URL` | `https://hannakesslerportfolio.hanna-kessler10-portfolio.workers.dev` |
| `PUBLIC_SECRET_NOTES_API` | `https://api.example.com/v1` |

Leave `PUBLIC_SECRET_NOTES_API` unset until the Secret notes API is on a public HTTPS URL. The demo will show an error until then; the rest of the site still works.

`/status` probes that same API (`/v1/status`, falling back to `/v1/config`) and shows reachability, the upload kill switch, and demo quota.

Local API proxy (`/v1` → `127.0.0.1:8787`) only applies to `npm run dev`.
