import type { SearchHit, TitleCluster } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/search-real.json";
import { groupAndRank } from "./search-rank";

// Real responses captured on 2026-11-10 from MangaDex, Weeb Central, Asura Scans, Flame Comics and AniList.
const data = fixtures as Record<string, { hits: SearchHit[]; clusters: TitleCluster[] }>;
const run = (q: string, withAniList = true) => groupAndRank(q, data[q]!.hits, withAniList ? data[q]!.clusters : []);
const sources = (g: { hits: SearchHit[] }) => g.hits.map((h) => h.sourceName).sort();

describe("groupAndRank with real search results", () => {
  it("merges a series that sources name differently (Mount Hua Sect = Blossoming Blade)", () => {
    const [top] = run("return of the mount hua sect");
    expect(top!.title).toBe("Return of the Blossoming Blade");
    expect(sources(top!)).toEqual(expect.arrayContaining(["Asura Scans", "Weeb Central"]));
  });

  it("ranks the famous match first for a partial query", () => {
    expect(run("mount hua")[0]!.title).toBe("Return of the Blossoming Blade");
  });

  it("merges 'Omniscient Reader' and 'Omniscient Reader's Viewpoint'", () => {
    const groups = run("omniscient reader");
    const orv = groups.filter((g) => /omniscient reader/i.test(g.title) || g.aka.some((a) => /omniscient reader/i.test(a)));
    expect(orv).toHaveLength(1);
    expect(sources(orv[0]!).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps sequels separate and below the main series", () => {
    const groups = run("solo leveling");
    expect(groups[0]!.title).toBe("Solo Leveling");
    const ragnarok = groups.findIndex((g) => /ragnarok/i.test(g.title));
    expect(ragnarok).toBeGreaterThan(0);
    expect(groups[0]!.hits.some((h) => /ragnarok/i.test(h.title))).toBe(false);
  });

  it("puts the exact title first even with many partial matches", () => {
    expect(run("one piece")[0]!.title).toBe("One Piece");
    expect(run("tower of god")[0]!.title).toBe("Tower of God");
    expect(run("eleceed")[0]!.title).toBe("Eleceed");
  });

  it("still ranks the exact match first when AniList is unavailable", () => {
    const groups = run("return of the mount hua sect", false);
    expect(groups[0]!.title).toBe("Return of the Mount Hua Sect");
    expect(run("solo leveling", false)[0]!.title).toBe("Solo Leveling");
  });
});
