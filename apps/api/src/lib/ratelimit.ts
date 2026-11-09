/**
 * Minimal async rate limiter: at most `limit` calls start per `intervalMs`.
 * Calls beyond the limit wait in FIFO order. Single-process only, which is all we need.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private queue: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly limit: number,
    private readonly intervalMs: number,
  ) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain(): void {
    if (this.timer) return;
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.intervalMs);
    while (this.queue.length > 0 && this.timestamps.length < this.limit) {
      this.timestamps.push(now);
      this.queue.shift()!();
    }
    if (this.queue.length > 0) {
      const wait = this.intervalMs - (now - this.timestamps[0]!) + 1;
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, wait);
    }
  }
}
