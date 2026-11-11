import crypto from "node:crypto";
import type { ApiError, ExploreResponse, OpenSeriesRequest, ProgressUpdate, SearchMetaResponse, SearchResponse } from "@hanyo/types";
import type { ServerStats } from "@hanyo/types";
import type { ImageCache } from "./services/image-cache.js";
import { readingStats } from "./services/stats.js";
import type { SourceHealthService } from "./services/health.js";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { Signer } from "./lib/signing.js";
import type { AniListTitles } from "./services/anilist.js";
import type { ProviderRegistry } from "./providers/registry.js";
import { normLang, type LibraryService } from "./services/library.js";
import { SourceUnavailableError, type PageService } from "./services/pages.js";
import type { PushService } from "./services/push.js";
import type { UpdateService } from "./services/updates.js";
import { UserError, type User, type UserService } from "./services/users.js";
import type { RecommendationService } from "./services/recommendations.js";

export interface AppDeps {
  users: UserService;
  /** Optional (tests): recommend a series to another account. */
  recommendations?: RecommendationService;
  signer: Signer;
  secureCookies: boolean;
  registry: ProviderRegistry;
  library: LibraryService;
  pages: PageService;
  updates: UpdateService;
  push: PushService;
  titles: AniListTitles;
  /** Optional: only used for the stats endpoint. */
  cache?: ImageCache;
  /** Optional: daily source checks (settings screen). */
  health?: SourceHealthService;
  log?: (msg: string) => void;
}

const SESSION_COOKIE = "hanyo_session";
const SESSION_MAX_AGE_S = 365 * 24 * 3600;

