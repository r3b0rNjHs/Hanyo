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
- **Deploy**: `deploy/setup.sh` (one-shot), `deploy/deploy.sh` (CI), Docker compose for Suwayomi + FlareSolverr,
  Caddy site via `import`, GitHub Actions CI + deploy (gated by `DEPLOY_ENABLED`).

## Not yet verified on real hardware
- iOS Safari standalone: install, push, wake lock, memory behaviour with long strips.
- Suwayomi sources (Weeb Central, Comix, Asura, Flame) end-to-end.

Screenshots: `docs/screenshots/`.
