import type { ProgressUpdate } from "@hanyo/types";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface DownloadRecord {
  chapterId: number;
  seriesId: number;
  seriesTitle: string;
  seriesCover: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  pageUrls: string[];
  bytes: number;
  completedAt: number;
}

interface HanyoDB extends DBSchema {
  downloads: {
    key: number;
    value: DownloadRecord;
    indexes: { bySeries: number };
  };
  /** Pending download jobs, so a closed app resumes its queue on next launch. */
  queue: {
    key: number;
    value: { chapterId: number; seriesId: number; seriesTitle: string; seriesCover: string | null; chapterNumber: number | null; chapterTitle: string | null; addedAt: number };
  };
  progressQueue: {
    key: number;
    value: ProgressUpdate & { at: number };
    autoIncrement: true;
  };
}

let dbp: Promise<IDBPDatabase<HanyoDB>> | null = null;

export function db(): Promise<IDBPDatabase<HanyoDB>> {
  dbp ??= openDB<HanyoDB>("hanyo", 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const downloads = d.createObjectStore("downloads", { keyPath: "chapterId" });
        downloads.createIndex("bySeries", "seriesId");
        d.createObjectStore("progressQueue", { autoIncrement: true });
      }
      if (oldVersion < 2) d.createObjectStore("queue", { keyPath: "chapterId" });
    },
  });
  return dbp;
}
