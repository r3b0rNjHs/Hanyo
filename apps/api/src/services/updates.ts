import type { UpdateCheckResult } from "@hanyo/types";
import { normalizeTitle } from "../lib/text.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { LibraryService } from "./library.js";
import type { PageService } from "./pages.js";
import type { PushService } from "./push.js";

export class UpdateService {
  private running: Promise<UpdateCheckResult> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly library: LibraryService,
    private readonly registry: ProviderRegistry,
    private readonly pages: PageService,
    private readonly push: PushService,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  start(intervalMin: number): void {
    if (intervalMin <= 0) return;
    this.timer = setInterval(() => void this.checkAll().catch((e) => this.log(`update check failed: ${e}`)), intervalMin * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Refresh every library series; notify + prefetch new chapters. Concurrent calls share one run. */
  checkAll(): Promise<UpdateCheckResult> {
    this.running ??= this.doCheckAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doCheckAll(): Promise<UpdateCheckResult> {
    const ids = this.library.inLibraryIds();
    const result: UpdateCheckResult = { checkedSeries: ids.length, newChapters: 0, errors: [] };
    for (const id of ids) {
      const { newNumbers, errors } = await this.library.refresh(id);
      result.errors.push(...errors);
      if (newNumbers.length === 0) continue;
      result.newChapters += newNumbers.length;
      const title = this.library.title(id) ?? "Serie";
      const sorted = newNumbers.sort((a, b) => a - b);
      const label = sorted.length === 1 ? `Capítulo ${sorted[0]}` : `${sorted.length} capítulos nuevos (hasta el ${sorted.at(-1)})`;
      await this.push.notify({ title, body: label, url: `/series/${id}` });
      // Warm the server cache so the phone downloads fast and the chapter survives source outages.
      const merged = this.library.mergedChapters(id).filter((c) => c.number !== null && sorted.includes(c.number));
      for (const c of merged) {
        await this.pages.prefetch(c.id).catch((e) => result.errors.push(`prefetch ${c.id}: ${(e as Error).message}`));
      }
    }
    this.log(`update check: ${result.checkedSeries} series, ${result.newChapters} new chapters, ${result.errors.length} errors`);
    return result;
  }

  /**
   * Search every other source for a series with the same normalized title and link exact matches,
   * so the merged chapter list fills gaps (e.g. MangaDex missing chapters available on Weeb Central).
   */
  async autoLink(seriesId: number): Promise<string[]> {
    const detail = this.library.detailFromDb(seriesId);
    if (!detail) return [];
    const linked = new Set(detail.sources.map((s) => s.sourceKey));
    const target = normalizeTitle(detail.title);
    const added: string[] = [];
    const sources = (await this.registry.listSources()).filter((s) => !linked.has(s.key));
    await Promise.allSettled(
      sources.map(async (s) => {
        const { provider, sourceId } = this.registry.resolve(s.key);
        const hits = await provider.search(sourceId, detail.title);
        const match = hits.find((h) => normalizeTitle(h.title) === target);
        if (!match) return;
        await this.library.linkSource(seriesId, s.key, match.externalId);
        added.push(s.name);
      }),
    );
    if (added.length) this.log(`auto-linked "${detail.title}" to ${added.join(", ")}`);
    return added;
  }
}
