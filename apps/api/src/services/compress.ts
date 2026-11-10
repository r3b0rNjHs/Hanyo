import sharp from "sharp";

/** WebP cannot encode images taller/wider than this; long webtoon strips often are. */
export const WEBP_MAX_DIMENSION = 16383;

export interface Compressed {
  bytes: Buffer;
  /** "webp" | "jpeg" when re-encoded, "original" when re-encoding didn't help or failed. */
  format: "webp" | "jpeg" | "original";
}

/**
 * Re-encode a page so it takes much less space on the phone at visually identical quality.
 * - WebP at `quality` for normal pages.
 * - mozjpeg at `quality` for strips beyond WebP's 16383px limit.
 * - Keeps the original if the result isn't smaller (already-optimized sources) or on any error.
 * Measured on MangaDex originals: ~80% smaller at quality 90.
 */
export async function compressPage(input: Buffer, quality: number): Promise<Compressed> {
  try {
    const img = sharp(input, { limitInputPixels: false, failOn: "none" });
    const { width = 0, height = 0, format, pages = 1 } = await img.metadata();
    // Animated GIF/WebP and unknown formats are left alone.
    if (pages > 1 || !format || !["jpeg", "png", "webp"].includes(format)) return { bytes: input, format: "original" };
    const tooBig = width > WEBP_MAX_DIMENSION || height > WEBP_MAX_DIMENSION;
    const out = tooBig
      ? await img.jpeg({ quality, mozjpeg: true }).toBuffer()
      : await img.webp({ quality, effort: 4 }).toBuffer();
    if (out.length >= input.length) return { bytes: input, format: "original" };
    return { bytes: out, format: tooBig ? "jpeg" : "webp" };
  } catch {
    return { bytes: input, format: "original" };
  }
}

/** Runs CPU-heavy jobs with bounded concurrency, de-duplicating by key. */
export class JobQueue {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly concurrency: number) {}

  run(key: string, job: () => Promise<void>): Promise<void> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const p = this.acquire()
      .then(job)
      .finally(() => {
        this.release();
        this.inflight.delete(key);
      });
    this.inflight.set(key, p);
    return p;
  }

  private acquire(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => (this.running++, resolve())));
  }

  private release(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}