export function createApp(d: AppDeps) {
  const log = d.log ?? console.log;
  const app = new Hono<{ Variables: { user: User } }>().basePath("/api");
  /** The logged-in user's id (set by the auth middleware). */
  const uid = (c: Context) => (c.get("user") as User).id;
  const sessionCookie = (c: Context, user: User) =>
    setCookie(c, SESSION_COOKIE, d.signer.sign({ v: 2, uid: user.id, sv: user.sessionVersion, iat: Date.now() }), {
      httpOnly: true,
      secure: d.secureCookies,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_S,
    });
  const me = (u: User) => ({ ok: true as const, user: { id: u.id, username: u.username, isAdmin: u.isAdmin } });

  app.onError((err, c) => {
    log(`ERROR ${c.req.method} ${c.req.path}: ${err.message}`);
    return c.json<ApiError>({ error: err.message }, 500);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  // ── Auth ──────────────────────────────────────────────────────────────
  const failures = new Map<string, { n: number; until: number }>();
  app.post("/auth/login", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return c.json<ApiError>({ error: "Demasiados intentos, espera un minuto" }, 429);

    const body = z
      .object({ username: z.string().max(64).optional(), password: z.string().max(200) })
      .safeParse(await c.req.json().catch(() => null));
    const user = body.success ? d.users.authenticate(body.data.username?.trim() || null, body.data.password) : null;
    if (!user) {
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      return c.json<ApiError>({ error: "Usuario o contraseña incorrectos" }, 401);
    }
    failures.delete(ip);
    sessionCookie(c, user);
    return c.json(me(user));
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // ── Invites (public: the person isn't logged in yet) ─────────────────
  app.get("/invites/:token", (c) => c.json({ valid: d.users.inviteValid(c.req.param("token")) }));
  app.post("/invites/:token/redeem", async (c) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) return c.json<ApiError>({ error: "Demasiados intentos, espera un minuto" }, 429);
    const body = z.object({ username: z.string().max(64), password: z.string().max(200) }).parse(await c.req.json());
    try {
      const user = d.users.redeemInvite(c.req.param("token"), body.username, body.password);
      sessionCookie(c, user);
      return c.json(me(user));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n, until: n >= 10 ? Date.now() + 60_000 : 0 });
      return c.json<ApiError>({ error: e.message }, 400);
    }
  });

  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    const session = token ? d.signer.verify<{ v: number; uid?: number; sv?: number }>(token) : null;
    // v1 cookies predate accounts: they belong to the first admin, who owned everything then.
    const user = session ? d.users.get(session.v === 1 ? (d.users.admins()[0] ?? 0) : (session.uid ?? 0)) : null;
    if (!user || (session!.v !== 1 && session!.sv !== user.sessionVersion)) {
      return c.json<ApiError>({ error: "unauthorized" }, 401);
    }
    c.set("user", user);
    await next();
  });

  app.get("/auth/me", (c) => c.json(me(c.get("user"))));

  // ── Account management (admins) ─────────────────────────────────────
  app.use("/admin/*", async (c, next) => {
    if (!(c.get("user") as User).isAdmin) return c.json<ApiError>({ error: "Solo para administradores" }, 403);
    await next();
  });
  app.get("/admin/users", (c) => c.json(d.users.list().map((u) => ({ ...u, ...d.library.userActivity(u.id) }))));
  app.delete("/admin/users/:id", (c) => {
    const id = intParam(c, "id");
    if (id === uid(c)) return c.json<ApiError>({ error: "No puedes borrar tu propia cuenta" }, 400);
    try {
      d.users.remove(id);
      return c.json({ ok: true });
    } catch (e) {
      if (e instanceof UserError) return c.json<ApiError>({ error: e.message }, 400);
      throw e;
    }
  });
  app.get("/admin/invites", (c) => c.json(d.users.listInvites()));
  app.post("/admin/invites", (c) => c.json(d.users.createInvite(uid(c))));
  app.delete("/admin/invites/:token", (c) => {
    d.users.revokeInvite(c.req.param("token"));
    return c.json({ ok: true });
  });

  // Change your own username and/or password (current password required). Other devices with
  // the old password are logged out; this one gets a fresh cookie.
  app.post("/auth/account", async (c) => {
    const body = z
      .object({ currentPassword: z.string().max(200), username: z.string().max(64).optional(), password: z.string().max(200).optional() })
      .parse(await c.req.json());
    try {
      const user = d.users.updateAccount(uid(c), body.currentPassword, { username: body.username, password: body.password });
      sessionCookie(c, user);
      return c.json(me(user));
    } catch (e) {
      if (e instanceof UserError) return c.json<ApiError>({ error: e.message }, 400);
      throw e;
    }
  });

  // ── Sources & search ─────────────────────────────────────────────────
  app.get("/sources", async (c) => c.json(await d.registry.listSources()));

  // Alternative names + popularity, so the web app can merge and rank results across sources.
  app.get("/search/meta", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) return c.json<ApiError>({ error: "q is required" }, 400);
    return c.json<SearchMetaResponse>({ clusters: await d.titles.lookup(q) });
  });

  app.get("/search", async (c) => {
    const q = c.req.query("q")?.trim();
    const key = c.req.query("source");
    if (!q || !key) return c.json<ApiError>({ error: "q and source are required" }, 400);
    const sources = await d.registry.listSources();
    const source = sources.find((s) => s.key === key);
    if (!source) return c.json<ApiError>({ error: "Unknown source" }, 404);
    try {
      const { provider, sourceId } = d.registry.resolve(key);
      const hits = await provider.search(sourceId, q);
      return c.json<SearchResponse>({
        source,
        hits: hits.map((h) => ({
          sourceKey: key,
          sourceName: source.name,
          lang: normLang(source.lang),
          externalId: h.externalId,
          title: h.title,
          ...(h.altTitles?.length ? { altTitles: h.altTitles } : {}),
          coverUrl: wrapImage(d.signer, key, h.coverUrl),
        })),
      });
    } catch (e) {
      // A broken source must not break the whole search: report it per source.
      return c.json<SearchResponse>({ source, hits: [], error: (e as Error).message });
    }
  });

  // Popular / latest per source. Cached a few minutes: the Explore tab is browsed page by page
  // and going back and forth shouldn't hit the source again.
  app.get("/explore/trending", async (c) => {
    const { origin, page, genre, sort } = z
      .object({
        origin: z.enum(["KR", "JP", "CN", "all"]).default("KR"),
        page: z.coerce.number().int().min(1).max(50).default(1),
        genre: z.string().regex(/^[A-Za-z -]{2,30}$/).optional(),
        sort: z.enum(["trending", "popular", "score"]).default("trending"),
      })
      .parse(c.req.query());
    try {
      return c.json(await d.titles.trending(origin, page, genre, sort));
    } catch (e) {
      return c.json<ApiError>({ error: `AniList: ${(e as Error).message}` }, 502);
    }
  });

  const exploreCache = new Map<string, { at: number; body: ExploreResponse }>();
  app.get("/explore", async (c) => {
    const { source: key, kind, page } = z
      .object({ source: z.string(), kind: z.enum(["popular", "latest"]), page: z.coerce.number().int().min(1).max(200).default(1) })
      .parse(c.req.query());
    const source = (await d.registry.listSources()).find((s) => s.key === key);
    if (!source) return c.json<ApiError>({ error: "Unknown source" }, 404);
    const cacheKey = `${key}|${kind}|${page}`;
    const hit = exploreCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 10 * 60_000) return c.json(hit.body);
    try {
      const { provider, sourceId } = d.registry.resolve(key);
      const res = await provider.browse(sourceId, kind, page);
      const body: ExploreResponse = {
        source,
        kind,
        page,
        hasNextPage: res.hasNextPage,
        hits: res.hits.map((h) => ({
          sourceKey: key,
          sourceName: source.name,
          lang: normLang(source.lang),
          externalId: h.externalId,
          title: h.title,
          coverUrl: wrapImage(d.signer, key, h.coverUrl),
        })),
      };
      if (exploreCache.size > 300) exploreCache.clear();
      exploreCache.set(cacheKey, { at: Date.now(), body });
      return c.json(body);
    } catch (e) {
      return c.json<ApiError>({ error: `${source.name}: ${(e as Error).message.split("\n")[0]}` }, 502);
    }
  });

  // ── Series ───────────────────────────────────────────────────────────
  app.post("/series/open", async (c) => {
    const body = z
      .object({ sourceKey: z.string(), externalId: z.string() })
      .parse(await c.req.json()) satisfies OpenSeriesRequest;
    const id = await d.library.open(body.sourceKey, body.externalId);
    return c.json({ id });
  });

  app.get("/series/:id", async (c) => {
    const detail = await d.library.detail(intParam(c, "id"), uid(c));
    return detail ? c.json(detail) : c.json<ApiError>({ error: "Not found" }, 404);
  });

  app.post("/series/:id/library", async (c) => {
    const id = intParam(c, "id");
    const { inLibrary } = z.object({ inLibrary: z.boolean() }).parse(await c.req.json());
    d.library.setInLibrary(uid(c), id, inLibrary);
    if (inLibrary) d.recommendations?.dismissForSeries(uid(c), id);
    // Look for the same series on other sources in the background to fill chapter gaps.
    if (inLibrary) void d.updates.autoLink(id).catch((e) => log(`autolink ${id} failed: ${e}`));
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  // Open a series known only by its names (AniList: Tendencias, recommendations): find it on the
  // sources, open the best match and link the rest. 404 when no source has it.
  app.post("/series/resolve", async (c) => {
    const { title, titles } = z
      .object({ title: z.string().min(1).max(300), titles: z.array(z.string().max(300)).max(40).default([]) })
      .parse(await c.req.json());
    const id = await d.updates.openByNames(title, titles);
    return id === null ? c.json<ApiError>({ error: "No está en tus fuentes" }, 404) : c.json({ id });
  });

  app.get("/series/:id/recommendations", async (c) => {
    const title = d.library.title(intParam(c, "id"));
    if (!title) return c.json<ApiError>({ error: "Not found" }, 404);
    try {
      return c.json(await d.titles.recommendations(title));
    } catch (e) {
      return c.json<ApiError>({ error: `AniList: ${(e as Error).message}` }, 502);
    }
  });

  app.post("/series/:id/shelf", async (c) => {
    const id = intParam(c, "id");
    const { shelf } = z.object({ shelf: z.enum(["reading", "plan", "paused", "completed"]) }).parse(await c.req.json());
    const wasIn = d.library.detailFromDb(id, uid(c))?.inLibrary;
    if (wasIn === undefined) return c.json<ApiError>({ error: "Not found" }, 404);
    d.library.setShelf(uid(c), id, shelf);
    d.recommendations?.dismissForSeries(uid(c), id);
    if (!wasIn) void d.updates.autoLink(id).catch((e) => log(`autolink ${id} failed: ${e}`));
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/scanlator", async (c) => {
    const id = intParam(c, "id");
    const { name } = z.object({ name: z.string().max(200).nullable() }).parse(await c.req.json());
    d.library.setPreferredScanlator(uid(c), id, name);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/notify", async (c) => {
    const id = intParam(c, "id");
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    d.library.setNotify(uid(c), id, enabled);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/autodownload", async (c) => {
    const id = intParam(c, "id");
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    d.library.setAutoDownload(uid(c), id, enabled);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/refresh", async (c) => {
    const id = intParam(c, "id");
    const res = await d.library.refresh(id);
    return c.json({ ...res, detail: d.library.detailFromDb(id, uid(c)) });
  });

  app.post("/series/:id/lang", async (c) => {
    const id = intParam(c, "id");
    const { lang } = z.object({ lang: z.string().min(2).max(8) }).parse(await c.req.json());
    d.library.setLang(uid(c), id, normLang(lang));
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/autolink", async (c) => {
    const id = intParam(c, "id");
    const added = await d.updates.autoLink(id);
    return c.json({ added, detail: d.library.detailFromDb(id, uid(c)) });
  });

  app.post("/series/:id/sources", async (c) => {
    const id = intParam(c, "id");
    const body = z.object({ sourceKey: z.string(), externalId: z.string() }).parse(await c.req.json());
    await d.library.linkSource(id, body.sourceKey, body.externalId);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.delete("/series/:id/sources/:linkId", (c) => {
    const id = intParam(c, "id");
    d.library.unlinkSource(id, intParam(c, "linkId"));
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.patch("/series/:id/sources/:linkId", async (c) => {
    const id = intParam(c, "id");
    const { priority } = z.object({ priority: z.number().int() }).parse(await c.req.json());
    d.library.setPriority(id, intParam(c, "linkId"), priority);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.post("/series/:id/read", async (c) => {
    const id = intParam(c, "id");
    const body = z.object({ numbers: z.array(z.number()), read: z.boolean() }).parse(await c.req.json());
    d.library.markRead(uid(c), id, body.numbers, body.read);
    return c.json(d.library.detailFromDb(id, uid(c)));
  });

  app.get("/library", (c) => c.json(d.library.listLibrary(uid(c))));
  app.get("/library/links", (c) => c.json(d.library.libraryLinks(uid(c))));
  app.get("/feed", (c) => c.json(d.library.feed(uid(c))));

  // ── Recommendations between accounts ─────────────────────────────────
  app.get("/users/directory", (c) => c.json(d.recommendations?.directory(uid(c)) ?? []));
  app.get("/recommendations", (c) => c.json(d.recommendations?.incoming(uid(c)) ?? []));
  app.post("/recommendations/seen", (c) => {
    d.recommendations?.markSeen(uid(c));
    return c.json({ ok: true });
  });
  app.post("/recommendations/:id/dismiss", (c) => {
    d.recommendations?.dismiss(uid(c), intParam(c, "id"));
    return c.json({ ok: true });
  });
  app.post("/series/:id/recommend", async (c) => {
    const id = intParam(c, "id");
    const body = z.object({ to: z.array(z.number().int()).min(1).max(50), note: z.string().max(200).nullish() }).parse(await c.req.json());
    const title = d.library.title(id);
    if (!title || !d.recommendations) return c.json<ApiError>({ error: "Not found" }, 404);
    const me = c.get("user") as User;
    const sent = d.recommendations.send(me.id, body.to, id, body.note ?? null);
    if (sent.length) {
      void d.push
        .notify({ title: `${me.username} te recomienda ${title}`, body: body.note?.trim() || "Toca para verla", url: `/series/${id}` }, sent)
        .catch(() => undefined);
    }
    return c.json({ sent: sent.length });
  });
  app.get("/history", (c) => c.json(d.library.history(uid(c))));
  app.get("/stats", (c) => {
    const { tz } = z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) }).parse(c.req.query());
    return c.json(readingStats(d.library.database, uid(c), tz));
  });
  app.delete("/history/:id", (c) => {
    d.library.forgetResume(uid(c), intParam(c, "id"));
    return c.json({ ok: true });
  });

  app.get("/sources/health", (c) => c.json(d.health?.list() ?? []));
  app.post("/sources/health/check", async (c) => {
    if (!d.health) return c.json<ApiError>({ error: "Not available" }, 404);
    return c.json(await d.health.checkAll());
  });

  app.get("/server/stats", async (c) =>
    c.json<ServerStats>({
      uptimeSec: Math.round(process.uptime()),
      cache: { bytes: d.cache?.size ?? 0, maxBytes: d.cache?.limit ?? 0 },
      library: d.library.counts(),
      sources: (await d.registry.listSources()).length,
    }),
  );

  // Search the whole library on every source (runs in the background; can take minutes).
  app.post("/library/relink", (c) => {
    void d.updates.relinkLibrary(true).catch((e) => log(`relink failed: ${e}`));
    return c.json({ started: true, series: d.library.inLibraryIds().length });
  });

  // ── Reading ──────────────────────────────────────────────────────────
  app.get("/chapters/:id/pages", async (c) => {
    try {
      const res = await d.pages.chapterPages(intParam(c, "id"), uid(c));
      return res ? c.json(res) : c.json<ApiError>({ error: "Not found" }, 404);
    } catch (e) {
      if (e instanceof SourceUnavailableError) {
        log(`pages unavailable for chapter ${c.req.param("id")}: ${e.failures.join(" | ")}`);
        return c.json<ApiError>({ error: e.message }, 502);
      }
      throw e;
    }
  });

  app.get("/chapters/:id/pages/:n", async (c) => {
    // Downloads ask for the compact (re-encoded) version; online reading never waits for it.
    const compact = c.req.query("compact") === "1";
    const img = await d.pages.page(intParam(c, "id"), intParam(c, "n"), { compact });
    if (!img) return c.json<ApiError>({ error: "Not found" }, 404);
    return imageResponse(img);
  });

  app.post("/progress", async (c) => {
    const body = z
      .object({
        chapterId: z.number().int(),
        page: z.number().int().min(0),
        offset: z.number().min(0).max(1).optional(),
        completed: z.boolean(),
      })
      .parse(await c.req.json()) satisfies ProgressUpdate;
    d.library.saveProgress(uid(c), body.chapterId, body.page, body.completed, body.offset);
    return c.json({ ok: true });
  });

  app.get("/img/:token", async (c) => {
    const payload = d.signer.verify<{ k: string; u: string }>(c.req.param("token"));
    if (!payload) return c.json<ApiError>({ error: "Bad image token" }, 400);
    const img = await d.pages.image(payload.k, payload.u);
    return imageResponse(img);
  });

  // ── Updates & push ───────────────────────────────────────────────────
  app.post("/updates/check", async (c) => c.json(await d.updates.checkAll()));

  app.get("/push/key", (c) => c.json({ enabled: d.push.enabled, publicKey: d.push.publicKey || null }));

  app.post("/push/subscribe", async (c) => {
    const sub = z
      .object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) })
      .parse(await c.req.json());
    d.push.subscribe(uid(c), sub);
    return c.json({ ok: true });
  });

  app.post("/push/unsubscribe", async (c) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await c.req.json());
    d.push.unsubscribe(endpoint);
    return c.json({ ok: true });
  });

  app.post("/push/test", async (c) => {
    await d.push.notify({ title: "Hanyo", body: "Las notificaciones funcionan 🎉", url: "/" });
    return c.json({ ok: true });
  });

  return app;
}

export function wrapImage(signer: Signer, sourceKey: string, url: string | null): string | null {
  return url ? `/api/img/${signer.sign({ k: sourceKey, u: url })}` : null;
}

function imageResponse(img: { bytes: Buffer; contentType: string }): Response {
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.contentType,
      "Content-Length": String(img.bytes.length),
      // Page/cover URLs are content-addressed by chapter+index or signed URL: safe to cache hard.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

function intParam(c: Context, name: string): number {
  const n = Number.parseInt(c.req.param(name) ?? "", 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid ${name}`);
  return n;
}

