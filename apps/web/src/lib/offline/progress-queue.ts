import type { ProgressUpdate } from "@hanyo/types";
import { db } from "./idb";

/** Progress saved while offline. Replayed in order when the connection comes back. */
export async function queueProgress(update: ProgressUpdate): Promise<void> {
  await (await db()).add("progressQueue", { ...update, at: Date.now() });
}

let flushing = false;

export async function flushProgressQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const d = await db();
    const keys = await d.getAllKeys("progressQueue");
    for (const key of keys) {
      const item = await d.get("progressQueue", key);
      if (!item) continue;
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterId: item.chapterId, page: item.page, completed: item.completed }),
      }).catch(() => null);
      if (!res) break; // still offline
      // 4xx (e.g. chapter deleted) is dropped; only network errors are retried.
      await d.delete("progressQueue", key);
      sent++;
    }
  } finally {
    flushing = false;
  }
  return sent;
}
