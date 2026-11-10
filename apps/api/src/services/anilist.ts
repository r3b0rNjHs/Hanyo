import type { TitleCluster, TrendingOrigin, TrendingResponse } from "@hanyo/types";
import { RateLimiter } from "../lib/ratelimit.js";

const ENDPOINT = "https://graphql.anilist.co";
const QUERY = `query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      id countryOfOrigin popularity
      title { romaji english native }
      synonyms
    }
  }
}`;

const TRENDING = `query ($page: Int, $country: CountryCode) {
  Page(page: $page, perPage: 30) {
    pageInfo { hasNextPage }
    media(type: MANGA, sort: TRENDING_DESC, countryOfOrigin: $country) {
      id countryOfOrigin popularity
      title { romaji english native }
      synonyms
      coverImage { large }
    }
  }
}`;

interface Media {
  id: number;
  countryOfOrigin: string | null;
  popularity: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[];
  coverImage?: { large: string | null };
}

/**
 * AniList knows every name a series goes by ("Return of the Blossoming Blade" =
 * "Return of the Mount Hua Sect" = "Hwasangwihwan") and how popular it is.
 * Search uses it to merge the same series across sources and to rank results.
 * It is an enhancement only: any failure returns no clusters and search still works.
 */
export class AniListTitles {
  private readonly cache = new Map<string, { at: number; value: TitleCluster[] }>();
  // AniList currently allows 30 requests/minute; stay below it.
  private readonly limiter = new RateLimiter(25, 60_000);

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ttlMs = 24 * 3600_000,
  ) {}

  private readonly trendingCache = new Map<string, { at: number; value: TrendingResponse }>();

  /** AniList "trending" (recent activity), optionally by country of origin. Cached 30 min. */
  async trending(origin: TrendingOrigin, page: number): Promise<TrendingResponse> {
    const key = `${origin}|${page}`;
    const hit = this.trendingCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60_000) return hit.value;
    const res = await this.limiter.schedule(() =>
      this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: TRENDING, variables: { page, ...(origin === "all" ? {} : { country: origin }) } }),
        signal: AbortSignal.timeout(8000),
      }),
    );
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    const json = (await res.json()) as { data?: { Page?: { pageInfo?: { hasNextPage?: boolean }; media?: Media[] } } };
    const value: TrendingResponse = {
      page,
      hasNextPage: Boolean(json.data?.Page?.pageInfo?.hasNextPage),
      items: (json.data?.Page?.media ?? []).map((m) => ({ cluster: toCluster(m), coverUrl: m.coverImage?.large ?? null })),
    };
    if (this.trendingCache.size > 100) this.trendingCache.clear();
    this.trendingCache.set(key, { at: Date.now(), value });
    return value;
  }

  async lookup(query: string): Promise<TitleCluster[]> {
    const key = query.trim().toLowerCase();
    if (!key) return [];
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    try {
      const res = await this.limiter.schedule(() =>
        this.fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: QUERY, variables: { search: query } }),
          signal: AbortSignal.timeout(6000),
        }),
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: { Page?: { media?: Media[] } } };
      const value = (json.data?.Page?.media ?? []).map(toCluster);
      this.cache.set(key, { at: Date.now(), value });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      return value;
    } catch {
      return [];
    }
  }
}

export function toCluster(m: Media): TitleCluster {
  const names = [m.title.english, m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter(
    (t): t is string => Boolean(t && t.trim()),
  );
  return {
    id: m.id,
    title: m.title.english ?? m.title.romaji ?? names[0] ?? "",
    englishTitle: m.title.english,
    titles: [...new Set(names)],
    popularity: m.popularity ?? 0,
    country: m.countryOfOrigin,
  };
}
