import type { SourceInfo } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { normalizeTitle, parseChapterNumber } from "../src/lib/text.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider, RawChapter, RawSeries } from "../src/providers/types.js";
import { LibraryService } from "../src/services/library.js";

/** The admin created by the multi-user migration owns the data in these tests. */
const U = 1;

function chapters(nums: number[], prefix: string): RawChapter[] {
  return nums.map((n, i) => ({
    externalId: `${prefix}-${n}`,
    number: n,
    title: `Chapter ${n}`,
    scanlator: prefix,
    publishedAt: 1_700_000_000_000 + n,
    sourceOrder: i,
  }));
}

class FakeProvider implements Provider {
  constructor(
    readonly id: "mangadex" | "suwayomi",
    private readonly sources: SourceInfo[],
    public series: Record<string, RawSeries>,
  ) {}
  async listSources() {
    return this.sources;
  }
  async search(_s: string, q: string) {
    return Object.values(this.series)
      .filter((s) => normalizeTitle(s.title) === normalizeTitle(q))
      .map((s) => ({ externalId: s.externalId, title: s.title, coverUrl: null }));
  }
  async getSeries(_s: string, id: string) {
    const s = this.series[id];
    if (!s) throw new Error("not found");
    return structuredClone(s);
  }
  async browse() {
    return { hits: [], hasNextPage: false };
  }
  async getPageUrls() {
    return [];
  }
  async fetchImage() {
    return { bytes: Buffer.alloc(0), contentType: "image/jpeg" };
  }
  allowsImageUrl() {
    return true;
  }
}

function base(title: string, externalId: string, nums: number[], prefix: string): RawSeries {
  return {
    externalId,
    title,
    coverUrl: null,
    description: null,
    authors: [],
    genres: [],
    status: "ongoing",
    url: null,
    chapters: chapters(nums, prefix),
  };
}

function setup() {
  const db = openMemoryDb();
  const md = new FakeProvider(
    "mangadex",
    [{ key: "mangadex", provider: "mangadex", sourceId: "mangadex", name: "MangaDex", lang: "en", iconUrl: null }],
    { "md-1": base("Eleceed", "md-1", [1, 2, 3, 10], "md") },
  );
  const wc = new FakeProvider(
    "suwayomi",
    [{ key: "suwayomi:42", provider: "suwayomi", sourceId: "42", name: "Weeb Central", lang: "en", iconUrl: null }],
    { "7": base("Eleceed!", "7", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "wc") },
  );
  const registry = new ProviderRegistry([md, wc]);
  const library = new LibraryService(db, registry, (_k, u) => u);
  return { db, library, md, wc };
}

describe("text helpers", () => {
  it("normalizes titles across sources", () => {
    expect(normalizeTitle("Return of the Mount Hua Sect!")).toBe(normalizeTitle("return of  mount hua sect"));
    expect(normalizeTitle("Solo Leveling: Ragnarök")).toBe("solo leveling ragnarok");
  });
  it("parses chapter numbers from names", () => {
    expect(parseChapterNumber("Chapter 123.5 - The End")).toBe(123.5);
    expect(parseChapterNumber("Ep. 45")).toBe(45);
    expect(parseChapterNumber("Prologue")).toBeNull();
  });
});

