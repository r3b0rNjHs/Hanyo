// Shared between the app and the service worker. Bump a name to invalidate that cache.
export const PAGES_CACHE = "hanyo-pages-v1"; // downloaded chapter images (user-managed)
export const API_CACHE = "hanyo-api-v1"; // last-known JSON responses (offline fallback)
export const COVERS_CACHE = "hanyo-covers-v1"; // cover thumbnails
export const PREFETCH_CACHE = "hanyo-prefetch-v1"; // next chapter, fetched while reading (app-managed, small)
