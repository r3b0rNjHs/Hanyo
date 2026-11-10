// Shared DTOs between hanyo-api and the web app.
// Keep this file dependency-free: it is consumed as raw TypeScript by both sides.

export type ProviderId = "mangadex" | "suwayomi";

export type SeriesStatus =
  | "ongoing"
  | "completed"
  | "hiatus"
  | "cancelled"
  | "unknown";

/** A place a series can be read from (MangaDex, or one Suwayomi source like "Weeb Central"). */
export interface SourceInfo {
  /** Stable key: "mangadex" or "suwayomi:<sourceId>" */
  key: string;
  provider: ProviderId;
  sourceId: string;
  name: string;
  lang: string;
  iconUrl: string | null;
}

/** A single search hit on one source. */
export interface SearchHit {
  sourceKey: string;
  sourceName: string;
  externalId: string;
  title: string;
  /** Other names the source knows (MangaDex gives many); used to merge the same series across sources. */
  altTitles?: string[];
  coverUrl: string | null;
}

/** One series as known by AniList: every name it goes by, plus popularity for ranking. */
export interface TitleCluster {
  id: number;
  /** Main title (English when available, else romanized). */
  title: string;
  /** Official English title, if AniList has one. */
  englishTitle: string | null;
  titles: string[];
  popularity: number;
  country: string | null;
}

export interface SearchMetaResponse {
  clusters: TitleCluster[];
}

export interface SearchResponse {
  source: SourceInfo;
  hits: SearchHit[];
  error?: string;
}

export interface SeriesSourceLink {
  id: number;
  sourceKey: string;
  sourceName: string;
  externalId: string;
  url: string | null;
  chapterCount: number;
  latestChapter: number | null;
  /** Lower = preferred when two sources have the same chapter number. */
  priority: number;
}

export interface SeriesSummary {
  id: number;
  title: string;
  coverUrl: string | null;
  status: SeriesStatus;
  inLibrary: boolean;
  unreadCount: number;
  latestChapter: number | null;
  lastReadChapter: number | null;
  /** First unread chapter that actually exists (sources often have gaps). */
  nextChapter: number | null;
  updatedAt: number;
}

export interface SeriesDetail extends SeriesSummary {
  description: string | null;
  authors: string[];
  genres: string[];
  sources: SeriesSourceLink[];
  /** Merged, de-duplicated chapter list (one entry per chapter number), ascending. */
  chapters: ChapterSummary[];
  resume: ResumePoint | null;
}

export interface ChapterSummary {
  id: number;
  seriesId: number;
  number: number | null;
  title: string | null;
  scanlator: string | null;
  sourceKey: string;
  sourceName: string;
  publishedAt: number | null;
  read: boolean;
  /** Other chapter ids with the same number on other sources (alternatives). */
  alternatives: number[];
}

export interface ResumePoint {
  chapterId: number;
  chapterNumber: number | null;
  page: number;
}

export interface ChapterPages {
  chapterId: number;
  seriesId: number;
  seriesTitle: string;
  genres: string[];
  chapterNumber: number | null;
  chapterTitle: string | null;
  sourceName: string;
  /** Page index to resume at when this chapter is the series' resume point. */
  resumePage: number | null;
  /** Same-origin URLs (/api/chapters/:id/pages/:n). Stable, so they can be cached offline. */
  pages: string[];
  prevChapterId: number | null;
  nextChapterId: number | null;
}

export interface ProgressUpdate {
  chapterId: number;
  page: number;
  completed: boolean;
}

export interface OpenSeriesRequest {
  sourceKey: string;
  externalId: string;
}

export interface UpdateCheckResult {
  checkedSeries: number;
  newChapters: number;
  errors: string[];
}

export interface ApiError {
  error: string;
}
