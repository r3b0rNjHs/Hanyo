import crypto from "node:crypto";
import type { ChapterPages } from "@hanyo/types";
import type { ProviderRegistry } from "../providers/registry.js";
import type { ImageCache } from "./image-cache.js";
import type { LibraryService } from "./library.js";

/** Upstream page URLs can expire (MangaDex at-home ~15 min), so we only keep them briefly. */
const PAGE_LIST_TTL_MS = 10 * 60_000;

export class PageService {
  private readonly lists = new Map<number, { at: number; urls: string[] }>();
  private readonly inflight = new Map<string, Promise<{ bytes: Buffer; contentType: string }>>();

  constructor(
    private readonly library: LibraryService,
    private readonly registry: ProviderRegistry,
    private readonly cache: ImageCache,
  ) {}

  async chapterPages(chapterId: number): Promise<ChapterPages | null> {
    const ctx = this.library.chapterContext(chapterId);
    if (!ctx) return null;
    const urls = await this.upstreamUrls(chapterId);
    return {
      chapterId,
      seriesId: ctx.link.series_id,
      pages: urls.map((_, i) => `/api/chapters/${chapterId}/pages/${i}`),
      prevChapterId: ctx.prevId,
      nextChapterId: ctx.nextId,
    };
  }

  /** Serve one page: disk cache first, then upstream (de-duplicating concurrent requests). */
  async page(chapterId: number, index: number): Promise<{ bytes: Buffer; contentType: string } | null> {
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
    try {
      return await p;
    } catch (e) {
      if (e instanceof PageNotFound) return null;
      throw e;
    }
  }

  /** Download every page of a chapter into the server cache (used for new-chapter prefetch). */
  async prefetch(chapterId: number): Promise<void> {
    const list = await this.chapterPages(chapterId);
    if (!list) return;
    for (let i = 0; i < list.pages.length; i++) await this.page(chapterId, i);
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
