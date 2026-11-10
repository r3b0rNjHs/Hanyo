import type { SourceInfo } from "@hanyo/types";
import type { Provider } from "./types.js";
import { parseSourceKey } from "./types.js";

/** Routes a source key ("mangadex", "suwayomi:123") to the provider that serves it. */
export class ProviderRegistry {
  private readonly byId = new Map<Provider["id"], Provider>();

  constructor(providers: Provider[]) {
    for (const p of providers) this.byId.set(p.id, p);
  }

  resolve(sourceKey: string): { provider: Provider; sourceId: string } {
    const { provider, sourceId } = parseSourceKey(sourceKey);
    const p = this.byId.get(provider);
    if (!p) throw new Error(`Provider not configured: ${provider}`);
    return { provider: p, sourceId };
  }

  /** All sources across providers. A provider that is down is skipped, not fatal. */
  async listSources(): Promise<SourceInfo[]> {
    const lists = await Promise.allSettled([...this.byId.values()].map((p) => p.listSources()));
    return lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  }

  providers(): Provider[] {
    return [...this.byId.values()];
  }
}
