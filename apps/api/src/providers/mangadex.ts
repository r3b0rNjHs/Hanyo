import type { SeriesStatus, SourceInfo } from "@hanyo/types";
import { fetchJson, fetchOk } from "../lib/http.js";
import { RateLimiter } from "../lib/ratelimit.js";
import type { Provider, RawChapter, RawHit, RawSeries } from "./types.js";

const API = "https://api.mangadex.org";
const UPLOADS = "https://uploads.mangadex.org";
const CONTENT_RATINGS = ["safe", "suggestive", "erotica"];
const LANG = "en";

interface MdRelationship {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}
interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Array<Record<string, string>>;
    description: Record<string, string>;
    status: string;
    tags: Array<{ attributes: { name: Record<string, string> } }>;
  };
  relationships: MdRelationship[];
}
interface MdChapter {
  id: string;
  attributes: {
    chapter: string | null;
    title: string | null;
    publishAt: string;
    pages: number;
    externalUrl: string | null;
  };
  relationships: MdRelationship[];
}

/**
 * MangaDex API v5. Docs: https://api.mangadex.org/docs/
 * Limits: ~5 req/s global per IP, 40/min for /at-home/server. We stay under both.
 */
export class MangaDexProvider implements Provider {
  readonly id = "mangadex" as const;
  private readonly api = new RateLimiter(4, 1000);
  private readonly atHome = new RateLimiter(35, 60_000);
  /** uploads.mangadex.org returns 403/429 on bursts (e.g. a grid of covers): pace and retry. */
  private readonly uploads = new RateLimiter(3, 1000);

  constructor(private readonly userAgent: string) {}

  async listSources(): Promise<SourceInfo[]> {
    return [
      {
        key: "mangadex",
        provider: "mangadex",
        sourceId: "mangadex",
        name: "MangaDex",
        lang: LANG,
        iconUrl: null,
      },
    ];
  }

  async search(_sourceId: string, query: string): Promise<RawHit[]> {
    const params = new URLSearchParams({ title: query, limit: "24" });
    params.append("includes[]", "cover_art");
    params.append("availableTranslatedLanguage[]", LANG);
    params.append("order[relevance]", "desc");
    for (const r of CONTENT_RATINGS) params.append("contentRating[]", r);
    const res = await this.get<{ data: MdManga[] }>(`/manga?${params}`);
    return res.data.map((m) => ({
      externalId: m.id,
      title: pickTitle(m),
      altTitles: altTitles(m),
      coverUrl: coverUrl(m),
    }));
  }

  async getSeries(_sourceId: string, externalId: string): Promise<RawSeries> {
    const params = new URLSearchParams();
    for (const inc of ["cover_art", "author", "artist"]) params.append("includes[]", inc);
    const { data: m } = await this.get<{ data: MdManga }>(`/manga/${externalId}?${params}`);
    const chapters = await this.getChapters(externalId);

    const people = m.relationships
      .filter((r) => r.type === "author" || r.type === "artist")
      .map((r) => String(r.attributes?.name ?? ""))
      .filter(Boolean);

    return {
      externalId,
      title: pickTitle(m),
      coverUrl: coverUrl(m, 512),
      description: m.attributes.description.en ?? Object.values(m.attributes.description)[0] ?? null,
      authors: [...new Set(people)],
      genres: m.attributes.tags.map((t) => t.attributes.name.en ?? "").filter(Boolean),
      status: mapStatus(m.attributes.status),
      url: `https://mangadex.org/title/${externalId}`,
      chapters,
    };
  }

