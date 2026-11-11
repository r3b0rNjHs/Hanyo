import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type DB = Database.Database;

/**
 * Schema notes
 * - `series` is our own identity for a title, independent of where it is read from.
 * - `series_sources` links a series to N sources (MangaDex, Weeb Central via Suwayomi, ...).
 * - `chapters` belong to a series_source. The API merges them by chapter number.
 * - Read state is stored by chapter NUMBER per series (`read_marks`), so switching
 *   sources never loses progress.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE series (
    id            INTEGER PRIMARY KEY,
    title         TEXT NOT NULL,
    cover_url     TEXT,
    description   TEXT,
    authors       TEXT NOT NULL DEFAULT '[]',
    genres        TEXT NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL DEFAULT 'unknown',
    in_library    INTEGER NOT NULL DEFAULT 0,
    added_at      INTEGER,
    last_checked_at INTEGER,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE series_sources (
    id            INTEGER PRIMARY KEY,
    series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    source_key    TEXT NOT NULL,
    source_name   TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    url           TEXT,
    priority      INTEGER NOT NULL DEFAULT 100,
    last_fetched_at INTEGER,
    UNIQUE (source_key, external_id)
  );
  CREATE INDEX idx_series_sources_series ON series_sources(series_id);

  CREATE TABLE chapters (
    id            INTEGER PRIMARY KEY,
    series_source_id INTEGER NOT NULL REFERENCES series_sources(id) ON DELETE CASCADE,
    external_id   TEXT NOT NULL,
    number        REAL,
    title         TEXT,
    scanlator     TEXT,
    published_at  INTEGER,
    source_order  INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL,
    UNIQUE (series_source_id, external_id)
  );
  CREATE INDEX idx_chapters_source ON chapters(series_source_id);

  CREATE TABLE read_marks (
    series_id     INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    number        REAL NOT NULL,
    read_at       INTEGER NOT NULL,
    PRIMARY KEY (series_id, number)
  );

  CREATE TABLE resume_points (
    series_id     INTEGER PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
    chapter_id    INTEGER NOT NULL,
    page          INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE push_subscriptions (
    endpoint      TEXT PRIMARY KEY,
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );
  `,
  // v2: one reading language per series; each source link knows its language.
  `
  ALTER TABLE series ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
  ALTER TABLE series_sources ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
  `,
  // v3: which set of sources a series was last matched against, to re-link it when sources change.
  `
  ALTER TABLE series ADD COLUMN linked_against TEXT;
  `,
  // v4: reading lists. Library series never opened in the reader start as "plan to read".
  `
  ALTER TABLE series ADD COLUMN shelf TEXT NOT NULL DEFAULT 'reading';
  UPDATE series SET shelf = 'plan'
    WHERE id NOT IN (SELECT series_id FROM read_marks) AND id NOT IN (SELECT series_id FROM resume_points);
  `,
  // v5: per-series automatic download of new chapters (done by the app, which owns the storage).
  `
  ALTER TABLE series ADD COLUMN auto_download INTEGER NOT NULL DEFAULT 0;
  `,
  // v6: position inside the resume page (webtoon pages are very tall).
  `
  ALTER TABLE resume_points ADD COLUMN page_offset REAL NOT NULL DEFAULT 0;
  `,
  // v7: page shapes (height / width), learned when the server first fetches a page.
  `
  CREATE TABLE page_sizes (
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    idx        INTEGER NOT NULL,
    ratio      REAL NOT NULL,
    PRIMARY KEY (chapter_id, idx)
  );
  `,
  // v8: per-series new-chapter notifications (on by default).
  `
  ALTER TABLE series ADD COLUMN notify INTEGER NOT NULL DEFAULT 1;
  `,
  // v9: daily source health checks (to warn when a source breaks).
  `
  CREATE TABLE source_health (
    source_key TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    lang       TEXT NOT NULL,
    ok         INTEGER NOT NULL,
    error      TEXT,
    checked_at INTEGER NOT NULL,
    failures   INTEGER NOT NULL DEFAULT 0,
    alerted    INTEGER NOT NULL DEFAULT 0
  );
  `,
  // v10: preferred scanlation group per series.
  `
  ALTER TABLE series ADD COLUMN preferred_scanlator TEXT;
  `,
  // v11: several users. The catalogue (series, sources, chapters, page shapes) stays shared;
  // what is personal moves to per-user tables. Existing data becomes user 1 (the admin), whose
  // password is set from HANYO_PASSWORD on first start (see UserService.bootstrap).
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT,
    is_admin        INTEGER NOT NULL DEFAULT 0,
    session_version INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL
  );
  INSERT INTO users (id, username, is_admin, created_at) VALUES (1, 'admin', 1, CAST(strftime('%s','now') AS INTEGER) * 1000);

  CREATE TABLE user_series (
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id           INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    in_library          INTEGER NOT NULL DEFAULT 0,
    shelf               TEXT NOT NULL DEFAULT 'reading',
    notify              INTEGER NOT NULL DEFAULT 1,
    auto_download       INTEGER NOT NULL DEFAULT 0,
    preferred_scanlator TEXT,
    lang                TEXT,
    added_at            INTEGER,
    PRIMARY KEY (user_id, series_id)
  );
  INSERT INTO user_series (user_id, series_id, in_library, shelf, notify, auto_download, preferred_scanlator, lang, added_at)
    SELECT 1, id, in_library, shelf, notify, auto_download, preferred_scanlator, lang, added_at FROM series;

  CREATE TABLE read_marks_v11 (
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    number    REAL NOT NULL,
    read_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, series_id, number)
  );
  INSERT INTO read_marks_v11 SELECT 1, series_id, number, read_at FROM read_marks;
  DROP TABLE read_marks;
  ALTER TABLE read_marks_v11 RENAME TO read_marks;

  CREATE TABLE resume_points_v11 (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id   INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    chapter_id  INTEGER NOT NULL,
    page        INTEGER NOT NULL DEFAULT 0,
    page_offset REAL NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, series_id)
  );
  INSERT INTO resume_points_v11 SELECT 1, series_id, chapter_id, page, page_offset, updated_at FROM resume_points;
  DROP TABLE resume_points;
  ALTER TABLE resume_points_v11 RENAME TO resume_points;

  ALTER TABLE push_subscriptions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1 REFERENCES users(id) ON DELETE CASCADE;

  CREATE TABLE invites (
    token      TEXT PRIMARY KEY,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    used_at    INTEGER
  );
  `,
];

export function openDb(dataDir: string): DB {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, "hanyo.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function openMemoryDb(): DB {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v]!;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