describe("LibraryService", () => {
  it("merges chapters from several sources, filling gaps and preferring MangaDex", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");

    const merged = library.mergedChapters(id, U);
    expect(merged.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Chapters present on both prefer MangaDex (priority 50 < 100) and keep the other as alternative.
    const ch1 = merged[0]!;
    expect(ch1.sourceKey).toBe("mangadex");
    expect(ch1.alternatives).toHaveLength(1);
    // Gaps come from Weeb Central.
    expect(merged[3]!.sourceKey).toBe("suwayomi:42");
  });

  it("prefers a scanlation group over source priority when it has the chapter", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");
    // MangaDex (md) wins by priority; Weeb Central chapters are by "wc".
    expect(library.mergedChapters(id, U)[0]!.scanlator).toBe("md");
    expect(library.detailFromDb(id, U)!.scanlators.map((s) => s.name)).toEqual(["wc", "md"]);

    library.setPreferredScanlator(U, id, "WC");
    const merged = library.mergedChapters(id, U);
    expect(merged[0]!.scanlator).toBe("wc");
    expect(library.chapterCandidates(merged[0]!.alternatives[0]!, U).map((c) => c.sourceName)).toEqual(["MangaDex", "Weeb Central"]);
    expect(library.detailFromDb(id, U)!.preferredScanlator).toBe("WC");

    library.setPreferredScanlator(U, id, null);
    expect(library.mergedChapters(id, U)[0]!.scanlator).toBe("md");
  });

  it("tracks read state by chapter number so it survives source changes", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");
    const ch2 = library.mergedChapters(id, U).find((c) => c.number === 2)!;
    library.saveProgress(U, ch2.id, 5, false, 0.42);
    expect(library.detailFromDb(id, U)!.resume).toMatchObject({ chapterId: ch2.id, page: 5, offset: 0.42 });
    library.saveProgress(U, ch2.id, 5, true, 0.9);

    const detail = library.detailFromDb(id, U)!;
    expect(detail.chapters.find((c) => c.number === 2)!.read).toBe(true);
    // Resume moves to the next chapter after completing one.
    expect(detail.resume?.chapterNumber).toBe(3);
    expect(detail.unreadCount).toBe(9);
  });

  it("reports only chapter numbers that are new across all sources on refresh", async () => {
    const { library, md, wc } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");

    md.series["md-1"]!.chapters.push(...chapters([4], "md")); // already on Weeb Central
    wc.series["7"]!.chapters.push(...chapters([11], "wc")); // genuinely new
    const { newNumbers, errors } = await library.refresh(id);
    expect(errors).toEqual([]);
    expect(newNumbers).toEqual([11]);
  });

  it("navigates prev/next on the merged list", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");
    const merged = library.mergedChapters(id, U);
    const ctx = library.chapterContext(merged[3]!.id, U)!;
    expect(ctx.prevId).toBe(merged[2]!.id);
    expect(ctx.nextId).toBe(merged[4]!.id);
  });

  it("keeps reading lists and moves planned series to reading once opened", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    library.setShelf(U, id, "plan");
    expect(library.listLibrary(U).map((s) => [s.id, s.shelf])).toEqual([[id, "plan"]]);

    library.saveProgress(U, library.mergedChapters(id, U)[0]!.id, 2, false);
    expect(library.detailFromDb(id, U)!.shelf).toBe("reading");

    library.setShelf(U, id, "completed");
    library.saveProgress(U, library.mergedChapters(id, U)[1]!.id, 0, true);
    expect(library.detailFromDb(id, U)!.shelf).toBe("completed");
  });

  it("builds a feed of the latest library chapters, newest first", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    expect(library.feed(U)).toEqual([]);
    library.setShelf(U, id, "plan");
    expect(library.feed(U)).toEqual([]);
    library.setShelf(U, id, "reading");
    const feed = library.feed(U, 2);
    expect(feed.map((f) => f.chapter.number)).toEqual([10, 3]);
    expect(feed[0]!.seriesTitle).toBe("Eleceed");
  });

  it("keeps a reading history from resume points, newest first", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    const ch = library.mergedChapters(id, U)[1]!;
    library.saveProgress(U, ch.id, 4, false);
    expect(library.history(U)).toMatchObject([{ seriesId: id, chapterId: ch.id, chapterNumber: 2, page: 4 }]);
    library.forgetResume(U, id);
    expect(library.history(U)).toEqual([]);
    expect(library.detailFromDb(id, U)!.resume).toBeNull();
  });

  it("lists the source entries of library series", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");
    expect(library.libraryLinks(U)).toEqual([]);
    library.setInLibrary(U, id, true);
    expect(library.libraryLinks(U).map((l) => `${l.sourceKey}|${l.externalId}|${l.seriesId === id}`).sort()).toEqual([
      "mangadex|md-1|true",
      "suwayomi:42|7|true",
    ]);
  });

  it("notifies new chapters per series, on by default", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    expect(library.detailFromDb(id, U)!.notify).toBe(true);
    library.setInLibrary(U, id, true);
    expect(library.usersToNotify(id)).toEqual([U]);
    library.setNotify(U, id, false);
    expect(library.usersToNotify(id)).toEqual([]);
  });

  it("stores the automatic download flag per series", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    expect(library.detailFromDb(id, U)!.autoDownload).toBe(false);
    library.setAutoDownload(U, id, true);
    expect(library.detailFromDb(id, U)!.autoDownload).toBe(true);
  });

  it("re-opening the same source entry reuses the series", async () => {
    const { library } = setup();
    const a = await library.open("mangadex", "md-1");
    const b = await library.open("mangadex", "md-1");
    expect(a).toBe(b);
  });
});

describe("LibraryService languages", () => {
  function setupLangs() {
    const db = openMemoryDb();
    const en = new FakeProvider(
      "mangadex",
      [{ key: "mangadex", provider: "mangadex", sourceId: "mangadex", name: "MangaDex", lang: "en", iconUrl: null }],
      { "md-1": base("Lookism", "md-1", [1, 2, 3], "en") },
    );
    const es = new FakeProvider(
      "suwayomi",
      [{ key: "suwayomi:7", provider: "suwayomi", sourceId: "7", name: "LeerCapitulo", lang: "es-419", iconUrl: null }],
      { "9": base("Lookism", "9", [1, 2, 3, 4, 5], "es") },
    );
    const library = new LibraryService(db, new ProviderRegistry([en, es]), (_k, u) => u);
    return { library };
  }

  it("reads a series in one language only, starting with the source it was opened from", async () => {
    const { library } = setupLangs();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:7", "9");
    const detail = library.detailFromDb(id, U)!;
    expect(detail.lang).toBe("en");
    expect(detail.availableLangs).toEqual(["en", "es"]);
    expect(detail.chapters.map((c) => c.number)).toEqual([1, 2, 3]);
    expect(detail.chapters.every((c) => c.sourceKey === "mangadex")).toBe(true);
    expect(detail.sources.find((s) => s.sourceKey === "suwayomi:7")!.lang).toBe("es");
  });

  it("switches language keeping read progress by chapter number", async () => {
    const { library } = setupLangs();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:7", "9");
    library.markRead(U, id, [1, 2], true);

    library.setLang(U, id, "es");
    const detail = library.detailFromDb(id, U)!;
    expect(detail.chapters.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
    expect(detail.chapters.filter((c) => c.read).map((c) => c.number)).toEqual([1, 2]);
    expect(detail.unreadCount).toBe(3);
    // Fallback candidates stay within the series' language.
    const ch3 = detail.chapters.find((c) => c.number === 3)!;
    expect(library.chapterCandidates(ch3.id, U).map((c) => c.sourceName)).toEqual(["LeerCapitulo"]);
  });

  it("refuses a language with no linked source", async () => {
    const { library } = setupLangs();
    const id = await library.open("mangadex", "md-1");
    expect(() => library.setLang(U, id, "fr")).toThrow(/No hay fuentes/);
  });
});

describe("LibraryService.counts", () => {
  it("counts library series and their chapters", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    expect(library.counts()).toEqual({ series: 0, chapters: 0 });
    library.setInLibrary(U, id, true);
    expect(library.counts()).toEqual({ series: 1, chapters: 4 });
  });
});