  private async getChapters(mangaId: string): Promise<RawChapter[]> {
    const out: RawChapter[] = [];
    let offset = 0;
    for (;;) {
      const params = new URLSearchParams({ limit: "500", offset: String(offset) });
      params.append("translatedLanguage[]", LANG);
      params.append("order[chapter]", "asc");
      params.append("includes[]", "scanlation_group");
      for (const r of CONTENT_RATINGS) params.append("contentRating[]", r);
      const res = await this.get<{ data: MdChapter[]; total: number }>(`/manga/${mangaId}/feed?${params}`);
      for (const c of res.data) {
        // External chapters (official sites) and empty uploads can't be read here.
        if (c.attributes.externalUrl || c.attributes.pages === 0) continue;
        const group = c.relationships.find((r) => r.type === "scanlation_group");
        out.push({
          externalId: c.id,
          number: c.attributes.chapter ? Number.parseFloat(c.attributes.chapter) : null,
          title: c.attributes.title || null,
          scanlator: group?.attributes?.name ? String(group.attributes.name) : null,
          publishedAt: Date.parse(c.attributes.publishAt) || null,
          sourceOrder: out.length,
        });
      }
      offset += res.data.length;
      // MangaDex rejects offset + limit > 10000.
      if (res.data.length === 0 || offset >= res.total || offset + 500 > 10_000) break;
    }
    return out;
  }

  async getPageUrls(_sourceId: string, chapterId: string): Promise<string[]> {
    const res = await this.atHome.schedule(() =>
      fetchJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(
        `${API}/at-home/server/${chapterId}`,
        { headers: { "User-Agent": this.userAgent } },
      ),
    );
    return res.chapter.data.map((f) => `${res.baseUrl}/data/${res.chapter.hash}/${f}`);
  }

  async fetchImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
    const started = Date.now();
    let ok = false;
    let bytes = Buffer.alloc(0);
    let cached = false;
    try {
      const res = await this.fetchImageWithRetry(url);
      bytes = Buffer.from(await res.arrayBuffer());
      cached = res.headers.get("x-cache")?.startsWith("HIT") ?? false;
      ok = true;
      return { bytes, contentType: res.headers.get("content-type") ?? "image/jpeg" };
    } finally {
      // MangaDex@Home asks clients to report image loads from non-mangadex.org nodes.
      if (!new URL(url).hostname.endsWith("mangadex.org")) {
        void this.report(url, ok, bytes.length, Date.now() - started, cached);
      }
    }
  }

  private async fetchImageWithRetry(url: string): Promise<Response> {
    const isUploads = new URL(url).hostname === "uploads.mangadex.org";
    for (let attempt = 0; ; attempt++) {
      const doFetch = () => fetchOk(url, { headers: { "User-Agent": this.userAgent }, timeoutMs: 30_000 });
      try {
        return await (isUploads ? this.uploads.schedule(doFetch) : doFetch());
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (attempt >= 3 || (status !== 403 && status !== 429 && status !== undefined && status < 500)) throw e;
        // Burst limits clear after a few seconds: back off 1s, 2s, 4s.
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }

  allowsImageUrl(url: string): boolean {
    const host = new URL(url).hostname;
    return host === "uploads.mangadex.org" || host.endsWith(".mangadex.network") || host.endsWith(".mangadex.org");
  }

  private async report(url: string, success: boolean, bytes: number, duration: number, cached: boolean) {
    try {
      await fetch("https://api.mangadex.network/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": this.userAgent },
        body: JSON.stringify({ url, success, bytes, duration, cached }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best effort.
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.api.schedule(() => fetchJson<T>(`${API}${path}`, { headers: { "User-Agent": this.userAgent } }));
  }
}

function pickTitle(m: MdManga): string {
  const t = m.attributes.title;
  const alt = m.attributes.altTitles.find((a) => a.en)?.en;
  return t.en ?? alt ?? Object.values(t)[0] ?? "Untitled";
}

/** Latin-script names only (English, romanized): the ones other sources use. */
function altTitles(m: MdManga): string[] {
  const all = [...Object.values(m.attributes.title), ...m.attributes.altTitles.flatMap((a) => Object.values(a))];
  return [...new Set(all.filter((t) => /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u.test(t)))].slice(0, 20);
}

function coverUrl(m: MdManga, size: 256 | 512 = 256): string | null {
  const rel = m.relationships.find((r) => r.type === "cover_art");
  const file = rel?.attributes?.fileName;
  return typeof file === "string" ? `${UPLOADS}/covers/${m.id}/${file}.${size}.jpg` : null;
}

function mapStatus(s: string): SeriesStatus {
  switch (s) {
    case "ongoing":
      return "ongoing";
    case "completed":
      return "completed";
    case "hiatus":
      return "hiatus";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}
