<script lang="ts">
  import type { SearchHit, SourceInfo } from "@hanyo/types";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { normalizeTitle } from "$lib/text";

  interface Group {
    key: string;
    title: string;
    cover: string | null;
    hits: SearchHit[];
  }

  let sources = $state<SourceInfo[]>([]);
  let query = $state(page.url.searchParams.get("q") ?? "");
  let groups = $state<Group[]>([]);
  let pending = $state<Set<string>>(new Set());
  let failed = $state<Array<{ name: string; error: string }>>([]);
  let searched = $state(false);
  let opening = $state<string | null>(null);
  let controller: AbortController | null = null;
  let input: HTMLInputElement;

  onMount(async () => {
    sources = await api.sources().catch(() => []);
    if (query) void run();
    else input.focus();
  });

  async function run(e?: SubmitEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    input.blur();
    history.replaceState(history.state, "", `/search?q=${encodeURIComponent(q)}`);
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    groups = [];
    failed = [];
    searched = true;
    pending = new Set(sources.map((s) => s.key));

    // Every source searches in parallel; results stream into the list as they arrive.
    await Promise.all(
      sources.map(async (s) => {
        try {
          const res = await api.search(s.key, q, signal);
          if (signal.aborted) return;
          if (res.error) failed = [...failed, { name: s.name, error: res.error }];
          merge(res.hits);
        } catch (err) {
          if (!signal.aborted) failed = [...failed, { name: s.name, error: (err as Error).message }];
        } finally {
          if (!signal.aborted) {
            const next = new Set(pending);
            next.delete(s.key);
            pending = next;
          }
        }
      }),
    );
  }

  function merge(hits: SearchHit[]) {
    const next = [...groups];
    for (const h of hits) {
      const key = normalizeTitle(h.title);
      const g = next.find((x) => x.key === key);
      if (g) {
        if (!g.hits.some((x) => x.sourceKey === h.sourceKey)) g.hits = [...g.hits, h];
        g.cover ??= h.coverUrl;
      } else {
        next.push({ key, title: h.title, cover: h.coverUrl, hits: [h] });
      }
    }
    // Series found on more sources first (usually the "real" match), keep arrival order otherwise.
    groups = next.sort((a, b) => b.hits.length - a.hits.length);
  }

  async function open(g: Group) {
    opening = g.key;
    try {
      const [first, ...others] = [...g.hits].sort((a, b) => (a.sourceKey === "mangadex" ? -1 : b.sourceKey === "mangadex" ? 1 : 0));
      const { id } = await api.openSeries(first!.sourceKey, first!.externalId);
      // Link the same series on the other sources so the chapter list is complete.
      for (const o of others) {
        await fetch(`/api/series/${id}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceKey: o.sourceKey, externalId: o.externalId }),
        }).catch(() => null);
      }
      await goto(`/series/${id}`);
    } catch (e) {
      failed = [...failed, { name: g.title, error: (e as Error).message }];
    } finally {
      opening = null;
    }
  }
</script>

<div class="pt-safe sticky top-0 z-20 bg-ink-950/85 px-4 pt-3 pb-3 backdrop-blur-xl">
  <h1 class="text-[28px] font-bold tracking-tight">Buscar</h1>
  <form class="relative mt-2" onsubmit={run}>
    <span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500"><Icon name="search" size={18} /></span>
    <input
      bind:this={input}
      bind:value={query}
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      autocapitalize="off"
      placeholder="Solo Leveling, Mount Hua, Eleceed…"
      class="w-full rounded-xl bg-ink-850 py-2.5 pr-3 pl-10 text-base outline-none placeholder:text-ink-500"
    />
  </form>
  {#if sources.length > 0}
    <p class="mt-2 text-xs text-ink-500">
      Busca en {sources.length} fuentes: {sources.map((s) => s.name).join(" · ")}
    </p>
  {/if}
</div>

{#if pending.size > 0}
  <div class="flex items-center gap-2 px-4 py-2 text-xs text-ink-400">
    <Spinner size={14} />
    Buscando en {[...pending].map((k) => sources.find((s) => s.key === k)?.name ?? k).join(", ")}…
  </div>
{/if}

<ul class="divide-y divide-white/5">
  {#each groups as g (g.key)}
    <li>
      <button class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5" onclick={() => open(g)}>
        <Cover src={g.cover} alt={g.title} class="w-16 shrink-0 rounded-lg" />
        <div class="min-w-0 flex-1">
          <p class="line-clamp-2 font-semibold leading-snug">{g.title}</p>
          <div class="mt-1.5 flex flex-wrap gap-1">
            {#each g.hits as h (h.sourceKey)}
              <span class="rounded-md bg-ink-800 px-1.5 py-0.5 text-[11px] font-medium text-ink-200">{h.sourceName}</span>
            {/each}
          </div>
        </div>
        {#if opening === g.key}<Spinner size={18} />{:else}<Icon name="back" size={18} class="rotate-180 text-ink-500" />{/if}
      </button>
    </li>
  {/each}
</ul>

{#if searched && pending.size === 0 && groups.length === 0}
  <p class="px-6 py-16 text-center text-ink-400">Sin resultados para «{query}».</p>
{/if}

{#if failed.length > 0 && pending.size === 0}
  <div class="mx-4 mt-4 rounded-xl bg-ink-900 p-3 text-xs text-ink-400">
    {#each failed as f (f.name)}
      <p><span class="font-semibold text-ink-200">{f.name}</span> no respondió: {f.error}</p>
    {/each}
  </div>
{/if}
