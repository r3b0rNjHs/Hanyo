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

## ADR-008: Re-encode pages for downloads (WebP / mozjpeg, quality 90)
MangaDex originals are ~35–40 MB per chapter. Pages are re-encoded with sharp to WebP q90, or mozjpeg q90
for strips taller than WebP's 16383 px limit (common in webtoons: 18 of 29 sampled pages). Measured on real
chapters: ~80% smaller (Eleceed ch. 94: 7.3 MB vs ~38 MB) with no visible difference at 1:1
(`docs/screenshots/11-calidad-webp.png`). Re-encoding costs ~1.5 s per long strip, so online reading never
waits for it (original served, compact version built in the background); downloads (`?compact=1`) and
server prefetch wait for it. The original is kept if re-encoding doesn't make it smaller.

## ADR-009: "Pulso" visual design
Chosen by the owner between two directions mocked on a design canvas (A "Hanji": editorial, warm,
serif; B "Pulso": vivid, cover-forward). Pulso: cool black base, electric violet accent (#8E7CFF) for
actions and selection, coral (#FF8A73) only for "new", mint for done; Space Grotesk display over Inter,
both self-hosted (@fontsource) so they work offline. Colours are role-named tokens in `app.css`
(`base`, `surface`, `raised`, `accent`, `fresh`…), so the palette changes in one place. Floating pill
navigation and reader bars; covers fall back to the title set big on a solid block.

## ADR-010: Cloudflare WARP egress for Suwayomi (opt-in)
Weeb Central bans the OVH IP at Cloudflare (whole site, including the image host); the owner won't run
anything at home. Weeb Central's staff replied that anonymous personal use is fine and that they won't
whitelist IPs: we should pass their checks like a normal visitor. `deploy/docker-compose.warp.yml` adds
a WARP client container; Suwayomi uses it as a SOCKS5 proxy and FlareSolverr shares its network, so
every source request and page image leaves through a consumer Cloudflare exit IP. hanyo-api keeps
talking to MangaDex directly (MangaDex@Home reports need the real path). It is enabled per server via
`COMPOSE_FILE` in `deploy/.env`, so it can be switched off without a code change.

## ADR-011: Light theme as a token override
Pulso stays dark by default (reading at night, OLED). The light variant only redefines the role
tokens under `:root[data-theme="light"]` (and under `system` when the OS is light), with a deeper
violet (#6A56EE) so accent text keeps contrast on white. An inline script in `app.html` applies the
saved choice before first paint. The reader keeps its own background setting.

## ADR-012: Four tabs — Biblioteca, Novedades, Explorar, Descargas
Search and Explore did the same job ("find something new") from two tabs, Settings took a tab for a
screen visited rarely, and new chapters were only visible series by series. Now: Novedades is a
feed of the latest chapters of the series you follow (Leyendo / En pausa), with a dot on its tab
for unseen ones; search opens from Explore's search bar (Explore stays highlighted); Settings moves
to the library header. The series page puts one full-width primary action first, three equal
secondary actions (list, download, sources), the language as a compact EN/ES switch, and filters
plus stepwise rendering for long chapter lists.
