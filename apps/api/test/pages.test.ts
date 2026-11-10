import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SourceInfo } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider, RawSeries } from "../src/providers/types.js";
import { ImageCache } from "../src/services/image-cache.js";
import { LibraryService } from "../src/services/library.js";
import { PageService, SourceUnavailableError } from "../src/services/pages.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A source whose chapter list works; its images either load or are blocked like a Cloudflare ban. */
class Source implements Provider {
  imageCalls = 0;
  /** Set to give the source a direct mode (image URLs the phone loads itself). */
  direct: string[] | null = null;
  async directPageUrls(): Promise<string[] | null> {
    return this.direct;
  }
  constructor(
    readonly id: "mangadex" | "suwayomi",
    private readonly info: SourceInfo,
    private readonly series: RawSeries,
    private readonly imagesBlocked: boolean,
  ) {}
  async listSources() {
    return [this.info];
  }
  async browse() {
    return { hits: [], hasNextPage: false };
  }
  async search() {
    return [];
  }
  async getSeries() {
    return structuredClone(this.series);
  }
  async getPageUrls(_s: string, chapter: string) {
    return [`https://img.example/${chapter}/0.png`, `https://img.example/${chapter}/1.png`];
  }
  async fetchImage(): Promise<{ bytes: Buffer; contentType: string }> {
    this.imageCalls++;
    if (this.imagesBlocked) throw new Error("GET http://127.0.0.1:4567/api/v1/manga/20/chapter/32/page/0 -> 500 HttpException: HTTP error 500");
    return { bytes: PNG, contentType: "image/png" };
  }
  allowsImageUrl() {
    return true;
  }
}

function series(id: string, nums: number[]): RawSeries {
  return {
    externalId: id,
    title: "Questism",
    coverUrl: null,
    description: null,
    authors: [],
    genres: [],
    status: "ongoing",
    url: null,
    chapters: nums.map((n, i) => ({ externalId: `${id}-${n}`, number: n, title: null, scanlator: null, publishedAt: n, sourceOrder: i })),
  };
}

function setup(opts: { blockedHasEverything: boolean; otherSourceHas: number[] }) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanyo-pages-"));
  const blocked = new Source(
    "suwayomi",
    { key: "suwayomi:1", provider: "suwayomi", sourceId: "1", name: "Weeb Central", lang: "en", iconUrl: null },
    series("wc", opts.blockedHasEverything ? [31, 32, 33] : [32]),
    true,
  );
  const working = new Source(
    "mangadex",
    { key: "mangadex", provider: "mangadex", sourceId: "mangadex", name: "MangaDex", lang: "en", iconUrl: null },
    series("md", opts.otherSourceHas),
    false,
  );
  const registry = new ProviderRegistry([blocked, working]);
  const library = new LibraryService(openMemoryDb(), registry, (_k, u) => u);
  const pages = new PageService(library, registry, new ImageCache(cacheDir, 50 * 1024 * 1024), 0);
  return { library, pages, blocked, working };
}

describe("PageService source fallback", () => {
  it("serves the same chapter from another source when the preferred one's images are blocked", async () => {
    const { library, pages } = setup({ blockedHasEverything: true, otherSourceHas: [32] });
    const id = await library.open("suwayomi:1", "wc");
    await library.linkSource(id, "mangadex", "md");
    // Make the blocked source the preferred one, like a series opened from Weeb Central.
    library.setPriority(id, library.detailFromDb(id)!.sources.find((s) => s.sourceKey === "suwayomi:1")!.id, 10);
    const ch32 = library.mergedChapters(id).find((c) => c.number === 32)!;
    expect(ch32.sourceName).toBe("Weeb Central");

    const res = (await pages.chapterPages(ch32.id))!;
    expect(res.sourceName).toBe("MangaDex");
    expect(res.chapterNumber).toBe(32);
    expect(res.chapterId).not.toBe(ch32.id);
    expect(res.pages).toHaveLength(2);
    // The probe cached page 0, so serving it doesn't hit the source again.
    expect((await pages.page(res.chapterId, 0))!.bytes.equals(PNG)).toBe(true);
  });

  it("explains which source is blocked when no other source has the chapter", async () => {
    const { library, pages } = setup({ blockedHasEverything: true, otherSourceHas: [115] });
    const id = await library.open("suwayomi:1", "wc");
    await library.linkSource(id, "mangadex", "md");
    const ch32 = library.mergedChapters(id).find((c) => c.number === 32)!;

    const err = await pages.chapterPages(ch32.id).catch((e) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    expect(err.message).toMatch(/^Weeb Central no deja descargar las imágenes/);
    expect(err.failures[0]).toMatch(/bloqueada \(Cloudflare\)/);
  });

  it("uses the chapter's own source when it works", async () => {
    const { library, pages, blocked } = setup({ blockedHasEverything: false, otherSourceHas: [31, 32] });
    const id = await library.open("mangadex", "md");
    const ch = library.mergedChapters(id).find((c) => c.number === 31)!;
    const res = (await pages.chapterPages(ch.id))!;
    expect(res.chapterId).toBe(ch.id);
    expect(res.sourceName).toBe("MangaDex");
    expect(blocked.imageCalls).toBe(0);
  });
});

describe("PageService direct mode", () => {
  it("hands the phone the source's own image URLs when its host blocks the server", async () => {
    const { library, pages, blocked } = setup({ blockedHasEverything: true, otherSourceHas: [115] });
    blocked.direct = ["https://official.lowee.us/manga/QUESTISM/0032-001.png", "https://official.lowee.us/manga/QUESTISM/0032-002.png"];
    const id = await library.open("suwayomi:1", "wc");
    const ch32 = library.mergedChapters(id).find((c) => c.number === 32)!;

    const res = (await pages.chapterPages(ch32.id))!;
    expect(res.direct).toBe(true);
    expect(res.chapterId).toBe(ch32.id);
    expect(res.pages[0]).toBe("https://official.lowee.us/manga/QUESTISM/0032-001.png");
  });

  it("prefers another source through the server over direct mode", async () => {
    const { library, pages, blocked } = setup({ blockedHasEverything: true, otherSourceHas: [32] });
    blocked.direct = ["https://cdn.example/1.png"];
    const id = await library.open("suwayomi:1", "wc");
    await library.linkSource(id, "mangadex", "md");
    const ch32 = library.chapterCandidates(library.mergedChapters(id).find((c) => c.number === 32)!.id);
    const wcChapter = ch32.find((c) => c.sourceName === "Weeb Central")!;
    const res = (await pages.chapterPages(wcChapter.id))!;
    expect(res.direct).toBe(false);
    expect(res.sourceName).toBe("MangaDex");
  });

  it("remembers a blocked source and skips it for the next chapters", async () => {
    const { library, pages, blocked } = setup({ blockedHasEverything: true, otherSourceHas: [115] });
    blocked.direct = ["https://cdn.example/1.png"];
    const id = await library.open("suwayomi:1", "wc");
    const [c31, c32] = library.mergedChapters(id).filter((c) => c.number === 31 || c.number === 32);
    await pages.chapterPages(c31!.id);
    const callsAfterFirst = blocked.imageCalls;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const res = (await pages.chapterPages(c32!.id))!;
    expect(res.direct).toBe(true);
    expect(blocked.imageCalls).toBe(callsAfterFirst);
  });
});
