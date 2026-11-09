# Decisions

## ADR-001: PWA instead of a native iOS app
iOS is the target and there is no Mac. A native app would need SideStore re-signing every 7 days or a $99/yr
developer account (AltStore PAL requires Apple notarization, which a scanlation reader would not pass).
A home-screen PWA installs from Safari, updates instantly, supports web push (iOS 16.4+) and offline storage,
and can be tested with Playwright. Trade-off: no background downloads on iOS — mitigated by server-side
update checks and prefetch.

## ADR-002: Suwayomi-Server for non-MangaDex sources
MangaDex lacks most licensed manhwa in English (Solo Leveling, ORV, Tower of God…). Writing scrapers for
Weeb Central / Asura / Comix means maintaining them weekly (Comix needs WebView + descrambling). Suwayomi runs
the community-maintained Mihon extensions (Keiyoushi) and exposes GraphQL. Verified against v2.4.2366
(note: `fetchMangaAndChapters`, not separate `fetchManga`/`fetchChapters`).

## ADR-003: MangaDex stays a native provider
Stable official API, no extension needed, and a fallback when Suwayomi is down.

## ADR-004: Docker only for Suwayomi + FlareSolverr
yoqze's ADR-003 avoids Docker for its own Node services. Suwayomi executes third-party extension code and
FlareSolverr bundles Chromium; containers isolate them from the production yoqze platform on the same VPS,
cap their memory and make upgrades a `docker compose pull`. hanyo-api itself runs on PM2 like yoqze.

## ADR-005: Progress keyed by chapter number
Chapters come from several sources with different ids. Read marks are `(series_id, number)` so switching or
adding sources keeps progress, and the merged list can show one "read" state per chapter.

## ADR-006: Single-user cookie auth
One password (`HANYO_PASSWORD`) → HMAC-signed, HttpOnly, Secure cookie valid 1 year. Simple and works for
`<img>` requests and the service worker. Login is rate-limited per IP.

## ADR-007: Reader memory strategy (iOS)
WebKit kills tabs that hold too many decoded images (a 800×10000 strip ≈ 32 MB decoded). The strip reader
mounts only pages [current−3, current+6], keeps sized placeholders elsewhere and compensates scroll position
when a page above the viewport learns its real height (Safari has no `overflow-anchor`).
