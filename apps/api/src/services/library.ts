import type {
  ChapterSummary,
  FeedItem,
  HistoryItem,
  ResumePoint,
  SeriesDetail,
  SeriesSourceLink,
  SeriesStatus,
  SeriesSummary,
  Shelf,
} from "@hanyo/types";
import type { DB } from "../db/index.js";
import { normalizeTitle } from "../lib/text.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { RawSeries } from "../providers/types.js";

/** A series as one user sees it: shared columns + that user's own (user_series) values. */
interface SeriesRow {
  id: number;
  title: string;
  cover_url: string | null;
  description: string | null;
  authors: string;
  genres: string;
  status: SeriesStatus;
  in_library: number;
  added_at: number | null;
  last_checked_at: number | null;
  updated_at: number;
  lang: string;
  shelf: Shelf;
  auto_download: number;
  notify: number;
  preferred_scanlator: string | null;
}

/** "es-419" → "es"; multi-language ("all") sources are read as English. */
export function normLang(lang: string | undefined): string {
  if (!lang || lang === "all") return "en";
  return lang.split("-")[0]!.toLowerCase();
}

interface SourceRow {
  id: number;
  series_id: number;
  source_key: string;
  source_name: string;
  external_id: string;
  url: string | null;
  priority: number;
  last_fetched_at: number | null;
  lang: string;
}

interface ChapterRow {
  id: number;
  series_source_id: number;
  external_id: string;
  number: number | null;
  title: string | null;
  scanlator: string | null;
  published_at: number | null;
  source_order: number;
  first_seen_at: number;
}

export interface CoverWrapper {
  (sourceKey: string, upstreamUrl: string | null): string | null;
}

/**
 * Per-user view of a series row. uid 0 is "nobody": defaults only (used by background jobs that
 * work on the shared catalogue, e.g. auto-linking or prefetch).
 */
const USER_ROW = `SELECT s.id, s.title, s.cover_url, s.description, s.authors, s.genres, s.status, s.last_checked_at,
    s.updated_at, COALESCE(us.lang, s.lang) AS lang,
    COALESCE(us.in_library, 0) AS in_library, COALESCE(us.shelf, 'reading') AS shelf,
    COALESCE(us.auto_download, 0) AS auto_download, COALESCE(us.notify, 1) AS notify,
    us.preferred_scanlator, us.added_at
  FROM series s LEFT JOIN user_series us ON us.series_id = s.id AND us.user_id = ?`;

/** How long a source's chapter list is considered fresh when opening a series page. */
const CHAPTERS_TTL_MS = 30 * 60_000;

export class LibraryService {
  constructor(
    private readonly db: DB,
    private readonly registry: ProviderRegistry,
    private readonly wrapCover: CoverWrapper,
  ) {}

  /** For read-only reports (stats) that query several tables at once. */
  get database(): DB {
    return this.db;
  }

