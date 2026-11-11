/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { build, files, version } from "$service-worker";
import { API_CACHE, COVERS_CACHE, PAGES_CACHE, PREFETCH_CACHE } from "$lib/offline/caches";

const sw = self as unknown as ServiceWorkerGlobalScope;
const SHELL_CACHE = `hanyo-shell-${version}`;
const SHELL = ["/", ...build, ...files];
const PAGE_RE = /^\/api\/chapters\/\d+\/pages\/\d+$/;
const NETWORK_TIMEOUT_MS = 6000;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("hanyo-shell-") && key !== SHELL_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== sw.location.origin) {
    // Direct pages (a source's own CDN) that were downloaded live in the pages cache.
    if (req.destination === "image") {
      event.respondWith(caches.match(req.url, { cacheName: PAGES_CACHE }).then((hit) => hit ?? fetch(req)));
    }
    return;
  }

  // Chapter pages: downloaded, else prefetched (next chapter), else straight to network.
  if (PAGE_RE.test(url.pathname)) {
    event.respondWith(
      (async () =>
        (await caches.match(url.pathname, { cacheName: PAGES_CACHE })) ??
        (await caches.match(url.pathname, { cacheName: PREFETCH_CACHE })) ??
        fetch(req))(),
    );
    return;
  }

  if (url.pathname.startsWith("/api/img/")) {
    event.respondWith(cacheFirst(req, COVERS_CACHE));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/search") return;
    event.respondWith(networkFirstJson(req));
    return;
  }

  // App shell: SPA navigations get index.html; hashed assets are immutable.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match("/", { cacheName: SHELL_CACHE })) ?? Response.error()),
    );
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(url.pathname, { cacheName: SHELL_CACHE }).then((hit) => hit ?? fetch(req)));
  }
});

async function cacheFirst(req: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** Fresh data when online; last-known copy (flagged) when offline or the server is slow. */
async function networkFirstJson(req: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE);
  const key = new URL(req.url).pathname + new URL(req.url).search;
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key);
    if (!hit) return new Response(JSON.stringify({ error: "Sin conexión" }), { status: 503 });
    const headers = new Headers(hit.headers);
    headers.set("x-hanyo-offline", "1");
    return new Response(hit.body, { status: 200, headers });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ── Web push: new chapter notifications ──────────────────────────────────
sw.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string };
  event.waitUntil(
    sw.registration.showNotification(data.title ?? "Hanyo", {
      body: data.body ?? "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

sw.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? "/";
  event.waitUntil(
    (async () => {
      const all = await sw.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = all[0];
      if (client) {
        await client.focus();
        await (client as WindowClient).navigate(target);
      } else {
        await sw.clients.openWindow(target);
      }
    })(),
  );
});
