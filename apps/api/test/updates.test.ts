import type { SourceInfo, TitleCluster } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider, RawSeries } from "../src/providers/types.js";
import type { AniListTitles } from "../src/services/anilist.js";
import { LibraryService } from "../src/services/library.js";
import type { PageService } from "../src/services/pages.js";
import type { PushService } from "../src/services/push.js";
import { UpdateService } from "../src/services/updates.js";

/** The admin created by the multi-user migration owns the data in these tests. */
const U = 1;

class Fake implements Provider {
  searches = 0;
  constructor(
    readonly id: "mangadex" | "suwayomi",
    public sources: SourceInfo[],
    private readonly series: Record<string, RawSeries>,
  ) {}
  async listSources() {
    return this.sources;
  }
  async search(_s?: string, _q?: string): Promise<{ externalId: string; title: string; coverUrl: string | null }[]> {
    this.searches++;
    return Object.values(this.series).map((s) => ({ externalId: s.externalId, title: s.title, coverUrl: null }));
  }
  async getSeries(_s: string, id: string) {
    return structuredClone(this.series[id]!);
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

const raw = (title: string, externalId: string): RawSeries => ({
  externalId,
  title,
  coverUrl: null,
  description: null,
  authors: [],
  genres: [],
  status: "ongoing",
  url: null,
  chapters: [{ externalId: `${externalId}-1`, number: 1, title: null, scanlator: null, publishedAt: null, sourceOrder: 0 }],
});

const src = (key: string, name: string): SourceInfo => ({
  key,
  provider: key === "mangadex" ? "mangadex" : "suwayomi",
  sourceId: key.split(":").pop()!,
  name,
  lang: "en",
  iconUrl: null,
});

function setup() {
  const md = new Fake("mangadex", [src("mangadex", "MangaDex")], { a: raw("Return of the Mount Hua Sect", "a") });
  const suwa = new Fake("suwayomi", [src("suwayomi:1", "Asura")], {
    x: raw("Return of the Blossoming Blade", "x"),
    y: raw("Return of the Iron-Blooded Hound", "y"),
  });
  const library = new LibraryService(openMemoryDb(), new ProviderRegistry([md, suwa]), (_k, u) => u);
  const cluster: TitleCluster = {
    id: 1,
    title: "Return of the Blossoming Blade",
    englishTitle: "Return of the Blossoming Blade",
    titles: ["Return of the Blossoming Blade", "Return of the Mount Hua Sect", "Hwasan Gwihwan"],
    popularity: 1000,
    country: "KR",
  };
  const titles = { lookup: async () => [cluster] } as unknown as AniListTitles;
  const updates = new UpdateService(library, new ProviderRegistry([md, suwa]), {} as PageService, {} as PushService, () => {}, titles);
  return { library, updates, suwa };
}

describe("UpdateService.relinkLibrary", () => {
  it("links library series to sources that know them under another name", async () => {
    const { library, updates } = setup();
    const id = await library.open("mangadex", "a");
    library.setInLibrary(U, id, true);

    expect(await updates.relinkLibrary()).toEqual({ checked: 1, linked: 1 });
    const linked = library.detailFromDb(id, U)!.sources.map((s) => s.externalId);
    expect(linked).toEqual(["a", "x"]);
  });

  it("skips series already matched against the same sources until they change", async () => {
    const { library, updates, suwa } = setup();
    const id = await library.open("mangadex", "a");
    library.setInLibrary(U, id, true);
    await updates.relinkLibrary();
    const before = suwa.searches;

    expect(await updates.relinkLibrary()).toEqual({ checked: 0, linked: 0 });
    expect(suwa.searches).toBe(before);

    suwa.sources = [...suwa.sources, src("suwayomi:2", "Toonily")];
    expect((await updates.relinkLibrary()).checked).toBe(1);
  });
});

describe("UpdateService.openByNames", () => {
  it("opens a series known only by its AniList names, preferring MangaDex", async () => {
    const { library, updates } = setup();
    const id = await updates.openByNames("Return of the Blossoming Blade", ["Return of the Mount Hua Sect"]);
    expect(id).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    const detail = library.detailFromDb(id!, U)!;
    expect(detail.sources.map((s) => s.sourceKey)).toEqual(["mangadex", "suwayomi:1"]);
  });

  it("returns null when no source has it", async () => {
    const { updates } = setup();
    expect(await updates.openByNames("Nothing Like This", [])).toBeNull();
  });
});

describe("searching sources by other names", () => {
  it("builds queries from the main title and other Latin-script names", async () => {
    const { searchQueries } = await import("../src/services/updates.js");
    expect(searchQueries(["Return of the Blossoming Blade", "Hwasan Gwihwan", "화산귀환", "Return of the Blossoming Blade!", "Return of the Mount Hua Sect"])).toEqual([
      "Return of the Blossoming Blade",
      "Hwasan Gwihwan",
      "Return of the Mount Hua Sect",
    ]);
  });

  it("finds a series on a source that only knows its romanized name", async () => {
    // This source's search only matches what you type, and it only knows the Korean romanization.
    class Strict extends Fake {
      override async search(_s?: string, q?: string) {
        this.searches++;
        return q === "Hwasan Gwihwan" ? [{ externalId: "r", title: "Hwasan Gwihwan", coverUrl: null }] : [];
      }
    }
    const strict = new Strict("suwayomi", [src("suwayomi:9", "Romaji Scans")], {
      r: raw("Hwasan Gwihwan", "r"),
    });
    const registry = new ProviderRegistry([strict]);
    const library = new LibraryService(openMemoryDb(), registry, (_k, u) => u);
    const updates = new UpdateService(library, registry, {} as PageService, {} as PushService, () => {});
    const id = await updates.openByNames("Return of the Blossoming Blade", ["Hwasan Gwihwan"]);
    expect(id).not.toBeNull();
    expect(library.detailFromDb(id!, U)!.sources[0]!.externalId).toBe("r");
    expect(strict.searches).toBe(2);
  });
});
