import crypto from "node:crypto";
import type { ChapterPages } from "@hanyo/types";
import type { ProviderRegistry } from "../providers/registry.js";
import { compressPage, JobQueue } from "./compress.js";
import type { ImageCache } from "./image-cache.js";
import type { LibraryService } from "./library.js";

/** Upstream page URLs can expire (MangaDex at-home ~15 min), so we only keep them briefly. */
const PAGE_LIST_TTL_MS = 10 * 60_000;

export class PageService {
  private readonly lists = new Map<number, { at: number; urls: string[] }>();
  private readonly inflight = new Map<string, Promise<{ bytes: Buffer; contentType: string }>>();
  /** Re-encoding is CPU-heavy (~1.5 s for a long strip): keep it off the request path when possible. */
  private readonly compressQueue = new JobQueue(2);

  constructor(
    private readonly library: LibraryService,
    private readonly registry: ProviderRegistry,
    private readonly cache: ImageCache,
    /** WebP/mozjpeg quality for re-encoded pages; 0 disables re-encoding. */
    private readonly quality = 90,
  ) {}

  /**
   * Page list for a chapter, from the first source that can actually deliver its images.
   *
   * Some image hosts block the server (e.g. Weeb Central's CDN rejects OVH IPs through
   * Cloudflare) even though the chapter list loads fine. So before answering we fetch the
   * first page (it is cached, the reader needs it anyway); if that fails we try the same
   * chapter number on the series' other sources. The returned `chapterId` is the one that
   * worked; progress is stored by chapter number, so switching is invisible to the reader.
   */
  async chapterPages(chapterId: number): Promise<ChapterPages | null> {
    const candidates = this.library.chapterCandidates(chapterId);
    if (candidates.length === 0) return null;
    const failures: string[] = [];
    for (const c of candidates) {
      try {
        const urls = await this.upstreamUrls(c.id);
        if (urls.length === 0) throw new Error("no devolvió páginas");
        await this.original(c.id, 0);
        return this.build(c.id, urls);
      } catch (e) {
        failures.push(`${c.sourceName}: ${describe(e)}`);
      }
    }
    throw new SourceUnavailableError(failures);
  }

  private build(chapterId: number, urls: string[]): ChapterPages {
    const ctx = this.library.chapterContext(chapterId)!;
    const basics = this.library.seriesBasics(ctx.link.series_id);
    return {
      chapterId,
      seriesId: ctx.link.series_id,
      seriesTitle: basics.title,
      genres: basics.genres,
      chapterNumber: ctx.chapter.number,
      chapterTitle: ctx.chapter.title,
      sourceName: ctx.link.source_name,
      resumePage: basics.resume?.chapterId === chapterId ? basics.resume.page : null,
      pages: urls.map((_, i) => `/api/chapters/${chapterId}/pages/${i}`),
      prevChapterId: ctx.prevId,
      nextChapterId: ctx.nextId,
      nextChapterNumber: ctx.nextNumber,
    };
  }

  /**
   * Serve one page. Pages are stored twice at most: the upstream original (`pages/…`) until it has been
   * re-encoded into a compact version (`compact/…`, ~80% smaller), which then replaces it.
   * - Reading online (`compact: false`): never waits for re-encoding; returns whatever is ready.
   * - Downloads and prefetch (`compact: true`): wait for the compact version, since it is what the
   *   phone stores.
   */
  async page(
    chapterId: number,
    index: number,
    opts: { compact?: boolean } = {},
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    const compactKey = `compact/${chapterId}/${index}`;
    const done = this.cache.read(compactKey);
    if (done) return done;

    let original: { bytes: Buffer; contentType: string };
    try {
      original = await this.original(chapterId, index);
    } catch (e) {
      if (e instanceof PageNotFound) return null;
      throw e;
    }
    if (this.quality <= 0) return original;

    const job = this.compact(chapterId, index, original.bytes);
    if (!opts.compact) {
      void job.catch(() => undefined);
      return original;
    }
    await job;
    return this.cache.read(compactKey) ?? original;
  }

