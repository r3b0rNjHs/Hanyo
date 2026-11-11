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
  /** Whether the source has a "latest updates" listing (Explore → Novedades). */
  supportsLatest?: boolean;
}

/** A single search hit on one source. */
export interface SearchHit {
  sourceKey: string;
  sourceName: string;
  /** Normalized language of the source ("en", "es"). */
  lang: string;
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

export type ExploreKind = "popular" | "latest";

/** One page of a source's own catalogue (popular / recently updated). */
export interface ExploreResponse {
  source: SourceInfo;
  kind: ExploreKind;
  page: number;
  hits: SearchHit[];
  hasNextPage: boolean;
}

/** Country of origin filter for AniList trending: KR manhwa, JP manga, CN manhua. */
export type TrendingOrigin = "KR" | "JP" | "CN" | "all";

/** AniList ordering for Explore → Tendencias. */
export type TrendingSort = "trending" | "popular" | "score";

/** What is being read right now across the community (AniList trending), source-independent. */
export interface TrendingResponse {
  page: number;
  hasNextPage: boolean;
  items: { cluster: TitleCluster; coverUrl: string | null }[];
}

/** AniList entries like a series ("Si te gusta esto…"), source-independent. */
export interface RecommendationsResponse {
  items: { cluster: TitleCluster; coverUrl: string | null }[];
}

export interface SeriesSourceLink {
  id: number;
  sourceKey: string;
  sourceName: string;
  /** Normalized language of the source ("en", "es"). */
  lang: string;
  externalId: string;
  url: string | null;
  chapterCount: number;
  latestChapter: number | null;
  /** Lower = preferred when two sources have the same chapter number. */
  priority: number;
}

/** Reading list a library series is on. */
export type Shelf = "reading" | "plan" | "paused" | "completed";

export interface SeriesSummary {
  id: number;
  title: string;
  coverUrl: string | null;
  status: SeriesStatus;
  inLibrary: boolean;
  /** Reading list (meaningful only while inLibrary). */
  shelf: Shelf;
  /** Download new chapters by themselves when the app is opened. */
  autoDownload: boolean;
  /** Push notification when this series gets new chapters. */
  notify: boolean;
  unreadCount: number;
  latestChapter: number | null;
  lastReadChapter: number | null;
  /** First unread chapter that actually exists (sources often have gaps). */
  nextChapter: number | null;
  updatedAt: number;
  /** When you last read it (progress saved), null if never. */
  lastReadAt: number | null;
}

export interface SeriesDetail extends SeriesSummary {
  /** Language the series is read in; only sources in this language feed the chapter list. */
  lang: string;
  /** Languages available among the linked sources (to offer a switch). */
  availableLangs: string[];
  description: string | null;
  authors: string[];
  genres: string[];
  sources: SeriesSourceLink[];
  /** Scanlation group to prefer when a chapter exists in several (null = automatic). */
  preferredScanlator: string | null;
  /** Groups that translated this series (in its language), most chapters first. */
  scanlators: { name: string; chapters: number }[];
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
  /** How far into that page (0–1) the top of the screen was: long strips are one tall "page". */
  offset: number;
}

export interface ChapterPages {
  chapterId: number;
  seriesId: number;
  seriesTitle: string;
  seriesCover: string | null;
  genres: string[];
  chapterNumber: number | null;
  chapterTitle: string | null;
  sourceName: string;
  /** Page index to resume at when this chapter is the series' resume point. */
  resumePage: number | null;
  /** Position within the resume page (0–1), see ResumePoint.offset. */
  resumeOffset: number | null;
  /**
   * Same-origin URLs (/api/chapters/:id/pages/:n), stable so they can be cached offline.
   * When `direct` is true they are the source's own image URLs instead: its image host blocks
   * the server, so the phone loads them itself (no re-encoding, opaque when downloaded).
   */
  pages: string[];
  /** Height/width of each page when the server has seen it, so the reader can reserve the exact space. */
  ratios?: (number | null)[];
  direct: boolean;
  prevChapterId: number | null;
  nextChapterId: number | null;
  /** Number of the next chapter in the merged list (sources often skip numbers). */
  nextChapterNumber: number | null;
}

/** One chapter in the "Novedades" feed (latest chapters across the library). */
export interface FeedItem {
  seriesId: number;
  seriesTitle: string;
  coverUrl: string | null;
  chapter: ChapterSummary;
}

/** Where you left each series, most recent first (the Historial view). */
export interface HistoryItem {
  seriesId: number;
  seriesTitle: string;
  coverUrl: string | null;
  chapterId: number;
  chapterNumber: number | null;
  page: number;
  readAt: number;
}

export interface ProgressUpdate {
  chapterId: number;
  page: number;
  /** Position within the page (0–1). */
  offset?: number;
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

/** Server health for the settings screen. */
export interface ServerStats {
  uptimeSec: number;
  cache: { bytes: number; maxBytes: number };
  library: { series: number; chapters: number };
  sources: number;
}

/** Result of the daily check of a source (can it list its popular series?). */
export interface SourceHealth {
  sourceKey: string;
  name: string;
  lang: string;
  ok: boolean;
  error: string | null;
  checkedAt: number;
  /** Consecutive failed checks. */
  failures: number;
}

export interface ApiError {
  error: string;
}