  /**
   * Open a series from a search hit. Creates (or reuses) our series + source link
   * and fetches details/chapters. Returns our series id.
   */
  async open(sourceKey: string, externalId: string): Promise<number> {
    const existing = this.db
      .prepare<[string, string], SourceRow>("SELECT * FROM series_sources WHERE source_key = ? AND external_id = ?")
      .get(sourceKey, externalId);
    if (existing) {
      await this.refreshSourceIfStale(existing);
      return existing.series_id;
    }

    const { provider, sourceId } = this.registry.resolve(sourceKey);
    const raw = await provider.getSeries(sourceId, externalId);
    const info = (await this.registry.listSources()).find((s) => s.key === sourceKey);
    const sourceName = info?.name ?? sourceKey;
    const lang = normLang(info?.lang);

    return this.db.transaction(() => {
      const now = Date.now();
      const seriesId = Number(
        this.db
          .prepare(
            `INSERT INTO series (title, cover_url, description, authors, genres, status, updated_at, lang)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            raw.title,
            this.wrapCover(sourceKey, raw.coverUrl),
            raw.description,
            JSON.stringify(raw.authors),
            JSON.stringify(raw.genres),
            raw.status,
            now,
            lang,
          ).lastInsertRowid,
      );
      const linkId = this.insertLink(seriesId, sourceKey, sourceName, lang, raw, sourceKey === "mangadex" ? 50 : 100);
      this.upsertChapters(linkId, raw);
      return seriesId;
    })();
  }

  /** Attach another source to an existing series (e.g. Weeb Central to fill MangaDex gaps). */
  async linkSource(seriesId: number, sourceKey: string, externalId: string): Promise<void> {
    const taken = this.db
      .prepare<[string, string], SourceRow>("SELECT * FROM series_sources WHERE source_key = ? AND external_id = ?")
      .get(sourceKey, externalId);
    if (taken) {
      if (taken.series_id !== seriesId) throw new Error("That source entry already belongs to another series");
      return;
    }
    const { provider, sourceId } = this.registry.resolve(sourceKey);
    const raw = await provider.getSeries(sourceId, externalId);
    const info = (await this.registry.listSources()).find((s) => s.key === sourceKey);
    const sourceName = info?.name ?? sourceKey;
    this.db.transaction(() => {
      const linkId = this.insertLink(seriesId, sourceKey, sourceName, normLang(info?.lang), raw, 100);
      this.upsertChapters(linkId, raw);
      this.db.prepare("UPDATE series SET updated_at = ? WHERE id = ?").run(Date.now(), seriesId);
    })();
  }

  /** Switch the language a series is read in. Progress is per chapter number, so it carries over. */
  setLang(uid: number, seriesId: number, lang: string): void {
    const has = this.db
      .prepare<[number, string], { n: number }>("SELECT COUNT(*) AS n FROM series_sources WHERE series_id = ? AND lang = ?")
      .get(seriesId, lang)!.n;
    if (!has) throw new Error(`No hay fuentes en ese idioma (${lang})`);
    this.setUser(uid, seriesId, { lang });
  }

  /** Upsert this user's own values for a series. */
  private setUser(
    uid: number,
    seriesId: number,
    v: Partial<{ in_library: number; shelf: Shelf; notify: number; auto_download: number; preferred_scanlator: string | null; lang: string; added_at: number }>,
  ): void {
    this.db.prepare("INSERT OR IGNORE INTO user_series (user_id, series_id) VALUES (?, ?)").run(uid, seriesId);
    for (const [k, val] of Object.entries(v)) {
      this.db.prepare(`UPDATE user_series SET ${k} = ? WHERE user_id = ? AND series_id = ?`).run(val, uid, seriesId);
    }
  }

  unlinkSource(seriesId: number, linkId: number): void {
    const count = this.db
      .prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM series_sources WHERE series_id = ?")
      .get(seriesId)!.n;
    if (count <= 1) throw new Error("A series needs at least one source");
    this.db.prepare("DELETE FROM series_sources WHERE id = ? AND series_id = ?").run(linkId, seriesId);
  }

  setPriority(seriesId: number, linkId: number, priority: number): void {
    this.db.prepare("UPDATE series_sources SET priority = ? WHERE id = ? AND series_id = ?").run(priority, linkId, seriesId);
  }

  /**
   * Re-fetch chapters for every source of a series. Returns newly seen chapter numbers
   * (numbers that did not exist on ANY source before), used for notifications.
   */
  async refresh(seriesId: number): Promise<{ newNumbers: number[]; errors: string[] }> {
    const before = new Set(this.chapterNumbers(seriesId));
    const errors: string[] = [];
    for (const link of this.links(seriesId)) {
      try {
        await this.refreshSource(link);
      } catch (e) {
        errors.push(`${link.source_name}: ${(e as Error).message}`);
      }
    }
    this.db.prepare("UPDATE series SET last_checked_at = ? WHERE id = ?").run(Date.now(), seriesId);
    const newNumbers = this.chapterNumbers(seriesId).filter((n) => !before.has(n));
    return { newNumbers, errors };
  }

  async refreshSourceIfStale(link: SourceRow): Promise<void> {
    if (link.last_fetched_at && Date.now() - link.last_fetched_at < CHAPTERS_TTL_MS) return;
    await this.refreshSource(link);
  }

  private async refreshSource(link: SourceRow): Promise<void> {
    const { provider, sourceId } = this.registry.resolve(link.source_key);
    const raw = await provider.getSeries(sourceId, link.external_id);
    this.db.transaction(() => {
      this.upsertChapters(link.id, raw);
      this.db
        .prepare(
          `UPDATE series SET description = COALESCE(description, ?), status = ?,
             cover_url = COALESCE(cover_url, ?) WHERE id = ?`,
        )
        .run(raw.description, raw.status, this.wrapCover(link.source_key, raw.coverUrl), link.series_id);
    })();
  }

  setInLibrary(uid: number, seriesId: number, inLibrary: boolean): void {
    this.setUser(uid, seriesId, { in_library: inLibrary ? 1 : 0 });
    if (inLibrary) {
      this.db
        .prepare("UPDATE user_series SET added_at = COALESCE(added_at, ?) WHERE user_id = ? AND series_id = ?")
        .run(Date.now(), uid, seriesId);
    }
  }

  /** Move a series to a reading list (adding it to the library if needed). */
  setShelf(uid: number, seriesId: number, shelf: Shelf): void {
    this.setInLibrary(uid, seriesId, true);
    this.setUser(uid, seriesId, { shelf });
  }

  setPageRatio(chapterId: number, index: number, ratio: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO page_sizes (chapter_id, idx, ratio) VALUES (?, ?, ?)")
      .run(chapterId, index, ratio);
  }

  /** Known page shapes for a chapter, null where the page hasn't been seen yet. */
  pageRatios(chapterId: number, count: number): (number | null)[] {
    const out: (number | null)[] = Array.from({ length: count }, () => null);
    for (const r of this.db
      .prepare<[number], { idx: number; ratio: number }>("SELECT idx, ratio FROM page_sizes WHERE chapter_id = ?")
      .all(chapterId)) {
      if (r.idx < count) out[r.idx] = r.ratio;
    }
    return out;
  }

  counts(): { series: number; chapters: number } {
    const one = (sql: string) => (this.db.prepare<[], { n: number }>(sql).get()?.n ?? 0);
    return {
      series: one("SELECT COUNT(DISTINCT series_id) AS n FROM user_series WHERE in_library = 1"),
      chapters: one(
        `SELECT COUNT(*) AS n FROM chapters c JOIN series_sources s ON s.id = c.series_source_id
         WHERE s.series_id IN (SELECT series_id FROM user_series WHERE in_library = 1)`,
      ),
    };
  }

  setPreferredScanlator(uid: number, seriesId: number, name: string | null): void {
    this.setUser(uid, seriesId, { preferred_scanlator: name?.trim() || null });
  }

  setNotify(uid: number, seriesId: number, enabled: boolean): void {
    this.setUser(uid, seriesId, { notify: enabled ? 1 : 0 });
  }

  /** Users who follow this series and want its new-chapter notifications. */
  usersToNotify(seriesId: number): number[] {
    return this.db
      .prepare<[number], { user_id: number }>(
        "SELECT user_id FROM user_series WHERE series_id = ? AND in_library = 1 AND notify = 1",
      )
      .all(seriesId)
      .map((r) => r.user_id);
  }

  setAutoDownload(uid: number, seriesId: number, enabled: boolean): void {
    this.setUser(uid, seriesId, { auto_download: enabled ? 1 : 0 });
  }

  listLibrary(uid: number): SeriesSummary[] {
    const rows = this.db
      .prepare<[number], SeriesRow>(`${USER_ROW} WHERE us.in_library = 1 ORDER BY s.updated_at DESC`)
      .all(uid);
    return rows.map((r) => this.summary(uid, r));
  }

  /** Every source entry of the library's series, so search and Explore can mark what you already have. */
  libraryLinks(uid: number): { sourceKey: string; externalId: string; seriesId: number }[] {
    return this.db
      .prepare<[number], { source_key: string; external_id: string; series_id: number }>(
        `SELECT ss.source_key, ss.external_id, ss.series_id FROM series_sources ss
         JOIN user_series us ON us.series_id = ss.series_id WHERE us.user_id = ? AND us.in_library = 1`,
      )
      .all(uid)
      .map((r) => ({ sourceKey: r.source_key, externalId: r.external_id, seriesId: r.series_id }));
  }

  /**
   * Latest chapters of the series you follow (Leyendo / En pausa; one per chapter number, in the
   * series' language), newest first. "Pendiente" and "Terminada" series would only add noise.
   */
  feed(uid: number, limit = 80): FeedItem[] {
    const items: FeedItem[] = [];
    for (const id of this.inLibraryIds(uid)) {
      const row = this.row(id, uid);
      if (!row || (row.shelf !== "reading" && row.shelf !== "paused")) continue;
      for (const c of this.mergedChapters(id, uid)) {
        if (c.publishedAt === null) continue;
        items.push({ seriesId: id, seriesTitle: row.title, coverUrl: row.cover_url, chapter: c });
      }
    }
    return items.sort((a, b) => b.chapter.publishedAt! - a.chapter.publishedAt!).slice(0, limit);
  }

  history(uid: number, limit = 60): HistoryItem[] {
    return this.db
      .prepare<
        [number, number],
        { series_id: number; title: string; cover_url: string | null; chapter_id: number; number: number | null; page: number; updated_at: number }
      >(
        `SELECT r.series_id, s.title, s.cover_url, r.chapter_id, c.number, r.page, r.updated_at
         FROM resume_points r JOIN series s ON s.id = r.series_id JOIN chapters c ON c.id = r.chapter_id
         WHERE r.user_id = ? ORDER BY r.updated_at DESC LIMIT ?`,
      )
      .all(uid, limit)
      .map((r) => ({
        seriesId: r.series_id,
        seriesTitle: r.title,
        coverUrl: r.cover_url,
        chapterId: r.chapter_id,
        chapterNumber: r.number,
        page: r.page,
        readAt: r.updated_at,
      }));
  }

  /** Remove a series from the history (forgets the resume point, keeps read marks). */
  forgetResume(uid: number, seriesId: number): void {
    this.db.prepare("DELETE FROM resume_points WHERE user_id = ? AND series_id = ?").run(uid, seriesId);
  }

  /** For the accounts list: library size and last reading activity of a user. */
  userActivity(uid: number): { librarySize: number; lastReadAt: number | null } {
    return {
      librarySize:
        this.db.prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM user_series WHERE user_id = ? AND in_library = 1").get(uid)?.n ?? 0,
      lastReadAt:
        this.db.prepare<[number], { t: number | null }>("SELECT MAX(updated_at) AS t FROM resume_points WHERE user_id = ?").get(uid)?.t ?? null,
    };
  }

  /** Library series of one user, or (no uid) of anyone: what the update checks keep fresh. */
  inLibraryIds(uid?: number): number[] {
    const rows =
      uid === undefined
        ? this.db.prepare<[], { id: number }>("SELECT DISTINCT series_id AS id FROM user_series WHERE in_library = 1").all()
        : this.db
            .prepare<[number], { id: number }>("SELECT series_id AS id FROM user_series WHERE user_id = ? AND in_library = 1")
            .all(uid);
    return rows.map((r) => r.id);
  }

  async detail(seriesId: number, uid: number): Promise<SeriesDetail | null> {
    const row = this.row(seriesId, uid);
    if (!row) return null;
    // Keep chapter lists reasonably fresh when the user opens a series.
    await Promise.allSettled(this.links(seriesId).map((l) => this.refreshSourceIfStale(l)));
    return this.detailFromDb(seriesId, uid);
  }

  detailFromDb(seriesId: number, uid: number): SeriesDetail | null {
    const row = this.row(seriesId, uid);
    if (!row) return null;
    const chapters = this.mergedChapters(seriesId, uid);
    const links = this.links(seriesId);
    const sources: SeriesSourceLink[] = links.map((l) => {
      const stats = this.db
        .prepare<[number], { n: number; latest: number | null }>(
          "SELECT COUNT(*) AS n, MAX(number) AS latest FROM chapters WHERE series_source_id = ?",
        )
        .get(l.id)!;
      return {
        id: l.id,
        sourceKey: l.source_key,
        sourceName: l.source_name,
        lang: l.lang,
        externalId: l.external_id,
        url: l.url,
        chapterCount: stats.n,
        latestChapter: stats.latest,
        priority: l.priority,
      };
    });
    return {
      ...this.summary(uid, row, chapters),
      lang: row.lang,
      availableLangs: [...new Set(links.map((l) => l.lang))].sort(),
      description: row.description,
      authors: JSON.parse(row.authors) as string[],
      genres: JSON.parse(row.genres) as string[],
      sources,
      preferredScanlator: row.preferred_scanlator,
      scanlators: this.db
        .prepare<[number, string], { name: string; n: number }>(
          `SELECT c.scanlator AS name, COUNT(DISTINCT c.number) AS n FROM chapters c
           JOIN series_sources s ON s.id = c.series_source_id
           WHERE s.series_id = ? AND s.lang = ? AND c.scanlator IS NOT NULL AND trim(c.scanlator) != ''
           GROUP BY lower(c.scanlator) ORDER BY n DESC LIMIT 12`,
        )
        .all(seriesId, row.lang)
        .map((r) => ({ name: r.name, chapters: r.n })),
      chapters,
      resume: this.resume(seriesId, uid),
    };
  }

  /**
   * One entry per chapter number across all sources. For each number the preferred scanlation
   * group wins if it has that chapter, then the preferred source (lowest priority value), then
   * the most recently published upload.
   * Chapters without a number are kept per source, ordered by source order.
   */
  mergedChapters(seriesId: number, uid: number): ChapterSummary[] {
    const row = this.row(seriesId, uid);
    if (!row) return [];
    const rows = this.db
      .prepare<[number, string], ChapterRow & { source_key: string; source_name: string; priority: number }>(
        `SELECT c.*, s.source_key, s.source_name, s.priority
         FROM chapters c JOIN series_sources s ON s.id = c.series_source_id
         WHERE s.series_id = ? AND s.lang = ?`,
      )
      .all(seriesId, row.lang);
    const pref = row.preferred_scanlator?.toLowerCase() ?? null;
    const prefRank = (s: string | null) => (pref && s?.toLowerCase() === pref ? 0 : 1);
    const read = new Set(
      this.db
        .prepare<[number, number], { number: number }>("SELECT number FROM read_marks WHERE user_id = ? AND series_id = ?")
        .all(uid, seriesId)
        .map((r) => r.number),
    );

    const byNumber = new Map<number, typeof rows>();
    const unnumbered: typeof rows = [];
    for (const r of rows) {
      if (r.number === null) unnumbered.push(r);
      else {
        const list = byNumber.get(r.number) ?? [];
        list.push(r);
        byNumber.set(r.number, list);
      }
    }

    const out: ChapterSummary[] = [];
    for (const [number, list] of byNumber) {
      list.sort(
        (a, b) =>
          prefRank(a.scanlator) - prefRank(b.scanlator) ||
          a.priority - b.priority ||
          (b.published_at ?? 0) - (a.published_at ?? 0),
      );
      const best = list[0]!;
      out.push({
        id: best.id,
        seriesId,
        number,
        title: best.title,
        scanlator: best.scanlator,
        sourceKey: best.source_key,
        sourceName: best.source_name,
        publishedAt: best.published_at,
        read: read.has(number),
        alternatives: list.slice(1).map((a) => a.id),
      });
    }
    out.sort((a, b) => a.number! - b.number!);
    for (const r of unnumbered.sort((a, b) => b.source_order - a.source_order)) {
      out.push({
        id: r.id,
        seriesId,
        number: null,
        title: r.title,
        scanlator: r.scanlator,
        sourceKey: r.source_key,
        sourceName: r.source_name,
        publishedAt: r.published_at,
        read: false,
        alternatives: [],
      });
    }
    return out;
  }

  chapterContext(chapterId: number, uid: number): {
    chapter: ChapterRow;
    link: SourceRow;
    prevId: number | null;
    nextId: number | null;
    nextNumber: number | null;
  } | null {
    const chapter = this.db.prepare<[number], ChapterRow>("SELECT * FROM chapters WHERE id = ?").get(chapterId);
    if (!chapter) return null;
    const link = this.db
      .prepare<[number], SourceRow>("SELECT * FROM series_sources WHERE id = ?")
      .get(chapter.series_source_id)!;
    const merged = this.mergedChapters(link.series_id, uid);
    // A chapter may be an "alternative" not present in the merged list; navigate by number then.
    let idx = merged.findIndex((c) => c.id === chapterId);
    if (idx < 0 && chapter.number !== null) idx = merged.findIndex((c) => c.number === chapter.number);
    return {
      chapter,
      link,
      prevId: idx > 0 ? merged[idx - 1]!.id : null,
      nextId: idx >= 0 && idx < merged.length - 1 ? merged[idx + 1]!.id : null,
      nextNumber: idx >= 0 && idx < merged.length - 1 ? merged[idx + 1]!.number : null,
    };
  }

  /**
   * The chapter itself followed by the same chapter number on the series' other sources,
   * preferred sources first: what to try when a source can't deliver a chapter's pages.
   */
  chapterCandidates(chapterId: number, uid: number): Array<{ id: number; sourceName: string }> {
    const ctx = this.chapterContext(chapterId, uid);
    if (!ctx) return [];
    const self = { id: chapterId, sourceName: ctx.link.source_name };
    if (ctx.chapter.number === null) return [self];
    const row = this.row(ctx.link.series_id, uid)!;
    const pref = row.preferred_scanlator;
    const others = this.db
      .prepare<[number, number, number, string, string | null, string | null], { id: number; source_name: string }>(
        `SELECT c.id, s.source_name FROM chapters c JOIN series_sources s ON s.id = c.series_source_id
         WHERE s.series_id = ? AND c.number = ? AND c.id != ? AND s.lang = ?
         ORDER BY (? IS NOT NULL AND lower(c.scanlator) = lower(?)) DESC, s.priority, c.published_at DESC`,
      )
      .all(ctx.link.series_id, ctx.chapter.number, chapterId, row.lang, pref, pref);
    return [self, ...others.map((o) => ({ id: o.id, sourceName: o.source_name }))];
  }

  saveProgress(uid: number, chapterId: number, page: number, completed: boolean, offset = 0): void {
    const ctx = this.chapterContext(chapterId, uid);
    if (!ctx) throw new Error("Chapter not found");
    const seriesId = ctx.link.series_id;
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO resume_points (user_id, series_id, chapter_id, page, page_offset, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, series_id) DO UPDATE SET chapter_id = excluded.chapter_id, page = excluded.page,
             page_offset = excluded.page_offset, updated_at = excluded.updated_at`,
        )
        .run(
          uid,
          seriesId,
          completed && ctx.nextId ? ctx.nextId : chapterId,
          completed ? 0 : page,
          completed ? 0 : Math.min(1, Math.max(0, offset)),
          now,
        );
      // Opening a planned or paused series in the reader means you're reading it now.
      this.db
        .prepare("UPDATE user_series SET shelf = 'reading' WHERE user_id = ? AND series_id = ? AND shelf IN ('plan', 'paused')")
        .run(uid, seriesId);
      if (completed && ctx.chapter.number !== null) {
        this.db
          .prepare("INSERT OR IGNORE INTO read_marks (user_id, series_id, number, read_at) VALUES (?, ?, ?, ?)")
          .run(uid, seriesId, ctx.chapter.number, now);
      }
    })();
  }

  /** Mark every chapter up to and including `number` as read (or unread). */
  markRead(uid: number, seriesId: number, numbers: number[], read: boolean): void {
    const now = Date.now();
    const ins = this.db.prepare("INSERT OR IGNORE INTO read_marks (user_id, series_id, number, read_at) VALUES (?, ?, ?, ?)");
    const del = this.db.prepare("DELETE FROM read_marks WHERE user_id = ? AND series_id = ? AND number = ?");
    this.db.transaction(() => {
      for (const n of numbers) {
        if (read) ins.run(uid, seriesId, n, now);
        else del.run(uid, seriesId, n);
      }
    })();
  }

  /** Find library series whose normalized title matches; used to suggest source links. */
  findByTitle(title: string): number[] {
    const norm = normalizeTitle(title);
    return this.db
      .prepare<[], { id: number; title: string }>("SELECT id, title FROM series")
      .all()
      .filter((r) => normalizeTitle(r.title) === norm)
      .map((r) => r.id);
  }

  seriesBasics(seriesId: number, uid: number): { title: string; cover: string | null; genres: string[]; resume: ResumePoint | null } {
    const row = this.row(seriesId, uid);
    if (!row) throw new Error("Series not found");
    return {
      title: row.title,
      cover: row.cover_url,
      genres: JSON.parse(row.genres) as string[],
      resume: this.resume(seriesId, uid),
    };
  }

  /** Fingerprint of the source set a series was last searched against (see UpdateService.relinkLibrary). */
  linkedAgainst(seriesId: number): string | null {
    return (
      this.db.prepare<[number], { linked_against: string | null }>("SELECT linked_against FROM series WHERE id = ?").get(seriesId)
        ?.linked_against ?? null
    );
  }

  setLinkedAgainst(seriesId: number, fingerprint: string): void {
    this.db.prepare("UPDATE series SET linked_against = ? WHERE id = ?").run(fingerprint, seriesId);
  }

  title(seriesId: number): string | null {
    return this.row(seriesId, 0)?.title ?? null;
  }

  private resume(seriesId: number, uid: number): ResumePoint | null {
    const r = this.db
      .prepare<[number, number], { chapter_id: number; page: number; page_offset: number }>(
        "SELECT chapter_id, page, page_offset FROM resume_points WHERE user_id = ? AND series_id = ?",
      )
      .get(uid, seriesId);
    if (!r) return null;
    const ch = this.db.prepare<[number], ChapterRow>("SELECT * FROM chapters WHERE id = ?").get(r.chapter_id);
    if (!ch) return null;
    return { chapterId: r.chapter_id, chapterNumber: ch.number, page: r.page, offset: r.page_offset };
  }

  private summary(uid: number, row: SeriesRow, merged?: ChapterSummary[]): SeriesSummary {
    const chapters = merged ?? this.mergedChapters(row.id, uid);
    const numbered = chapters.filter((c) => c.number !== null);
    const lastRead = this.db
      .prepare<[number, number], { n: number | null }>("SELECT MAX(number) AS n FROM read_marks WHERE user_id = ? AND series_id = ?")
      .get(uid, row.id)!.n;
    return {
      id: row.id,
      title: row.title,
      coverUrl: row.cover_url,
      status: row.status,
      inLibrary: row.in_library === 1,
      shelf: row.shelf,
      autoDownload: row.auto_download === 1,
      notify: row.notify === 1,
      unreadCount: numbered.filter((c) => !c.read).length,
      latestChapter: numbered.length ? numbered[numbered.length - 1]!.number : null,
      lastReadChapter: lastRead,
      nextChapter: numbered.find((c) => !c.read && (lastRead === null || c.number! > lastRead))?.number ?? null,
      updatedAt: row.updated_at,
      lastReadAt:
        this.db
          .prepare<[number, number], { t: number }>("SELECT updated_at AS t FROM resume_points WHERE user_id = ? AND series_id = ?")
          .get(uid, row.id)?.t ?? null,
    };
  }

  private insertLink(seriesId: number, sourceKey: string, sourceName: string, lang: string, raw: RawSeries, priority: number): number {
    return Number(
      this.db
        .prepare(
          `INSERT INTO series_sources (series_id, source_key, source_name, external_id, url, priority, last_fetched_at, lang)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(seriesId, sourceKey, sourceName, raw.externalId, raw.url, priority, Date.now(), lang).lastInsertRowid,
    );
  }

  /** Insert new chapters and update metadata of known ones. Returns how many were new. */
  private upsertChapters(linkId: number, raw: RawSeries): number {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO chapters (series_source_id, external_id, number, title, scanlator, published_at, source_order, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(series_source_id, external_id) DO UPDATE SET
         number = excluded.number, title = excluded.title, scanlator = excluded.scanlator,
         published_at = excluded.published_at, source_order = excluded.source_order`,
    );
    const before = this.db
      .prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM chapters WHERE series_source_id = ?")
      .get(linkId)!.n;
    for (const c of raw.chapters) {
      stmt.run(linkId, c.externalId, c.number, c.title, c.scanlator, c.publishedAt, c.sourceOrder, now);
    }
    this.db.prepare("UPDATE series_sources SET last_fetched_at = ? WHERE id = ?").run(now, linkId);
    const after = this.db
      .prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM chapters WHERE series_source_id = ?")
      .get(linkId)!.n;
    if (after > before) {
      this.db
        .prepare("UPDATE series SET updated_at = ? WHERE id = (SELECT series_id FROM series_sources WHERE id = ?)")
        .run(now, linkId);
    }
    return after - before;
  }

  private chapterNumbers(seriesId: number): number[] {
    return this.db
      .prepare<[number], { number: number }>(
        `SELECT DISTINCT c.number FROM chapters c JOIN series_sources s ON s.id = c.series_source_id
         WHERE s.series_id = ? AND c.number IS NOT NULL
           AND s.lang = (SELECT lang FROM series WHERE id = s.series_id)`,
      )
      .all(seriesId)
      .map((r) => r.number);
  }

  private links(seriesId: number): SourceRow[] {
    return this.db
      .prepare<[number], SourceRow>("SELECT * FROM series_sources WHERE series_id = ? ORDER BY priority, id")
      .all(seriesId);
  }

  private row(seriesId: number, uid: number): SeriesRow | undefined {
    return this.db.prepare<[number, number], SeriesRow>(`${USER_ROW} WHERE s.id = ?`).get(uid, seriesId);
  }
}
