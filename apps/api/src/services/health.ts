import type { SourceHealth } from "@hanyo/types";
import type { DB } from "../db/index.js";
import type { ProviderRegistry } from "../providers/registry.js";
import type { PushPayload } from "./push.js";

/** A source is reported broken after this many failed checks in a row (one bad day is noise). */
const FAILURES_TO_ALERT = 2;
const CHECK_TIMEOUT_MS = 90_000;

interface Row {
  source_key: string;
  name: string;
  lang: string;
  ok: number;
  error: string | null;
  checked_at: number;
  failures: number;
  alerted: number;
}

/**
 * Daily check that every source still works from the server: it must list its popular series.
 * Sends a push when a source breaks (after FAILURES_TO_ALERT checks) and when it comes back.
 * If every Suwayomi source fails at once the cause is shared (Suwayomi, WARP or the network),
 * so one notification says that instead of one per source.
 */
export class SourceHealthService {
  private running: Promise<SourceHealth[]> | null = null;

  constructor(
    private readonly db: DB,
    private readonly registry: ProviderRegistry,
    private readonly notify: (p: PushPayload) => Promise<void>,
    private readonly log: (msg: string) => void = console.log,
  ) {}

  list(): SourceHealth[] {
    return this.db
      .prepare<[], Row>("SELECT * FROM source_health ORDER BY ok, name")
      .all()
      .map((r) => ({
        sourceKey: r.source_key,
        name: r.name,
        lang: r.lang,
        ok: r.ok === 1,
        error: r.error,
        checkedAt: r.checked_at,
        failures: r.failures,
      }));
  }

  checkAll(): Promise<SourceHealth[]> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  start(intervalMs = 24 * 3600_000, firstDelayMs = 5 * 60_000): void {
    const go = () => void this.checkAll().catch((e) => this.log(`health check failed: ${e}`));
    setTimeout(go, firstDelayMs).unref();
    setInterval(go, intervalMs).unref();
  }

  private async run(): Promise<SourceHealth[]> {
    const sources = await this.registry.listSources().catch(() => []);
    const results = new Map<string, string | null>();
    // A few at a time: Suwayomi and FlareSolverr are shared with readers.
    const queue = [...sources];
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        for (let s = queue.shift(); s; s = queue.shift()) results.set(s.key, await this.probe(s.key));
      }),
    );

    const prev = new Map(this.db.prepare<[], Row>("SELECT * FROM source_health").all().map((r) => [r.source_key, r]));
    const upsert = this.db.prepare(
      `INSERT INTO source_health (source_key, name, lang, ok, error, checked_at, failures, alerted)
       VALUES (@key, @name, @lang, @ok, @error, @at, @failures, @alerted)
       ON CONFLICT(source_key) DO UPDATE SET name = @name, lang = @lang, ok = @ok, error = @error,
         checked_at = @at, failures = @failures, alerted = @alerted`,
    );
    const broke: string[] = [];
    const recovered: string[] = [];
    const now = Date.now();
    for (const s of sources) {
      const error = results.get(s.key) ?? null;
      const before = prev.get(s.key);
      const failures = error ? (before?.failures ?? 0) + 1 : 0;
      let alerted = before?.alerted ?? 0;
      if (error && failures >= FAILURES_TO_ALERT && !alerted) {
        broke.push(s.name);
        alerted = 1;
      } else if (!error && alerted) {
        recovered.push(s.name);
        alerted = 0;
      }
      upsert.run({ key: s.key, name: s.name, lang: s.lang, ok: error ? 0 : 1, error, at: now, failures, alerted });
    }
    // Sources that were uninstalled stop being reported.
    const keys = new Set(sources.map((s) => s.key));
    for (const k of prev.keys()) if (!keys.has(k)) this.db.prepare("DELETE FROM source_health WHERE source_key = ?").run(k);

    const suwayomi = sources.filter((s) => s.provider === "suwayomi");
    const allSuwayomiDown = suwayomi.length >= 3 && suwayomi.every((s) => results.get(s.key));
    if (allSuwayomiDown && suwayomi.some((s) => broke.includes(s.name))) {
      await this.notify({
        title: "Las fuentes de Suwayomi no responden",
        body: "Fallan todas a la vez: probablemente Suwayomi o WARP están caídos en el servidor.",
        url: "/settings",
      });
    } else if (broke.length) {
      await this.notify({
        title: broke.length === 1 ? `${broke[0]} ha dejado de funcionar` : `${broke.length} fuentes han dejado de funcionar`,
        body: broke.length === 1 ? "Sus capítulos se leerán desde otras fuentes cuando sea posible." : broke.join(", "),
        url: "/settings",
      });
    }
    if (recovered.length) {
      await this.notify({
        title: recovered.length === 1 ? `${recovered[0]} vuelve a funcionar` : `${recovered.length} fuentes vuelven a funcionar`,
        body: recovered.join(", "),
        url: "/settings",
      });
    }
    const failed = [...results.values()].filter(Boolean).length;
    this.log(`health: ${sources.length - failed}/${sources.length} sources ok`);
    return this.list();
  }

  /** null when the source works, else a short reason. */
  private async probe(key: string): Promise<string | null> {
    try {
      const { provider, sourceId } = this.registry.resolve(key);
      const res = await Promise.race([
        provider.browse(sourceId, "popular", 1),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS).unref()),
      ]);
      return res.hits.length > 0 ? null : "no devuelve series";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/Cloudflare|403|5\d\d/i.test(msg)) return "bloqueada (Cloudflare)";
      if (/timeout|aborted/i.test(msg)) return "no respondió a tiempo";
      return msg.split("\n")[0]!.slice(0, 120);
    }
  }
}
