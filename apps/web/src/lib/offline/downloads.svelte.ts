import type { ChapterPages, ChapterSummary, SeriesDetail } from "@hanyo/types";
import { API_CACHE, COVERS_CACHE, PAGES_CACHE } from "./caches";
import { db, type DownloadRecord } from "./idb";

interface Job {
  chapterId: number;
  series: Pick<SeriesDetail, "id" | "title" | "coverUrl">;
  chapter: Pick<ChapterSummary, "id" | "number" | "title">;
}

interface ActiveJob extends Job {
  done: number;
  total: number;
}

const PAGE_CONCURRENCY = 3;

/**
 * Chapter downloads stored in Cache Storage (images) + IndexedDB (metadata).
 * The service worker serves cached page URLs, so the reader works offline unchanged.
 * Downloads only progress while the app is open (iOS has no background fetch for PWAs).
 */
class DownloadManager {
  /** chapterId -> record, for completed downloads */
  records = $state<Map<number, DownloadRecord>>(new Map());
  queue = $state<Job[]>([]);
  active = $state<ActiveJob | null>(null);
  error = $state<string | null>(null);
  private loaded = false;
  private running = false;

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const d = await db();
    const all = await d.getAll("downloads");
    this.records = new Map(all.map((r) => [r.chapterId, r]));
    // Resume jobs left pending when the app was closed.
    const pending = (await d.getAll("queue")).sort((a, b) => a.addedAt - b.addedAt);
    this.queue = pending
      .filter((p) => !this.records.has(p.chapterId))
      .map((p) => ({
        chapterId: p.chapterId,
        series: { id: p.seriesId, title: p.seriesTitle, coverUrl: p.seriesCover },
        chapter: { id: p.chapterId, number: p.chapterNumber, title: p.chapterTitle },
      }));
    if (this.queue.length && navigator.onLine) void this.run();
  }

  isDownloaded(chapterId: number): boolean {
    return this.records.has(chapterId);
  }

  status(chapterId: number): "downloaded" | "active" | "queued" | "none" {
    if (this.records.has(chapterId)) return "downloaded";
    if (this.active?.chapterId === chapterId) return "active";
    if (this.queue.some((j) => j.chapterId === chapterId)) return "queued";
    return "none";
  }

  enqueue(series: SeriesDetail, chapters: ChapterSummary[]): void {
    const jobs = chapters
      .filter((c) => this.status(c.id) === "none")
      .map<Job>((c) => ({
        chapterId: c.id,
        series: { id: series.id, title: series.title, coverUrl: series.coverUrl },
        chapter: { id: c.id, number: c.number, title: c.title },
      }));
    if (jobs.length === 0) return;
    this.queue = [...this.queue, ...jobs];
    void persistJobs(jobs);
    void requestPersistence();
    void cacheSeriesSnapshot(series);
    void this.run();
  }

  cancel(chapterId: number): void {
    this.queue = this.queue.filter((j) => j.chapterId !== chapterId);
    void db().then((d) => d.delete("queue", chapterId));
  }

  cancelAll(): void {
    this.queue = [];
    void db().then((d) => d.clear("queue"));
  }

  async remove(chapterIds: number[]): Promise<void> {
    const d = await db();
    const cache = await caches.open(PAGES_CACHE);
    const apiCache = await caches.open(API_CACHE);
    const next = new Map(this.records);
    for (const id of chapterIds) {
      const rec = next.get(id);
      if (!rec) continue;
      await Promise.all(rec.pageUrls.map((u) => cache.delete(u)));
      await apiCache.delete(`/api/chapters/${id}/pages`);
      await d.delete("downloads", id);
      next.delete(id);
    }
    this.records = next;
  }

  bySeries(): Array<{ seriesId: number; title: string; cover: string | null; chapters: DownloadRecord[]; bytes: number }> {
    const groups = new Map<number, DownloadRecord[]>();
    for (const r of this.records.values()) {
      const list = groups.get(r.seriesId) ?? [];
      list.push(r);
      groups.set(r.seriesId, list);
    }
    return [...groups.entries()]
      .map(([seriesId, chapters]) => ({
        seriesId,
        title: chapters[0]!.seriesTitle,
        cover: chapters[0]!.seriesCover,
        chapters: chapters.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0)),
        bytes: chapters.reduce((s, c) => s + c.bytes, 0),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  get totalBytes(): number {
    let n = 0;
    for (const r of this.records.values()) n += r.bytes;
    return n;
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = null;
    try {
      while (this.queue.length > 0) {
        const [job, ...rest] = this.queue;
        this.queue = rest;
        try {
          await this.download(job!);
          await (await db()).delete("queue", job!.chapterId);
        } catch (e) {
          this.error = `Capítulo ${job!.chapter.number ?? ""}: ${(e as Error).message}`;
          // Network gone: put the job back and stop; it resumes on next enqueue/online.
          if (!navigator.onLine) {
            this.queue = [job!, ...this.queue];
            break;
          }
          await (await db()).delete("queue", job!.chapterId);
        }
      }
    } finally {
      this.active = null;
      this.running = false;
    }
  }

  /** Resume pending jobs (called when connectivity returns). */
  resume(): void {
    void this.run();
  }

  private async download(job: Job): Promise<void> {
    const listRes = await fetch(`/api/chapters/${job.chapterId}/pages`, { credentials: "same-origin" });
    if (!listRes.ok) {
      const body = (await listRes.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `no se pudo obtener la lista de páginas (${listRes.status})`);
    }
    const list = (await listRes.clone().json()) as ChapterPages;
    await (await caches.open(API_CACHE)).put(`/api/chapters/${job.chapterId}/pages`, listRes);

    this.active = { ...job, done: 0, total: list.pages.length };
    const cache = await caches.open(PAGES_CACHE);
    let bytes = 0;
    let next = 0;
    const worker = async () => {
      while (next < list.pages.length) {
        const url = list.pages[next++]!;
        let res = await cache.match(url);
        if (!res) {
          // Ask for the re-encoded (~80% smaller) version but store it under the plain URL,
          // which is what the reader and the service worker look up.
          res = await fetchWithRetry(`${url}?compact=1`);
          const blob = await res.clone().blob();
          bytes += blob.size;
          await cache.put(url, res);
        } else {
          bytes += (await res.blob()).size;
        }
        if (this.active) this.active = { ...this.active, done: this.active.done + 1 };
      }
    };
    await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));

    const record: DownloadRecord = {
      chapterId: job.chapterId,
      seriesId: job.series.id,
      seriesTitle: job.series.title,
      seriesCover: job.series.coverUrl,
      chapterNumber: job.chapter.number,
      chapterTitle: job.chapter.title,
      pageUrls: list.pages,
      bytes,
      completedAt: Date.now(),
    };
    await (await db()).put("downloads", record);
    this.records = new Map(this.records).set(job.chapterId, record);
  }
}

