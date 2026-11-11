import type { ChapterPages } from "@hanyo/types";
import { PREFETCH_CACHE } from "./caches";
import { downloads } from "./downloads.svelte";

/**
 * While you read a chapter, the next one is fetched into its own small cache so it opens
 * instantly, and still opens if the connection drops right at the end of the chapter.
 * Only the last few chapters are kept; real downloads (PAGES_CACHE) are separate and permanent.
 */
const KEEP = 3;
const INDEX_KEY = "hanyo.prefetch.v1";
const CONCURRENCY = 2;
const running = new Map<number, Promise<boolean>>();

interface Entry {
  chapterId: number;
  pages: string[];
  at: number;
}

function readIndex(): Entry[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as Entry[];
  } catch {
    return [];
  }
}

function writeIndex(entries: Entry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch {
    // Not critical.
  }
}

export function isPrefetched(chapterId: number): boolean {
  return readIndex().some((e) => e.chapterId === chapterId);
}

/** Fetch every page of a chapter into the prefetch cache. Resolves true when the chapter is ready. */
export function prefetchChapter(chapterId: number): Promise<boolean> {
  if (downloads.isDownloaded(chapterId) || isPrefetched(chapterId)) return Promise.resolve(true);
  let p = running.get(chapterId);
  if (!p) {
    p = run(chapterId).finally(() => running.delete(chapterId));
    running.set(chapterId, p);
  }
  return p;
}

async function run(chapterId: number): Promise<boolean> {
  try {
    // Also leaves the page list in the service worker's API cache, for offline opening.
    const res = await fetch(`/api/chapters/${chapterId}/pages`, { credentials: "same-origin" });
    if (!res.ok || res.headers.get("x-hanyo-offline") === "1") return false;
    const list = (await res.json()) as ChapterPages;
    if (list.direct) return false; // the source's own CDN: nothing the server can hand over
    const cache = await caches.open(PREFETCH_CACHE);
    const queue = [...list.pages];
    let failed = false;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let url = queue.shift(); url && !failed; url = queue.shift()) {
          if (await cache.match(url)) continue;
          const page = await fetch(`${url}?compact=1`, { credentials: "same-origin" }).catch(() => null);
          if (!page?.ok) {
            failed = true;
            return;
          }
          await cache.put(url, page);
        }
      }),
    );
    if (failed) return false;
    await remember({ chapterId, pages: list.pages, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

async function remember(entry: Entry): Promise<void> {
  const entries = [...readIndex().filter((e) => e.chapterId !== entry.chapterId), entry].sort((a, b) => b.at - a.at);
  const keep = entries.slice(0, KEEP);
  const drop = entries.slice(KEEP);
  writeIndex(keep);
  if (!drop.length) return;
  const cache = await caches.open(PREFETCH_CACHE);
  const kept = new Set(keep.flatMap((e) => e.pages));
  for (const url of drop.flatMap((e) => e.pages)) if (!kept.has(url)) await cache.delete(url);
}
