import type { SourceInfo } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { normalizeTitle, parseChapterNumber } from "../src/lib/text.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider, RawChapter, RawSeries } from "../src/providers/types.js";
import { LibraryService } from "../src/services/library.js";

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

    const merged = library.mergedChapters(id);
    expect(merged.map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Chapters present on both prefer MangaDex (priority 50 < 100) and keep the other as alternative.
    const ch1 = merged[0]!;
    expect(ch1.sourceKey).toBe("mangadex");
    expect(ch1.alternatives).toHaveLength(1);
    // Gaps come from Weeb Central.
    expect(merged[3]!.sourceKey).toBe("suwayomi:42");
  });

  it("tracks read state by chapter number so it survives source changes", async () => {
    const { library } = setup();
    const id = await library.open("mangadex", "md-1");
    await library.linkSource(id, "suwayomi:42", "7");
    const ch2 = library.mergedChapters(id).find((c) => c.number === 2)!;
    library.saveProgress(ch2.id, 5, true);

    const detail = library.detailFromDb(id)!;
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
    const merged = library.mergedChapters(id);
    const ctx = library.chapterContext(merged[3]!.id)!;
    expect(ctx.prevId).toBe(merged[2]!.id);
    expect(ctx.nextId).toBe(merged[4]!.id);
  });

  it("re-opening the same source entry reuses the series", async () => {
    const { library } = setup();
    const a = await library.open("mangadex", "md-1");
    const b = await library.open("mangadex", "md-1");
    expect(a).toBe(b);
  });
});
