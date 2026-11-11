import type { Recommendation } from "@hanyo/types";
import type { DB } from "../db/index.js";

/** "Recommend to…": one account suggests a series to others; only sender and recipients see it. */
export class RecommendationService {
  constructor(private readonly db: DB) {}

  /** Usernames of the other accounts, to choose recipients. */
  directory(uid: number): { id: number; username: string }[] {
    return this.db
      .prepare<[number], { id: number; username: string }>("SELECT id, username FROM users WHERE id != ? ORDER BY username COLLATE NOCASE")
      .all(uid);
  }

  /** Returns the recipients that got a new recommendation (sending twice doesn't duplicate). */
  send(from: number, to: number[], seriesId: number, note: string | null): number[] {
    const valid = new Set(this.directory(from).map((u) => u.id));
    const ins = this.db.prepare(
      `INSERT INTO recommendations (from_user, to_user, series_id, note, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(from_user, to_user, series_id) DO UPDATE SET note = excluded.note, created_at = excluded.created_at,
         seen_at = NULL, dismissed_at = NULL`,
    );
    const sent: number[] = [];
    const clean = note?.trim().slice(0, 200) || null;
    this.db.transaction(() => {
      for (const id of new Set(to)) {
        if (!valid.has(id)) continue;
        ins.run(from, id, seriesId, clean, Date.now());
        sent.push(id);
      }
    })();
    return sent;
  }

  incoming(uid: number): Recommendation[] {
    return this.db
      .prepare<
        [number],
        { id: number; from_name: string; series_id: number; title: string; cover_url: string | null; note: string | null; created_at: number; seen_at: number | null }
      >(
        `SELECT r.id, u.username AS from_name, r.series_id, s.title, s.cover_url, r.note, r.created_at, r.seen_at
         FROM recommendations r JOIN users u ON u.id = r.from_user JOIN series s ON s.id = r.series_id
         WHERE r.to_user = ? AND r.dismissed_at IS NULL ORDER BY r.created_at DESC LIMIT 30`,
      )
      .all(uid)
      .map((r) => ({
        id: r.id,
        from: r.from_name,
        seriesId: r.series_id,
        seriesTitle: r.title,
        coverUrl: r.cover_url,
        note: r.note,
        createdAt: r.created_at,
        seen: r.seen_at !== null,
      }));
  }

  markSeen(uid: number): void {
    this.db.prepare("UPDATE recommendations SET seen_at = ? WHERE to_user = ? AND seen_at IS NULL").run(Date.now(), uid);
  }

  dismiss(uid: number, id: number): void {
    this.db.prepare("UPDATE recommendations SET dismissed_at = ? WHERE id = ? AND to_user = ?").run(Date.now(), id, uid);
  }

  /** Once the recipient adds the series, the suggestion has done its job. */
  dismissForSeries(uid: number, seriesId: number): void {
    this.db
      .prepare("UPDATE recommendations SET dismissed_at = ? WHERE to_user = ? AND series_id = ? AND dismissed_at IS NULL")
      .run(Date.now(), uid, seriesId);
  }
}
