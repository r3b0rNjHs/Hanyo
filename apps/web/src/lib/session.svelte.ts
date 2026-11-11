import { api } from "./api";
import { API_CACHE } from "./offline/caches";
import { db } from "./offline/idb";
import { flushProgressQueue } from "./offline/progress-queue";

export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
}

/** Who is logged in on this device (null until /auth/me answers). */
export const session = $state<{ user: SessionUser | null }>({ user: null });

export async function loadSession(): Promise<SessionUser | null> {
  try {
    session.user = (await api.me()).user;
  } catch {
    // Offline or logged out: keep what we had.
  }
  return session.user;
}

/**
 * Log out and forget what is personal on this device: cached API answers (library, history…)
 * and progress that couldn't be sent yet, so the next person to log in here doesn't see them.
 * Downloaded chapters stay (they are just pages) and can be removed in Descargas.
 */
export async function endSession(): Promise<void> {
  await flushProgressQueue().catch(() => 0);
  await api.logout().catch(() => null);
  await caches.delete(API_CACHE).catch(() => false);
  await (await db()).clear("progressQueue").catch(() => undefined);
  try {
    for (const k of ["hanyo.feed.seenAt", "hanyo.prefetch.v1"]) localStorage.removeItem(k);
  } catch {}
  session.user = null;
}
