# Architecture

```
iPhone (PWA, Safari standalone)
 ├─ SvelteKit SPA  ── service worker ── Cache Storage (shell, API JSON, covers, downloaded pages)
 │                                      IndexedDB (downloads, download queue, offline progress)
 │
 └─ HTTPS ─► hanyo.yoqze.com (Caddy, yoqze VPS)
              ├─ /          static PWA from /var/www/hanyo
              └─ /api/*  ─► hanyo-api :3101 (PM2)
                              ├─ SQLite: series (shelf, lang, notify, auto_download), series_sources,
                              │          chapters, read_marks, resume_points, page_sizes,
                              │          source_health, push_subscriptions
                              ├─ disk image cache (pages + covers, LRU, size-capped, WebP/mozjpeg)
                              ├─ MangaDex provider ──► api.mangadex.org / MangaDex@Home
                              ├─ AniList ───────────► names, trends, recommendations (optional)
                              └─ Suwayomi provider ──► 127.0.0.1:4567 (Docker)
                                                         ├─ Mihon extensions (Keiyoushi store)
                                                         ├─ FlareSolverr (Cloudflare challenges)
                                                         └─ Cloudflare WARP egress (opt-in, ADR-010)
```

## Key flows

- **Search**: the web asks `/api/search?source=X&q=` once per source in parallel and groups hits by
  normalized title as they arrive. A broken source returns `{error}` instead of failing the search.
- **Open series**: `/api/series/open` creates our `series` + a `series_sources` link; the web then links the
  same title on the other sources it was found on. Adding to the library also runs `autoLink` (exact title
  match on every other source).
- **Chapters**: each source keeps its own chapter rows; the API merges them by chapter number
  (preferred source wins, others kept as `alternatives`).
- **Reading**: `/api/chapters/:id/pages` returns stable same-origin URLs `/api/chapters/:id/pages/:n`;
  the API resolves upstream URLs (MangaDex at-home URLs expire ~15 min) and caches bytes on disk.
- **Offline**: downloads put page responses in Cache Storage under those same URLs, so the reader code is
  identical online and offline. API JSON is network-first with cache fallback (flagged `x-hanyo-offline`).
- **Updates**: every `UPDATE_INTERVAL_MIN` the API refreshes library series, sends a web push for chapter
  numbers that are new across all sources, and prefetches those pages into the server cache.
