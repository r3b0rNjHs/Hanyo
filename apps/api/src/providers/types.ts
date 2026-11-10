import type { SeriesStatus, SourceInfo } from "@hanyo/types";

export interface RawHit {
  externalId: string;
  title: string;
  altTitles?: string[];
  /** Absolute upstream URL. The API wraps it into a signed same-origin proxy URL. */
  coverUrl: string | null;
}

export interface RawChapter {
  externalId: string;
  number: number | null;
  title: string | null;
  scanlator: string | null;
  publishedAt: number | null;
  /** Position as reported by the source, used to order chapters with no number. */
  sourceOrder: number;
}

export interface RawSeries {
  externalId: string;
  title: string;
  coverUrl: string | null;
  description: string | null;
  authors: string[];
  genres: string[];
  status: SeriesStatus;
  url: string | null;
  chapters: RawChapter[];
}

/**
 * A provider is a backend that exposes one or more sources.
 * - MangaDex provider: exactly one source, talks to api.mangadex.org directly.
 * - Suwayomi provider: one source per installed Mihon extension (Weeb Central, Comix, ...).
 */
export interface Provider {
  readonly id: "mangadex" | "suwayomi";
  listSources(): Promise<SourceInfo[]>;
  search(sourceId: string, query: string): Promise<RawHit[]>;
  /** One page (1-based) of the source's popular or recently updated series. */
  browse(sourceId: string, kind: "popular" | "latest", page: number): Promise<{ hits: RawHit[]; hasNextPage: boolean }>;
  getSeries(sourceId: string, externalId: string): Promise<RawSeries>;
  /** Absolute upstream image URLs for a chapter, in reading order. May expire (MangaDex ~15 min). */
  getPageUrls(sourceId: string, chapterExternalId: string): Promise<string[]>;
  /** Fetch an upstream image (page or cover) with whatever headers the provider needs. */
  fetchImage(url: string): Promise<{ bytes: Buffer; contentType: string }>;
  /** Hosts this provider may serve images from (guards the image proxy). */
  allowsImageUrl(url: string): boolean;
  /**
   * Image URLs the phone can load itself, for sources whose image host blocks the server.
   * Returns null when the source has no such mode.
   */
  directPageUrls?(sourceId: string, chapterExternalId: string): Promise<string[] | null>;
}

export function sourceKey(provider: Provider["id"], sourceId: string): string {
  return provider === "mangadex" ? "mangadex" : `suwayomi:${sourceId}`;
}

export function parseSourceKey(key: string): { provider: Provider["id"]; sourceId: string } {
  if (key === "mangadex") return { provider: "mangadex", sourceId: "mangadex" };
  if (key.startsWith("suwayomi:")) return { provider: "suwayomi", sourceId: key.slice("suwayomi:".length) };
  throw new Error(`Unknown source key: ${key}`);
}
