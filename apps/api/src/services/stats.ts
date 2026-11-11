import type { ReadingStats } from "@hanyo/types";
import type { DB } from "../db/index.js";

/** Marks saved together in one tap ("mark this and previous as read") are bookkeeping, not reading. */
const BULK_MARKS = 4;
const HEATMAP_DAYS = 7 * 17;

/**
 * Reading statistics from read marks. `tzOffsetMin` is the reader's offset from UTC
 * (minutes east, e.g. 60 for Madrid in winter) so days and weeks follow their clock.
 */
export function readingStats(db: DB, uid: number, tzOffsetMin: number, now = Date.now()): ReadingStats {
  const shift = tzOffsetMin * 60_000;
  // Only marks that look like reading: drop batches written at the same instant.
  const marks = db
    .prepare<[number, number, number], { series_id: number; read_at: number }>(
      `SELECT m.series_id, m.read_at FROM read_marks m
       JOIN (SELECT series_id, read_at FROM read_marks WHERE user_id = ? GROUP BY series_id, read_at HAVING COUNT(*) < ?) ok
         ON ok.series_id = m.series_id AND ok.read_at = m.read_at
       WHERE m.user_id = ?`,
    )
    .all(uid, BULK_MARKS, uid);

  const dayOf = (ms: number) => new Date(ms + shift).toISOString().slice(0, 10);
  const today = dayOf(now);
  const todayStart = Date.parse(`${today}T00:00:00Z`) - shift;
  const weekday = (new Date(now + shift).getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = todayStart - weekday * 86_400_000;
  const local = new Date(now + shift);
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - shift;
  const yearStart = Date.UTC(local.getUTCFullYear(), 0, 1) - shift;

  const perDay = new Map<string, number>();
  const perSeries = new Map<number, number>();
  const totals = { week: 0, month: 0, year: 0, all: marks.length };
  for (const m of marks) {
    perDay.set(dayOf(m.read_at), (perDay.get(dayOf(m.read_at)) ?? 0) + 1);
    if (m.read_at >= weekStart) totals.week++;
    if (m.read_at >= monthStart) totals.month++;
    if (m.read_at >= yearStart) {
      totals.year++;
      perSeries.set(m.series_id, (perSeries.get(m.series_id) ?? 0) + 1);
    }
  }

  // Streaks over local days.
  const daysRead = [...perDay.keys()].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of daysRead) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  let current = 0;
  const yesterday = dayOf(now - 86_400_000);
  if (perDay.has(today) || perDay.has(yesterday)) {
    for (let t = Date.parse(`${perDay.has(today) ? today : yesterday}T00:00:00Z`); perDay.has(new Date(t).toISOString().slice(0, 10)); t -= 86_400_000) {
      current++;
    }
  }

  const days: ReadingStats["days"] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const date = dayOf(now - i * 86_400_000);
    days.push({ date, chapters: perDay.get(date) ?? 0 });
  }

  const series = db.prepare<[number], { title: string; cover_url: string | null; genres: string }>(
    "SELECT title, cover_url, genres FROM series WHERE id = ?",
  );
  const genres = new Map<string, number>();
  const topSeries: ReadingStats["topSeries"] = [];
  for (const [id, n] of [...perSeries].sort((a, b) => b[1] - a[1])) {
    const row = series.get(id);
    if (!row) continue;
    if (topSeries.length < 5) topSeries.push({ seriesId: id, title: row.title, coverUrl: row.cover_url, chapters: n });
    for (const g of JSON.parse(row.genres) as string[]) {
      if (/^(long strip|full color|web comic|webtoon|official colored|adaptation)$/i.test(g)) continue;
      genres.set(g, (genres.get(g) ?? 0) + n);
    }
  }

  return {
    totals,
    streak: { current, best: Math.max(best, current) },
    days,
    topSeries,
    topGenres: [...genres].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, chapters]) => ({ name, chapters })),
    finishedSeries:
      db
        .prepare<[number], { n: number }>("SELECT COUNT(*) AS n FROM user_series WHERE user_id = ? AND in_library = 1 AND shelf = 'completed'")
        .get(uid)?.n ?? 0,
  };
}
