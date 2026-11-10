import type { UpdateCheckResult } from "@hanyo/types";
import { normalizeTitle } from "../lib/text.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { AniListTitles } from "./anilist.js";
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
    /** Alternative names from AniList, so a series is found on sources that title it differently. */
    private readonly titles?: AniListTitles,
  ) {}

  start(intervalMin: number): void {
    // Shortly after boot (e.g. right after a deploy that changed extensions), re-link the library.
    setTimeout(() => void this.relinkLibrary().catch((e) => this.log(`relink failed: ${e}`)), 60_000).unref();
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
    // Pick up sources added since the last run (cheap when nothing changed).
    await this.relinkLibrary().catch((e) => this.log(`relink failed: ${e}`));
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
    const names = await this.knownNames(detail.title);
    const added: string[] = [];
    const sources = (await this.registry.listSources()).filter((s) => !linked.has(s.key));
    await Promise.allSettled(
      sources.map(async (s) => {
        const { provider, sourceId } = this.registry.resolve(s.key);
        const hits = await provider.search(sourceId, detail.title);
        const match = hits.find((h) => [h.title, ...(h.altTitles ?? [])].some((t) => names.has(normalizeTitle(t))));
        if (!match) return;
        await this.library.linkSource(seriesId, s.key, match.externalId);
        added.push(s.name);
      }),
    );
    if (added.length) this.log(`auto-linked "${detail.title}" to ${added.join(", ")}`);
    return added;
  }

  /**
   * The series' title plus every name AniList knows for the entry with that exact title
   * ("Return of the Blossoming Blade" = "Return of the Mount Hua Sect"). Only an entry that
   * contains the title itself is used, so a vague title can't pull in another series.
   */
  private async knownNames(title: string): Promise<Set<string>> {
    const own = normalizeTitle(title);
    const names = new Set([own]);
    const clusters = (await this.titles?.lookup(title)) ?? [];
    const same = clusters.find((c) => c.titles.some((t) => normalizeTitle(t) === own));
    for (const t of same?.titles ?? []) names.add(normalizeTitle(t));
    names.delete("");
    return names;
  }

  private relinking: Promise<{ checked: number; linked: number }> | null = null;

  /**
   * Search every library series on the sources it hasn't been matched against yet: after
   * extensions are added or removed, existing series pick up the new sources by themselves.
   * Series already matched against the current source set are skipped unless `force`.
   */
  relinkLibrary(force = false): Promise<{ checked: number; linked: number }> {
    this.relinking ??= (async () => {
      const fingerprint = (await this.registry.listSources()).map((s) => s.key).sort().join(",");
      let checked = 0;
      let linked = 0;
      for (const id of this.library.inLibraryIds()) {
        if (!force && this.library.linkedAgainst(id) === fingerprint) continue;
        checked++;
        try {
          linked += (await this.autoLink(id)).length;
          this.library.setLinkedAgainst(id, fingerprint);
        } catch (e) {
          this.log(`relink ${id} failed: ${(e as Error).message}`);
        }
      }
      if (checked) this.log(`relink: ${checked} series checked, ${linked} sources linked`);
      return { checked, linked };
    })().finally(() => {
      this.relinking = null;
    });
    return this.relinking;
  }
}
