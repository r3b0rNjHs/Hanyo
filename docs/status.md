# Status

_Last updated: 2026-11-11_

## Done
- **hanyo-api**: auth, per-source search, series open/link/merge, merged chapter list, read marks by number,
  resume points, page proxy + disk cache, cover proxy, update checks + prefetch, web push.
- **MangaDex provider**: verified end-to-end (search, details, 103 chapters of Eleceed, pages, cache).
- **Suwayomi provider**: written against the real v2.4.2366 GraphQL schema; store + extension listing verified
  locally. Extension install could not be exercised in the dev sandbox → first real test happens on the VPS.
- **PWA**: library, unified search, series page, vertical + paged reader, downloads (persistent queue),
  offline mode (verified in airplane mode with Playwright), settings, push subscription, icons/manifest.
- **UI**: "Pulso" design applied to every screen (ADR-009); search merges and ranks results across sources
  using AniList names and popularity.
- **Compact pages**: downloads are re-encoded to WebP/mozjpeg q90 on the server (~80% smaller, 12 API tests).
- **Deploy**: `deploy/setup.sh` (one-shot), `deploy/deploy.sh` (CI), Docker compose for Suwayomi + FlareSolverr,
  Caddy site via `import`, GitHub Actions CI + deploy (gated by `DEPLOY_ENABLED`).

- **Sources**: 19 Suwayomi sources + MangaDex verified from the VPS through Cloudflare WARP (ADR-010);
  library series re-link automatically when the source set changes (AniList alt titles help matching).
- **Reading lists**: Leyendo / Pendiente / En pausa / Terminada, filters in the library; planned or paused
  series move to Leyendo when opened in the reader.
- **Explore tab**: AniList trending by origin (manhwa / manga / manhua, opens a cross-source search) plus
  popular / latest per source and language; infinite scroll, cached server-side.
- **Downloads on the series page**: one-tap per chapter, progress card, whole series / cancel / delete, and
  per-series automatic download of the next 5 unread chapters whenever the app is opened.
- **Reader**: resume at the exact spot inside tall strips, exact placeholders from server-side page
  shapes, pinch / double-tap zoom in paged mode, series cover on the next-chapter card.
- **Settings**: light / dark / system theme (ADR-011), server stats (cache, library, sources, uptime).
- **E2E**: Playwright suite on an offline demo source runs in CI (search, lists, reading, offline download).
- **Navigation** (ADR-012): Biblioteca · Novedades (new chapters + Historial) · Explorar (with search) ·
  Descargas; settings from the library header. Per-series notification bell, AniList recommendations
  on the series page, swipe actions on chapter rows.
- **Source health**: daily check of every source (lists its popular series); push when one breaks two
  days in a row or comes back, one shared alert if all Suwayomi sources fail (Suwayomi / WARP down).
- **Reading extras**: next chapter prefetched while reading (opens offline), preferred translation group
  per series, reading stats (streak, activity, weekly bars, top series and genres), delete read / all
  downloads.
- **Accounts** (ADR-013): admin from the existing data, per-user library and progress over a shared
  catalogue, invite links, account management in settings, logout clears cached personal data.

## Not yet verified on real hardware
- iOS Safari standalone: push, wake lock, memory behaviour with long strips.

Screenshots: `docs/screenshots/`.
