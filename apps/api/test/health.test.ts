import type { SourceInfo } from "@hanyo/types";
import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { ProviderRegistry } from "../src/providers/registry.js";
import type { Provider } from "../src/providers/types.js";
import type { PushPayload } from "../src/services/push.js";
import { SourceHealthService } from "../src/services/health.js";

class Fake implements Provider {
  broken = new Set<string>();
  constructor(
    readonly id: "mangadex" | "suwayomi",
    private readonly sources: SourceInfo[],
  ) {}
  async listSources() {
    return this.sources;
  }
  async browse(sourceId: string) {
    if (this.broken.has(sourceId)) throw new Error("HTTP error 403 (Cloudflare)");
    return { hits: [{ externalId: "1", title: "X", coverUrl: null }], hasNextPage: false };
  }
  async search() {
    return [];
  }
  async getSeries(): Promise<never> {
    throw new Error("unused");
  }
  async getPageUrls() {
    return [];
  }
  async fetchImage() {
    return { bytes: Buffer.alloc(0), contentType: "image/jpeg" };
  }
  allowsImageUrl() {
    return true;
  }
}

const src = (id: string, name: string): SourceInfo => ({
  key: `suwayomi:${id}`,
  provider: "suwayomi",
  sourceId: id,
  name,
  lang: "en",
  iconUrl: null,
});

function setup(n = 4) {
  const suwa = new Fake("suwayomi", Array.from({ length: n }, (_, i) => src(String(i), `Source ${i}`)));
  const sent: PushPayload[] = [];
  const health = new SourceHealthService(openMemoryDb(), new ProviderRegistry([suwa]), async (p) => void sent.push(p), () => {});
  return { suwa, sent, health };
}

describe("SourceHealthService", () => {
  it("alerts after two failed checks in a row, once, and again when it recovers", async () => {
    const { suwa, sent, health } = setup();
    suwa.broken.add("1");
    await health.checkAll();
    expect(sent).toEqual([]);
    expect(health.list().find((h) => h.name === "Source 1")).toMatchObject({ ok: false, failures: 1 });

    await health.checkAll();
    expect(sent.map((s) => s.title)).toEqual(["Source 1 ha dejado de funcionar"]);
    await health.checkAll();
    expect(sent).toHaveLength(1);

    suwa.broken.clear();
    await health.checkAll();
    expect(sent.map((s) => s.title).at(-1)).toBe("Source 1 vuelve a funcionar");
  });

  it("sends one shared alert when every Suwayomi source fails", async () => {
    const { suwa, sent, health } = setup();
    for (const i of ["0", "1", "2", "3"]) suwa.broken.add(i);
    await health.checkAll();
    await health.checkAll();
    expect(sent.map((s) => s.title)).toEqual(["Las fuentes de Suwayomi no responden"]);
  });
});
