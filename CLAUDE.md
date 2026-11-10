# Hanyo

Personal manga/manhwa/manhua library + offline reader, installed as a PWA on iPhone.
Owner does product; Claude does most development.

## Stack

- **Monorepo**: npm workspaces — `apps/api`, `apps/web`, `packages/types` (shared DTOs, type-only imports)
- **API** (`apps/api`): Node 22, TypeScript (ESM, strict), Hono, better-sqlite3, zod, web-push. Tests: vitest
- **Web** (`apps/web`): SvelteKit 2 SPA (adapter-static, `ssr = false`), Svelte 5 runes, Tailwind CSS v4, idb
- **Sources**: MangaDex API (native provider) + Suwayomi-Server (Docker, runs Mihon extensions: Weeb Central, Comix, Asura, Flame)
- **Deploy**: yoqze VPS — Caddy (`hanyo.yoqze.com`), PM2 (`hanyo-api`), Docker only for Suwayomi + FlareSolverr

## Layout

```
apps/api/src/
  providers/   mangadex.ts, suwayomi.ts, registry.ts — one interface for every source
  services/    library (series, merged chapters, progress), pages (page proxy + cache),
               updates (refresh, auto-link sources, push), image-cache, push
  app.ts       all HTTP routes under /api (cookie auth)
apps/web/src/
  routes/      / (library), /search, /series/[id], /read/[chapterId], /downloads, /settings, /login
  lib/reader/  StripView (vertical, windowed mounting), PagedView (RTL/LTR), settings
  lib/offline/ downloads (Cache Storage + IndexedDB queue), progress queue, cache names
  service-worker.ts  shell cache, network-first API, cache-only downloaded pages
deploy/        setup.sh (one-shot VPS), deploy.sh (CI), docker-compose.yml, hanyo.caddy, extensions.txt
```

## Principles

1. **Phone works offline** for library + downloaded chapters. Never make reading depend on the server.
2. **Read state is per chapter NUMBER per series**, not per source chapter, so switching sources never loses progress.
3. **Merged chapter list**: one entry per number; lower `priority` source wins (MangaDex 50, others 100).
4. **iOS memory**: the strip reader mounts only a window of `<img>`s; never render a whole chapter at once.
5. **Be a good citizen**: MangaDex rate limits + MangaDex@Home reports; Suwayomi only on localhost.
6. UI copy in Spanish; code, comments and commits in English.

## Commands

- `npm run dev` (API on :3101, uses `.env`) + `npm run dev:web` (Vite on :5173, proxies /api)
- `npm run typecheck` · `npm test` · `npm run build`
- Local Suwayomi: `docker compose -f deploy/docker-compose.yml up -d`

## Workflow

- Read `docs/status.md` and `docs/backlog.md` first; update them after meaningful work.
- Feature branches → PR to `main`. Push to `main` deploys (when `DEPLOY_ENABLED` repo variable is `true`).
- Don't add co-author lines to commits.
