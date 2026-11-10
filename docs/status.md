# Status

_Last updated: 2026-11-09_

## Done
- **hanyo-api**: auth, per-source search, series open/link/merge, merged chapter list, read marks by number,
  resume points, page proxy + disk cache, cover proxy, update checks + prefetch, web push. 7 unit tests.
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

## Not yet verified on real hardware
- iOS Safari standalone: push, wake lock, memory behaviour with long strips.

Screenshots: `docs/screenshots/`.
