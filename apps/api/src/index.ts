import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp, wrapImage } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db/index.js";
import { Signer } from "./lib/signing.js";
import { MangaDexProvider } from "./providers/mangadex.js";
import { ProviderRegistry } from "./providers/registry.js";
import { SuwayomiProvider } from "./providers/suwayomi.js";
import { ImageCache } from "./services/image-cache.js";
import { LibraryService } from "./services/library.js";
import { PageService } from "./services/pages.js";
import { PushService } from "./services/push.js";
import { UpdateService } from "./services/updates.js";

const db = openDb(config.dataDir);
const signer = new Signer(config.sessionSecret);
const registry = new ProviderRegistry([
  new MangaDexProvider(config.userAgent),
  new SuwayomiProvider(config.suwayomiUrl, config.suwayomiSources),
]);
const cache = new ImageCache(path.join(config.dataDir, "cache"), config.imageCacheMaxBytes);
const library = new LibraryService(db, registry, (key, url) => wrapImage(signer, key, url));
const pages = new PageService(library, registry, cache, config.imageQuality);
const push = new PushService(db, config.vapid.publicKey, config.vapid.privateKey, config.vapid.subject);
const updates = new UpdateService(library, registry, pages, push);

const api = createApp({
  password: config.password,
  signer,
  secureCookies: config.isProd,
  registry,
  library,
  pages,
  updates,
  push,
});

const root = new Hono();
root.route("/", api);

// Optional: serve the built PWA from the same process (local preview). In production Caddy does this.
const webDir = process.env.WEB_DIR;
if (webDir && fs.existsSync(webDir)) {
  root.use("/*", serveStatic({ root: path.relative(process.cwd(), webDir) }));
  // Read per request so a rebuilt web app is picked up without restarting the API.
  root.get("*", (c) => c.html(fs.readFileSync(path.join(webDir, "index.html"), "utf8")));
}

updates.start(config.updateIntervalMin);

serve({ fetch: root.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  console.log(`hanyo-api listening on http://127.0.0.1:${info.port} (data: ${config.dataDir})`);
});
