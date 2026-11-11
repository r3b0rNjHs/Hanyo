import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { readingStats } from "../src/services/stats.js";

const DAY = 86_400_000;
// Wednesday 2026-11-11 12:00 UTC.
const NOW = Date.UTC(2026, 10, 11, 12);

function setup() {
  const db = openMemoryDb();
  const add = db.prepare(
    "INSERT INTO series (id, title, cover_url, description, authors, genres, status, in_library, updated_at, shelf) VALUES (?, ?, NULL, NULL, '[]', ?, 'ongoing', 1, 0, ?)",
  );
  add.run(1, "Eleceed", '["Action","Long Strip","Comedy"]', "reading");
  add.run(2, "Lookism", '["Drama"]', "completed");
  const own = db.prepare("INSERT INTO user_series (user_id, series_id, in_library, shelf) VALUES (1, ?, 1, ?)");
  own.run(1, "reading");
  own.run(2, "completed");
  const ins = db.prepare("INSERT INTO read_marks (user_id, series_id, number, read_at) VALUES (1, ?, ?, ?)");
  const mark = { run: (series: number, n: number, at: number) => ins.run(series, n, at) };
  return { db, mark };
}

describe("readingStats", () => {
  it("counts chapters per period, streaks, top series and genres", () => {
    const { db, mark } = setup();
    mark.run(1, 1, NOW - 2 * DAY); // Monday
    mark.run(1, 2, NOW - DAY); // Tuesday
    mark.run(1, 3, NOW); // today
    mark.run(1, 4, NOW + 1000);
    mark.run(2, 1, NOW - 10 * DAY); // last month? no: Nov 1 → this month, older week
    const s = readingStats(db, 1, 0, NOW);
    expect(s.totals).toEqual({ week: 4, month: 5, year: 5, all: 5 });
    expect(s.streak).toEqual({ current: 3, best: 3 });
    expect(s.days.at(-1)).toEqual({ date: "2026-11-11", chapters: 2 });
    expect(s.topSeries.map((t) => [t.title, t.chapters])).toEqual([["Eleceed", 4], ["Lookism", 1]]);
    expect(s.topGenres.map((g) => g.name)).toEqual(["Action", "Comedy", "Drama"]);
    expect(s.finishedSeries).toBe(1);
  });

  it("ignores bulk 'mark previous as read' batches", () => {
    const { db, mark } = setup();
    for (let n = 1; n <= 30; n++) mark.run(1, n, NOW - 3 * DAY);
    mark.run(1, 31, NOW);
    expect(readingStats(db, 1, 0, NOW).totals.all).toBe(1);
  });

  it("uses the reader's time zone for days", () => {
    const { db, mark } = setup();
    mark.run(1, 1, Date.UTC(2026, 10, 11, 23, 30)); // 00:30 on the 12th in Madrid (UTC+1)
    const s = readingStats(db, 1, 60, Date.UTC(2026, 10, 11, 23, 45));
    expect(s.days.at(-1)).toEqual({ date: "2026-11-12", chapters: 1 });
  });
});
