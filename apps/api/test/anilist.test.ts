import { describe, expect, it, vi } from "vitest";
import { AniListTitles, toCluster } from "../src/services/anilist.js";

const media = {
  id: 1,
  countryOfOrigin: "KR",
  popularity: 46542,
  title: { romaji: "Hwasangwihwan", english: "Return of the Blossoming Blade", native: "화산귀환" },
  synonyms: ["Return of The Mount Hua Sect", "Return of the Mount Hua Sect"],
};

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

describe("AniListTitles", () => {
  it("maps every known name into one cluster with English as display title", () => {
    const c = toCluster(media);
    expect(c.title).toBe("Return of the Blossoming Blade");
    expect(c.titles).toContain("Return of The Mount Hua Sect");
    expect(c.titles).toContain("Hwasangwihwan");
    expect(c.popularity).toBe(46542);
  });

  it("caches lookups per query", async () => {
    const f = vi.fn(() => ok({ data: { Page: { media: [media] } } }));
    const al = new AniListTitles(f as unknown as typeof fetch);
    expect(await al.lookup("mount hua")).toHaveLength(1);
    expect(await al.lookup("Mount Hua ")).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never breaks search: errors and bad responses give no clusters", async () => {
    const failing = new AniListTitles((() => Promise.reject(new Error("down"))) as unknown as typeof fetch);
    expect(await failing.lookup("x")).toEqual([]);
    const limited = new AniListTitles((() => Promise.resolve(new Response("", { status: 429 }))) as unknown as typeof fetch);
    expect(await limited.lookup("x")).toEqual([]);
  });
});

describe("AniListTitles.trending", () => {
  it("maps trending media with covers and filters by country", async () => {
    let sent: { variables: Record<string, unknown> } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          data: {
            Page: {
              pageInfo: { hasNextPage: true },
              media: [
                {
                  id: 1,
                  countryOfOrigin: "KR",
                  popularity: 9,
                  title: { romaji: "Hwasan Gwihwan", english: "Return of the Blossoming Blade", native: null },
                  synonyms: ["Return of the Mount Hua Sect"],
                  coverImage: { large: "https://s4.anilist.co/c.jpg" },
                },
              ],
            },
          },
        }),
      );
    }) as unknown as typeof fetch;
    const r = await new AniListTitles(fake).trending("KR", 2, "Romance");
    expect(sent!.variables).toEqual({ page: 2, country: "KR", genre: "Romance" });
    expect(r.hasNextPage).toBe(true);
    expect(r.items[0]!.cluster.title).toBe("Return of the Blossoming Blade");
    expect(r.items[0]!.coverUrl).toBe("https://s4.anilist.co/c.jpg");
  });
});
