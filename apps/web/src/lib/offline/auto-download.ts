import type { ChapterSummary, SeriesDetail, SeriesSummary } from "@hanyo/types";
import { downloads } from "./downloads.svelte";

/** How many unread chapters ahead are kept downloaded for series with automatic downloads. */
export const AUTO_AHEAD = 5;
const MIN_INTERVAL_MS = 15 * 60_000;
let lastRun = 0;

/** The next unread chapters after where you left off (from the start if never read). */
export function nextUnread(s: SeriesDetail, count = AUTO_AHEAD): ChapterSummary[] {
  return s.chapters
    .filter((c) => c.number !== null && !c.read && (s.lastReadChapter === null || c.number > s.lastReadChapter))
    .slice(0, count);
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { credentials: "same-origin" });
    // Skip offline-cache answers: they can't tell us about new chapters.
    if (!res.ok || res.headers.get("x-hanyo-offline") === "1") return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * iOS gives PWAs no background fetch, so "automatic" means: whenever the app is opened (or comes
 * back to the foreground), queue the next unread chapters of every series that has it enabled.
 * Already downloaded or queued chapters are skipped by the download manager.
 */
export async function runAutoDownloads(force = false): Promise<void> {
  if (!navigator.onLine || (!force && Date.now() - lastRun < MIN_INTERVAL_MS)) return;
  lastRun = Date.now();
  await downloads.init();
  const library = await getJson<SeriesSummary[]>("/api/library");
  for (const s of library ?? []) {
    if (!s.autoDownload || s.unreadCount === 0) continue;
    const detail = await getJson<SeriesDetail>(`/api/series/${s.id}`);
    if (detail) downloads.enqueue(detail, nextUnread(detail));
  }
}
