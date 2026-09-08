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

## Cloudflare Pages

| Setting | Value |
|---|---|
| Framework | Astro |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `22` (see `.nvmrc`) |
