import webpush from "web-push";
import type { DB } from "../db/index.js";

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

interface SubRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Web Push (works for iOS 16.4+ home-screen PWAs). Disabled when VAPID keys are missing. */
export class PushService {
  readonly enabled: boolean;

  constructor(
    private readonly db: DB,
    readonly publicKey: string,
    privateKey: string,
    subject: string,
  ) {
    this.enabled = Boolean(publicKey && privateKey);
    if (this.enabled) webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  subscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
  }

  unsubscribe(endpoint: string): void {
    this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint);
  }

  async notify(payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = this.db.prepare<[], SubRow>("SELECT endpoint, p256dh, auth FROM push_subscriptions").all();
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          // 404/410: the browser dropped the subscription.
          if (status === 404 || status === 410) this.unsubscribe(s.endpoint);
        }
      }),
    );
  }
}
