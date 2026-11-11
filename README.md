# Hanyo

A personal, self-hosted library and offline reader for **manhwa, manga and manhua**, installed on the
iPhone as a PWA.

Search many sources at once, keep your series in one library, get notified when new chapters come
out, and download chapters to read with no connection. Your progress is kept per chapter number, so
switching sources never loses your place.

<p>
  <img src="docs/screenshots/readme/library.jpg" width="160" alt="Library" />
  <img src="docs/screenshots/readme/updates.jpg" width="160" alt="New chapters" />
  <img src="docs/screenshots/readme/explore.jpg" width="160" alt="Explore" />
  <img src="docs/screenshots/readme/series.jpg" width="160" alt="Series page" />
  <img src="docs/screenshots/readme/reader.jpg" width="160" alt="Reader" />
</p>

> The interface is in Spanish (the owner's language). Code, comments, commits and docs are in English.

## Features

**Library**
- Reading lists: *Leyendo*, *Pendiente*, *En pausa*, *Terminada*, with filters and sorting.
- One series, many sources: chapters are merged by number, the preferred source wins and the rest
  fill the gaps. Sources are linked automatically, including when new sources are installed.
- English or Spanish per series, switchable without losing progress.
- New-chapter checks every few hours, with push notifications (per series, can be turned off).

**Discover**
- **Novedades**: the latest chapters of the series you follow, grouped by day, plus a reading
  **history** to pick up where you left off.
- **Explore**: AniList trends by origin (manhwa / manga / manhua), genre and order (trending,
  most popular, best rated), and each source's own popular and latest lists.
- **Search** across every source at once. Results are merged by AniList names, so the same series
  under different titles shows up once.
- "If you like this…" recommendations on every series page. Titles from AniList open straight into
  the matching series.

**Reading**
- Vertical strip reader for webtoons and a paged reader (right-to-left or left-to-right) for
  manga, with pinch and double-tap zoom.
- Resumes at the exact spot, even inside very tall strip pages.
- Chapter list, brightness, keep-awake and page counter inside the reader.

**Offline**
- Download a chapter, the next ones, all unread or a whole series. Pages are re-encoded on the
  server (WebP/mozjpeg q90, about 80% smaller with no visible loss).
- Optional automatic download of the next unread chapters whenever the app is opened.
- The library, downloaded chapters and reading progress all work in airplane mode. Progress made
  offline syncs later.

**Server care**
- Daily source health check that pushes a notification when a source breaks or comes back.
- Light, dark and system themes; server stats in settings.

## How it works

```
iPhone (PWA)
 ├─ SvelteKit SPA + service worker ── Cache Storage (app, API JSON, covers, downloaded pages)
 │                                    IndexedDB (downloads, download queue, offline progress)
 └─ HTTPS ─► Caddy (VPS)
              ├─ /       static PWA
              └─ /api/*  hanyo-api (Node, Hono, SQLite, PM2)
                           ├─ page proxy + re-encoding + size-capped disk cache
                           ├─ MangaDex provider ───► api.mangadex.org, MangaDex@Home
                           ├─ AniList ─────────────► titles, trends, recommendations
                           └─ Suwayomi provider ───► Suwayomi-Server (Docker, localhost only)
                                                      ├─ Mihon extensions (Keiyoushi)
                                                      ├─ FlareSolverr (Cloudflare challenges)
                                                      └─ optional Cloudflare WARP egress
```

- **Providers** share one interface. MangaDex is native; every other site is a Mihon extension run by
  [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server), which is never exposed publicly.
- **The phone only talks to hanyo-api.** Page URLs are stable, same-origin and cached, so a downloaded
  chapter is served by the service worker exactly as if it were online.
- **AniList** supplies every known name of a series. It is used to merge search results, link
  sources and open trending titles. If AniList is unavailable, everything still works without it.

More detail: [architecture](docs/architecture.md) · [decisions (ADRs)](docs/decisions.md).

## Tech stack

| Part | Stack |
| --- | --- |
| API (`apps/api`) | Node 22, TypeScript (ESM, strict), Hono, better-sqlite3, zod, sharp, web-push, vitest |
| Web (`apps/web`) | SvelteKit 2 (static SPA), Svelte 5 runes, Tailwind CSS v4, idb, Playwright |
| Shared types | `packages/types` (type-only DTOs) |
| Server | Ubuntu VPS, Caddy, PM2, Docker (Suwayomi, FlareSolverr, optional WARP) |
| CI | GitHub Actions: typecheck, unit tests, build, end-to-end tests; optional deploy on `main` |

## Repository layout

```
apps/api/src/
  providers/   mangadex, suwayomi, demo (offline test source), registry
  services/    library, pages, updates, anilist, health, image-cache, push, compress
  app.ts       HTTP routes under /api (cookie auth)
apps/web/src/
  routes/      library, updates, explore, search, series, reader, downloads, settings, login
  lib/         reader views, offline downloads, components, API client
  e2e/         Playwright tests (apps/web/e2e)
deploy/        VPS setup and deploy scripts, docker-compose (+ WARP override), Caddy site, extensions list
docs/          architecture, decisions, status, backlog, deploy runbook, screenshots
```

## Getting started

Requirements: Node 22 and npm. Docker is only needed to try Suwayomi sources locally.

```bash
npm install
cp .env.example .env
npm run dev       # API on http://localhost:3101 (dev password: "hanyo")
npm run dev:web   # PWA on http://localhost:5173 (proxies /api)
```

MangaDex works out of the box. To add the other sources locally:

```bash
docker compose -f deploy/docker-compose.yml up -d
python3 deploy/bootstrap-extensions.py   # installs the extensions in deploy/extensions.txt
```

### Configuration

All settings are environment variables (see [`.env.example`](.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `HANYO_PASSWORD` | `hanyo` in dev, required in prod | Single-user login |
| `SESSION_SECRET` | dev value, required in prod | Signs the session cookie and image URLs |
| `DATA_DIR` | `./data` | SQLite database and image cache |
| `API_PORT` | `3101` | API port (bound to 127.0.0.1) |
| `IMAGE_QUALITY` | `90` | Re-encoding quality for pages; `0` keeps originals |
| `IMAGE_CACHE_MAX_MB` | `8000` | Disk budget for cached pages and covers |
| `SUWAYOMI_URL` | `http://127.0.0.1:4567` | Local Suwayomi-Server |
| `SUWAYOMI_LANGS` | `en,es` | Source languages to use |
| `SUWAYOMI_SOURCES` | *(all)* | Restrict to these Suwayomi source ids |
| `UPDATE_INTERVAL_MIN` | `180` | New-chapter check interval; `0` disables |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | *(empty)* | Web push (`npx web-push generate-vapid-keys`) |
| `HANYO_DEMO_SOURCE` | *(unset)* | `1` replaces all sources with an offline demo source (tests) |

## Testing

```bash
npm run typecheck                         # every workspace
npm test                                  # unit tests (vitest)
npm run build && npm run e2e -w apps/web  # end-to-end (Playwright, offline demo source)
```

The end-to-end suite runs the real API and the built PWA against a demo source with generated
pages. It covers search, reading lists, strip and paged reading, downloads read offline,
Novedades, history, Explore and settings. CI runs everything on every pull request.

## Deployment

Runs on a single VPS next to other services: Caddy serves the PWA and proxies `/api`, PM2 runs
hanyo-api, and Docker runs only Suwayomi and FlareSolverr.

- First install: `deploy/setup.sh` (see the [deploy runbook](docs/deploy.md)).
- Updates: `sudo -u deploy bash /home/deploy/hanyo/deploy/deploy.sh`. It pulls `main`, builds,
  publishes the PWA, restarts the API and syncs the extensions in `deploy/extensions.txt`.
  GitHub Actions can run it on every push to `main` once `DEPLOY_ENABLED` and the SSH secrets are set.
- Sites that block datacenter IPs: optional Cloudflare WARP egress for Suwayomi
  (`deploy/docker-compose.warp.yml`, ADR-010).
- `deploy/test-sources.py` checks which extensions actually work from the server.

## Sources and responsible use

Hanyo is a personal reader for one user. It hosts no content and has no public catalogue. It
respects the MangaDex API rate limits and reports MangaDex@Home delivery as required, keeps the
image cache size-capped, and checks sources once a day. Please support the official releases of
the series you enjoy.

## Documentation

[Architecture](docs/architecture.md) · [Decisions](docs/decisions.md) · [Status](docs/status.md) ·
[Backlog](docs/backlog.md) · [Deploy runbook](docs/deploy.md)