  private compact(chapterId: number, index: number, bytes: Buffer): Promise<void> {
    const compactKey = `compact/${chapterId}/${index}`;
    return this.compressQueue.run(compactKey, async () => {
      if (this.cache.has(compactKey)) return;
      const result = await compressPage(bytes, this.quality);
      this.cache.write(compactKey, result.bytes);
      this.cache.remove(`pages/${chapterId}/${index}`);
    });
  }

  /** Upstream original: disk cache first, then the source (de-duplicating concurrent requests). */
  private async original(chapterId: number, index: number): Promise<{ bytes: Buffer; contentType: string }> {
    const key = `pages/${chapterId}/${index}`;
    const hit = this.cache.read(key);
    if (hit) return hit;

    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const urls = await this.upstreamUrls(chapterId);
        const url = urls[index];
        if (!url) throw new PageNotFound();
        const { provider } = this.providerFor(chapterId);
        let img: { bytes: Buffer; contentType: string };
        try {
          img = await provider.fetchImage(url);
        } catch {
          // URL may have expired; refresh the list once and retry.
          this.lists.delete(chapterId);
          const fresh = (await this.upstreamUrls(chapterId))[index];
          if (!fresh) throw new PageNotFound();
          img = await provider.fetchImage(fresh);
        }
        this.cache.write(key, img.bytes);
        return img;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  /** Download every page of a chapter into the server cache (used for new-chapter prefetch). */
  async prefetch(chapterId: number): Promise<void> {
    const list = await this.chapterPages(chapterId);
    if (!list) return;
    for (let i = 0; i < list.pages.length; i++) await this.page(chapterId, i, { compact: true });
  }

  /** Cover/thumbnail proxy with caching. `sourceKey` decides which provider may fetch the URL. */
  async image(sourceKey: string, url: string): Promise<{ bytes: Buffer; contentType: string }> {
    const { provider } = this.registry.resolve(sourceKey);
    if (!provider.allowsImageUrl(url)) throw new Error("Image host not allowed for this source");
    const key = `covers/${crypto.createHash("sha1").update(url).digest("hex")}`;
    const hit = this.cache.read(key);
    if (hit) return hit;
    const img = await provider.fetchImage(url);
    this.cache.write(key, img.bytes);
    return img;
  }

  private async upstreamUrls(chapterId: number): Promise<string[]> {
    const cached = this.lists.get(chapterId);
    if (cached && Date.now() - cached.at < PAGE_LIST_TTL_MS) return cached.urls;
    const { provider, sourceId, externalId } = this.providerFor(chapterId);
    const urls = await provider.getPageUrls(sourceId, externalId);
    this.lists.set(chapterId, { at: Date.now(), urls });
    return urls;
  }

  private providerFor(chapterId: number) {
    const ctx = this.library.chapterContext(chapterId);
    if (!ctx) throw new PageNotFound();
    const { provider, sourceId } = this.registry.resolve(ctx.link.source_key);
    return { provider, sourceId, externalId: ctx.chapter.external_id };
  }
}

class PageNotFound extends Error {}

/** No source could deliver a chapter's images. The message is shown in the reader. */
export class SourceUnavailableError extends Error {
  constructor(readonly failures: string[]) {
    super(
      failures.length === 1
        ? `${failures[0]!.split(":")[0]} no deja descargar las imágenes de este capítulo desde el servidor.`
        : "Ninguna fuente deja descargar las imágenes de este capítulo desde el servidor.",
    );
  }
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/Cloudflare|HTTP error 5\d\d| -> 5\d\d/i.test(msg)) return "bloqueada (Cloudflare)";
  if (/timeout|aborted/i.test(msg)) return "no respondió a tiempo";
  return msg.split("\n")[0]!.slice(0, 160);
}
