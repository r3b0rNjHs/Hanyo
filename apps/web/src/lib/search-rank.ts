import type { SearchHit, TitleCluster } from "@hanyo/types";
import { normalizeTitle } from "./text";

export interface ResultGroup {
  key: string;
  title: string;
  cover: string | null;
  hits: SearchHit[];
  /** Other names the series goes by (shown as "También: …"). */
  aka: string[];
  score: number;
}

/** How many groups are shown before "Mostrar más". */
export const PRIMARY_RESULTS = 8;

/**
 * Turn raw per-source hits into one result per series, best match first.
 *
 * Grouping: a hit joins a group when any of its names (title + alt titles) matches any name of
 * the group, using AniList clusters to bridge different names for the same series
 * ("Return of the Blossoming Blade" on one site, "Return of the Mount Hua Sect" on another).
 *
 * Ranking (higher first):
 *   text match against the query (exact 100, prefix 78, contains 70, word overlap up to 60)
 * + popularity from AniList (12 × log10, ~0–65): what most people mean by an ambiguous query
 * + 5 per extra source that has it (max 15)
 * + up to 10 for appearing early in a source's own ranking
 */
export function groupAndRank(query: string, hits: SearchHit[], clusters: TitleCluster[]): ResultGroup[] {
  const q = normalizeTitle(query);
  // A name can belong to several AniList entries ("One Piece" is also a synonym of an obscure
  // "Wan Piece"). The entry whose main title it is wins; otherwise the most popular one.
  const clusterOf = new Map<string, { cluster: TitleCluster; main: boolean }>();
  for (const c of clusters) {
    const main = normalizeTitle(c.title);
    for (const t of c.titles) {
      const n = normalizeTitle(t);
      const isMain = n === main;
      const prev = clusterOf.get(n);
      if (!prev || (isMain && !prev.main) || (isMain === prev.main && c.popularity > prev.cluster.popularity)) {
        clusterOf.set(n, { cluster: c, main: isMain });
      }
    }
  }

  interface Building {
    key: string;
    names: Set<string>;
    hits: SearchHit[];
    cluster: TitleCluster | null;
    bestRank: number;
  }
  const groups: Building[] = [];
  const rankInSource = new Map<string, number>();

  for (const h of hits) {
    const rank = rankInSource.get(h.sourceKey) ?? 0;
    rankInSource.set(h.sourceKey, rank + 1);

    const names = [h.title, ...(h.altTitles ?? [])].map(normalizeTitle).filter(Boolean);
    const cluster = names.map((n) => clusterOf.get(n)?.cluster).find(Boolean) ?? null;
    const allNames = new Set([...names, ...(cluster ? cluster.titles.map(normalizeTitle) : [])]);

    const target =
      (cluster && groups.find((g) => g.cluster?.id === cluster.id)) ??
      // Without AniList, fall back to shared names (exact title or a MangaDex alt title).
      groups.find((g) => (!cluster || !g.cluster) && names.some((n) => g.names.has(n)));

    if (target) {
      if (!target.hits.some((x) => x.sourceKey === h.sourceKey)) target.hits.push(h);
      for (const n of allNames) target.names.add(n);
      target.cluster ??= cluster;
      target.bestRank = Math.min(target.bestRank, rank);
    } else {
      groups.push({ key: cluster ? `al:${cluster.id}` : `t:${names[0]}`, names: allNames, hits: [h], cluster, bestRank: rank });
    }
  }

  return groups
    .map<ResultGroup>((g) => {
      const text = Math.max(0, ...[...g.names].map((n) => textScore(q, n)));
      const popularity = g.cluster ? 12 * Math.log10(g.cluster.popularity + 1) : 0;
      const sources = Math.min(15, 5 * (new Set(g.hits.map((h) => h.sourceKey)).size - 1));
      const position = Math.max(0, 10 - 2 * g.bestRank);
      // Official English title when AniList has one; otherwise the name sources actually use
      // ("Volcanic Age"), which reads better than a romanization ("Hwasanjeonsaeng").
      const title = g.cluster?.englishTitle ?? g.hits[0]!.title;
      return {
        key: g.key,
        title,
        cover: g.hits.find((h) => h.coverUrl)?.coverUrl ?? null,
        hits: g.hits,
        aka: displayAka(title, g),
        score: Math.round(text + popularity + sources + position),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function textScore(q: string, name: string): number {
  if (!q || !name) return 0;
  if (name === q) return 100;
  // Starting with the query is only slightly better than containing it: for multi-word titles
  // both mean "related", and popularity should decide between them.
  if (name.startsWith(q)) return 78;
  if (name.includes(q)) return 70;
  const qWords = q.split(" ");
  const nWords = new Set(name.split(" "));
  const shared = qWords.filter((w) => nWords.has(w)).length;
  return Math.round((shared / qWords.length) * 60);
}

/** Names from other sources that differ from the display title (Latin script only, max 2). */
function displayAka(title: string, g: { hits: SearchHit[] }): string[] {
  const shown = normalizeTitle(title);
  const seen = new Set([shown]);
  const out: string[] = [];
  for (const h of g.hits) {
    const n = normalizeTitle(h.title);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(h.title);
  }
  return out.slice(0, 2);
}
