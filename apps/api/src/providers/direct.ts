import { fetchOk } from "../lib/http.js";

/**
 * Some sources' image hosts block the server's IP (Weeb Central's CDN rejects OVH through
 * Cloudflare, on IPv4 and IPv6) while their web pages still load. For those, hanyo-api reads
 * the chapter's image URLs from the source itself and the phone loads the images directly:
 * a home or mobile connection isn't blocked.
 */
export interface DirectImageSource {
  /** Name of the Suwayomi source this applies to (e.g. "Weeb Central"). */
  readonly sourceName: string;
  /** Absolute image URLs, in reading order, for a chapter page URL on the source's site. */
  pageUrls(chapterUrl: string): Promise<string[]>;
}

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** Weeb Central: the reader loads `/chapters/{id}/images` (htmx), a list of `<img alt="Page N">`. */
export class WeebCentralDirect implements DirectImageSource {
  readonly sourceName = "Weeb Central";

  async pageUrls(chapterUrl: string): Promise<string[]> {
    const url = new URL(chapterUrl, "https://weebcentral.com");
    const id = /\/chapters\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1];
    if (!id) throw new Error(`Unexpected Weeb Central chapter URL: ${chapterUrl}`);
    const res = await fetchOk(
      `https://weebcentral.com/chapters/${id}/images?is_prev=False&current_page=1&reading_style=long_strip`,
      { headers: { "User-Agent": UA, "HX-Request": "true" }, timeoutMs: 20_000 },
    );
    return parseWeebCentralImages(await res.text());
  }
}

export function parseWeebCentralImages(html: string): string[] {
  const pages: Array<{ n: number; src: string }> = [];
  for (const tag of html.match(/<img\b[^>]*>/gs) ?? []) {
    const src = /\bsrc="(https?:\/\/[^"]+)"/.exec(tag)?.[1];
    const n = /\balt="Page (\d+)"/.exec(tag)?.[1];
    if (src && n) pages.push({ n: Number(n), src });
  }
  return pages.sort((a, b) => a.n - b.n).map((p) => p.src);
}

export const DIRECT_SOURCES: DirectImageSource[] = [new WeebCentralDirect()];
