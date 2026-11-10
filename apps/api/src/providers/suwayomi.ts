import type { SeriesStatus, SourceInfo } from "@hanyo/types";
import { fetchOk } from "../lib/http.js";
import { RateLimiter } from "../lib/ratelimit.js";
import { parseChapterNumber } from "../lib/text.js";
import { DIRECT_SOURCES, type DirectImageSource } from "./direct.js";
import type { Provider, RawChapter, RawHit, RawSeries } from "./types.js";

/**
 * Suwayomi-Server (https://github.com/Suwayomi/Suwayomi-Server) runs Mihon extensions
 * (Weeb Central, Comix, Asura Scans, ...) and exposes them over GraphQL.
 * It only listens on localhost on the VPS; hanyo-api is its sole client.
 *
 * Verified against Suwayomi-Server v2.4.2366 schema.
 */
export class SuwayomiProvider implements Provider {
  readonly id = "suwayomi" as const;
  /** Extensions do their own throttling; this only avoids hammering the JVM. */
  private readonly limiter = new RateLimiter(8, 1000);
  private sourcesCache: { at: number; value: SourceInfo[] } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly allowedSourceIds: string[] = [],
    /** Source languages to offer (Suwayomi codes; "es" also matches "es-419"). */
    private readonly langs: string[] = ["en", "es"],
    private readonly directSources: DirectImageSource[] = DIRECT_SOURCES,
  ) {}

  async listSources(): Promise<SourceInfo[]> {
    if (this.sourcesCache && Date.now() - this.sourcesCache.at < 5 * 60_000) return this.sourcesCache.value;
    const data = await this.gql<{
      sources: { nodes: Array<{ id: string; displayName: string; name: string; lang: string; iconUrl: string }> };
    }>(`query { sources { nodes { id name displayName lang iconUrl } } }`);
    const value = data.sources.nodes
      // "0" is Suwayomi's Local source; MangaDex is handled natively by hanyo-api.
      .filter((s) => s.id !== "0" && s.name.toLowerCase() !== "mangadex")
      .filter((s) => s.lang === "all" || this.langs.some((l) => s.lang === l || s.lang.startsWith(`${l}-`)))
      .filter((s) => this.allowedSourceIds.length === 0 || this.allowedSourceIds.includes(s.id))
      // Some extensions publish the same site as "all" and per language (Manhwa18.cc): keep the
      // language-specific one so search doesn't query the site twice.
      .filter((s, _i, list) => s.lang !== "all" || !list.some((o) => o.name === s.name && o.lang !== "all"))
      .map<SourceInfo>((s) => ({
        key: `suwayomi:${s.id}`,
        provider: "suwayomi",
        sourceId: s.id,
        name: s.name,
        lang: s.lang,
        iconUrl: s.iconUrl ? this.abs(s.iconUrl) : null,
      }));
    this.sourcesCache = { at: Date.now(), value };
    return value;
  }

  async search(sourceId: string, query: string): Promise<RawHit[]> {
    const data = await this.gql<{
      fetchSourceManga: { mangas: Array<{ id: number; title: string; thumbnailUrl: string | null }> };
    }>(
      `mutation($source: LongString!, $query: String) {
        fetchSourceManga(input: { source: $source, type: SEARCH, page: 1, query: $query }) {
          mangas { id title thumbnailUrl }
        }
      }`,
      { source: sourceId, query },
    );
    return data.fetchSourceManga.mangas.map((m) => ({
      externalId: String(m.id),
      title: m.title,
      coverUrl: m.thumbnailUrl ? this.abs(m.thumbnailUrl) : null,
    }));
  }

  async browse(sourceId: string, kind: "popular" | "latest", page: number) {
    const data = await this.gql<{
      fetchSourceManga: { hasNextPage: boolean; mangas: Array<{ id: number; title: string; thumbnailUrl: string | null }> };
    }>(
      `mutation($source: LongString!, $type: FetchSourceMangaType!, $page: Int!) {
        fetchSourceManga(input: { source: $source, type: $type, page: $page }) {
          hasNextPage
          mangas { id title thumbnailUrl }
        }
      }`,
      { source: sourceId, type: kind === "popular" ? "POPULAR" : "LATEST", page },
    );
    return {
      hits: data.fetchSourceManga.mangas.map((m) => ({
        externalId: String(m.id),
        title: m.title,
        coverUrl: m.thumbnailUrl ? this.abs(m.thumbnailUrl) : null,
      })),
      hasNextPage: data.fetchSourceManga.hasNextPage,
    };
  }

  async getSeries(_sourceId: string, externalId: string): Promise<RawSeries> {
    const data = await this.gql<{
      fetchMangaAndChapters: {
        manga: {
          id: number;
          title: string;
          thumbnailUrl: string | null;
          description: string | null;
          author: string | null;
          artist: string | null;
          genre: string[];
          status: string;
          realUrl: string | null;
        };
        chapters: Array<{
          id: number;
          name: string;
          chapterNumber: number;
          scanlator: string | null;
          uploadDate: string;
          sourceOrder: number;
        }>;
      };
    }>(
      `mutation($id: Int!) {
        fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) {
          manga { id title thumbnailUrl description author artist genre status realUrl }
          chapters { id name chapterNumber scanlator uploadDate sourceOrder }
        }
      }`,
      { id: Number.parseInt(externalId, 10) },
    );
    const { manga, chapters } = data.fetchMangaAndChapters;
    const people = [manga.author, manga.artist]
      .flatMap((p) => (p ?? "").split(","))
      .map((p) => p.trim())
      .filter(Boolean);

    return {
      externalId,
      title: manga.title,
      coverUrl: manga.thumbnailUrl ? this.abs(manga.thumbnailUrl) : null,
      description: manga.description,
      authors: [...new Set(people)],
      genres: manga.genre,
      status: mapStatus(manga.status),
      url: manga.realUrl,
      chapters: chapters.map<RawChapter>((c) => ({
        externalId: String(c.id),
        // Extensions use -1 for "unknown"; fall back to parsing the name.
        number: c.chapterNumber >= 0 ? c.chapterNumber : parseChapterNumber(c.name),
        title: c.name || null,
        scanlator: c.scanlator || null,
        publishedAt: Number(c.uploadDate) || null,
        sourceOrder: c.sourceOrder,
      })),
    };
  }

  async getPageUrls(_sourceId: string, chapterExternalId: string): Promise<string[]> {
    const data = await this.gql<{ fetchChapterPages: { pages: string[] } }>(
      `mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }`,
      { id: Number.parseInt(chapterExternalId, 10) },
    );
    return data.fetchChapterPages.pages.map((p) => this.abs(p));
  }

  async directPageUrls(sourceId: string, chapterExternalId: string): Promise<string[] | null> {
    const name = (await this.listSources()).find((s) => s.sourceId === sourceId)?.name;
    const direct = this.directSources.find((d) => d.sourceName === name);
    if (!direct) return null;
    const data = await this.gql<{ chapter: { url: string; realUrl: string | null } }>(
      `query($id: Int!) { chapter(id: $id) { url realUrl } }`,
      { id: Number.parseInt(chapterExternalId, 10) },
    );
    return direct.pageUrls(data.chapter.realUrl ?? data.chapter.url);
  }

  async fetchImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    const res = await this.limiter.schedule(() => fetchOk(url, { timeoutMs: 60_000 }));
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  }

  allowsImageUrl(url: string): boolean {
    return new URL(url).origin === new URL(this.baseUrl).origin;
  }

  private abs(pathOrUrl: string): string {
    return new URL(pathOrUrl, this.baseUrl).toString();
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.limiter.schedule(() =>
      fetchOk(`${this.baseUrl}/api/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        timeoutMs: 45_000,
      }),
    );
    const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      // Suwayomi includes full stack traces in messages; keep the first line.
      throw new Error(json.errors.map((e) => e.message.split("\n")[0]).join("; "));
    }
    if (!json.data) throw new Error("Suwayomi returned no data");
    return json.data;
  }
}

function mapStatus(s: string): SeriesStatus {
  switch (s) {
    case "ONGOING":
      return "ongoing";
    case "COMPLETED":
    case "PUBLISHING_FINISHED":
      return "completed";
    case "ON_HIATUS":
      return "hiatus";
    case "CANCELLED":
      return "cancelled";
    default:
      return "unknown";
  }
}
