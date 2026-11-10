# Backlog

## Next (needs the VPS)
- [ ] Run `deploy/setup.sh` on the VPS, DNS `hanyo.yoqze.com`, enable `DEPLOY_ENABLED`
- [ ] Verify each Suwayomi source end-to-end (search → chapters → pages); tune `SUWAYOMI_SOURCES` order
- [ ] Verify on iPhone: install, offline reading, push notifications, long-strip memory

## Product
- [ ] "Download new chapters automatically" per series (on app open, since iOS has no background fetch)
- [ ] Source management UI on the series page: reorder priority, unlink, "find on other sources"
- [ ] Browse tab: popular / latest per source (Suwayomi `POPULAR` / `LATEST`)
- [ ] Categories / reading status (reading, plan to read, completed)
- [ ] AniList / MangaUpdates metadata to improve cross-source title matching
- [ ] Pinch-zoom in paged mode (@panzoom/panzoom)
- [ ] Store page dimensions server-side so strip placeholders have exact size before load
- [ ] Resume within a tall page (store intra-page fraction, not just page index)

- [ ] Series covers in the reader's "next chapter" card (needs cover in the page list response)
- [ ] Light theme variant of Pulso

## Tech
- [ ] Silence `state_referenced_locally` warnings in reader components (untrack)
- [ ] E2E Playwright suite in CI using a fake provider
- [ ] Server image cache metrics endpoint