async function persistJobs(jobs: Job[]): Promise<void> {
  const d = await db();
  const now = Date.now();
  await Promise.all(
    jobs.map((j, i) =>
      d.put("queue", {
        chapterId: j.chapterId,
        seriesId: j.series.id,
        seriesTitle: j.series.title,
        seriesCover: j.series.coverUrl,
        chapterNumber: j.chapter.number,
        chapterTitle: j.chapter.title,
        addedAt: now + i,
      }),
    ),
  );
}

async function fetchWithRetry(url: string, tries = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status < 500) break;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last instanceof Error ? last : new Error("descarga fallida");
}

/** Keep the series page and its cover available offline. */
async function cacheSeriesSnapshot(series: SeriesDetail): Promise<void> {
  try {
    const api = await caches.open(API_CACHE);
    await api.put(
      `/api/series/${series.id}`,
      new Response(JSON.stringify(series), { headers: { "Content-Type": "application/json" } }),
    );
    if (series.coverUrl) {
      const covers = await caches.open(COVERS_CACHE);
      if (!(await covers.match(series.coverUrl))) await covers.add(series.coverUrl);
    }
  } catch {
    // Non-critical.
  }
}

/** Ask the browser not to evict our storage under pressure. */
async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported: ignore.
  }
}

export const downloads = new DownloadManager();
