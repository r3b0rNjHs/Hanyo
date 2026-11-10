import path from "node:path";

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}`);
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer`);
  return n;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  isProd,
  port: int("API_PORT", 3101),
  password: str("HANYO_PASSWORD", isProd ? undefined : "hanyo"),
  sessionSecret: str("SESSION_SECRET", isProd ? undefined : "dev-secret-not-for-production"),
  dataDir: path.resolve(str("DATA_DIR", "./data")),
  /** WebP/mozjpeg quality for re-encoded pages (visually lossless at 90). 0 keeps originals. */
  imageQuality: int("IMAGE_QUALITY", 90),
  imageCacheMaxBytes: int("IMAGE_CACHE_MAX_MB", 8000) * 1024 * 1024,
  suwayomiUrl: str("SUWAYOMI_URL", "http://127.0.0.1:4567").replace(/\/$/, ""),
  suwayomiSources: (process.env.SUWAYOMI_SOURCES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  updateIntervalMin: int("UPDATE_INTERVAL_MIN", 180),
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? "",
    privateKey: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:admin@example.com",
  },
  userAgent: "Hanyo/0.1 (+personal self-hosted reader)",
} as const;

export type Config = typeof config;
