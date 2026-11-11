import type { FeedItem } from "@hanyo/types";

const KEY = "hanyo.feed.seenAt";

/** Dot on the Novedades tab: unread chapters published since the feed was last opened. */
export const feedBadge = $state({ unseen: false });

function seenAt(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function updateBadge(items: FeedItem[]): void {
  const since = seenAt();
  feedBadge.unseen = items.some((i) => !i.chapter.read && (i.chapter.publishedAt ?? 0) > since);
}

export async function refreshFeedBadge(): Promise<void> {
  try {
    const [feed, recs] = await Promise.all([
      fetch("/api/feed", { credentials: "same-origin" }),
      fetch("/api/recommendations", { credentials: "same-origin" }),
    ]);
    if (feed.ok) updateBadge((await feed.json()) as FeedItem[]);
    // A recommendation nobody has looked at yet also lights the dot.
    if (recs.ok && ((await recs.json()) as { seen: boolean }[]).some((r) => !r.seen)) feedBadge.unseen = true;
  } catch {
    // Offline: keep the current state.
  }
}

/** The feed is on screen: everything in it counts as seen. */
export function markFeedSeen(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {}
  feedBadge.unseen = false;
}
