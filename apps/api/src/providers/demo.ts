import type { SourceInfo } from "@hanyo/types";
import sharp from "sharp";
import type { Provider, RawHit, RawSeries } from "./types.js";

/**
 * Offline stand-in for MangaDex, used by the end-to-end tests (HANYO_DEMO_SOURCE=1).
 * Serves a few series whose pages are generated images, so the whole app (search, library,
 * reader, downloads) can be exercised without any network.
 */
const SERIES = [
  { id: "strip", title: "Demo Strip", chapters: 3, pages: 4, w: 720, h: 2600 },
  { id: "paged", title: "Demo Paged", chapters: 2, pages: 5, w: 800, h: 1150 },
];
const COLORS = ["#8e7cff", "#ff8a73", "#5fd3a5", "#f5c451", "#6bb7ff"];

export class DemoProvider implements Provider {
  readonly id = "mangadex" as const;

  async listSources(): Promise<SourceInfo[]> {
    return [{ key: "mangadex", provider: "mangadex", sourceId: "mangadex", name: "Demo", lang: "en", iconUrl: null }];
  }

  private hit(s: (typeof SERIES)[number]): RawHit {
    return { externalId: s.id, title: s.title, coverUrl: `demo://cover/${s.id}` };
  }

  async search(_sourceId: string, query: string): Promise<RawHit[]> {
    const q = query.toLowerCase();
    return SERIES.filter((s) => s.title.toLowerCase().includes(q)).map((s) => this.hit(s));
  }

  async browse() {
    return { hits: SERIES.map((s) => this.hit(s)), hasNextPage: false };
  }

  async getSeries(_sourceId: string, externalId: string): Promise<RawSeries> {
    const s = SERIES.find((x) => x.id === externalId);
    if (!s) throw new Error("not found");
    return {
      externalId: s.id,
      title: s.title,
      coverUrl: `demo://cover/${s.id}`,
      description: `${s.title}: generated pages for tests.`,
      authors: ["Hanyo"],
      genres: s.id === "strip" ? ["Long Strip", "Action"] : ["Action"],
      status: "ongoing",
      url: null,
      chapters: Array.from({ length: s.chapters }, (_, i) => ({
        externalId: `${s.id}:${i + 1}`,
        number: i + 1,
        title: null,
        scanlator: "Demo",
        publishedAt: Date.UTC(2026, 0, i + 1),
        sourceOrder: i,
      })),
    };
  }

  async getPageUrls(_sourceId: string, chapterExternalId: string): Promise<string[]> {
    const s = SERIES.find((x) => chapterExternalId.startsWith(`${x.id}:`))!;
    return Array.from({ length: s.pages }, (_, i) => `demo://page/${chapterExternalId}/${i}`);
  }

  async fetchImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    const [, kind, a, b] = url.match(/^demo:\/\/(cover|page)\/([^/]+)(?:\/(\d+))?$/) ?? [];
    const s = SERIES.find((x) => (kind === "cover" ? x.id === a : a?.startsWith(`${x.id}:`)));
    if (!s) throw new Error("not found");
    const [w, h] = kind === "cover" ? [300, 400] : [s.w, s.h];
    const color = COLORS[(Number(b ?? 0) + (kind === "cover" ? 2 : 0)) % COLORS.length]!;
    const bytes = await sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
    return { bytes, contentType: "image/png" };
  }

  allowsImageUrl(url: string): boolean {
    return url.startsWith("demo://");
  }
}
