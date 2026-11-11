<script lang="ts">
  import type { SearchHit, SourceInfo, TitleCluster } from "@hanyo/types";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { groupAndRank, PRIMARY_RESULTS, type ResultGroup } from "$lib/search-rank";
  import { libraryLinks } from "$lib/library-links";

  let sources = $state<SourceInfo[]>([]);
  let query = $state(page.url.searchParams.get("q") ?? "");
  let hits = $state<SearchHit[]>([]);
  let clusters = $state<TitleCluster[]>([]);
  let searchedQuery = $state("");
  let showAll = $state(false);
  // One card per series (merged across sources and alternative names), best match first.
  const groups = $derived(groupAndRank(searchedQuery, hits, clusters));
  const visible = $derived(showAll ? groups : groups.slice(0, PRIMARY_RESULTS));
  let pending = $state<Set<string>>(new Set());
  let failed = $state<Array<{ name: string; error: string }>>([]);
  let searched = $state(false);
  let opening = $state<string | null>(null);
  let controller: AbortController | null = null;
  let input: HTMLInputElement;

  let owned = $state(new Map<string, number>());
  /** Library series id if any hit of the group is already in the library. */
  const ownedId = (g: ResultGroup) => g.hits.map((h) => owned.get(`${h.sourceKey}|${h.externalId}`)).find((id) => id !== undefined);

  onMount(async () => {
    void libraryLinks().then((m) => (owned = m));
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
    hits = [];
    clusters = [];
    searchedQuery = q;
    showAll = false;
    failed = [];
    searched = true;
    // Alternative names + popularity (AniList); optional, results work without it.
    void api.searchMeta(q, signal).then(
      (m) => {
        if (!signal.aborted) clusters = m.clusters;
      },
      () => undefined,
    );
    pending = new Set(sources.map((s) => s.key));

    // Every source searches in parallel; results stream into the list as they arrive.
    await Promise.all(
      sources.map(async (s) => {
        try {
          const res = await api.search(s.key, q, signal);
          if (signal.aborted) return;
          if (res.error) failed = [...failed, { name: s.name, error: res.error }];
          hits = [...hits, ...res.hits];
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

  async function open(g: ResultGroup) {
    const mine = ownedId(g);
    if (mine !== undefined) return goto(`/series/${mine}`);
    opening = g.key;
    try {
      // Open the English version when there is one (MangaDex first); the series page can switch language.
      const rank = (h: SearchHit) => (h.sourceKey === "mangadex" ? 0 : h.lang === "en" ? 1 : 2);
      const [first, ...others] = [...g.hits].sort((a, b) => rank(a) - rank(b));
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

<!-- Lists read best in a column on wide screens. -->
<div class="lg:mx-auto lg:max-w-3xl">

<div class="pt-safe sticky top-0 z-20 bg-base/90 px-5 pt-4 pb-3 backdrop-blur-xl">
  <div class="flex items-center justify-between">
    <h1 class="font-display text-[30px] leading-tight font-bold tracking-[-0.03em]">Buscar</h1>
    <a href="/explore" class="text-[15px] font-semibold text-accent-soft">Cancelar</a>
  </div>
  <form class="relative mt-3" onsubmit={run} role="search">
    <span class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"><Icon name="search" size={19} stroke={2} /></span>
    <label for="q" class="sr-only">Buscar series</label>
    <input
      id="q"
      bind:this={input}
      bind:value={query}
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      autocapitalize="off"
      placeholder="Solo Leveling, Mount Hua, Eleceed…"
      class="h-12 w-full rounded-full bg-raised pr-4 pl-11 text-base outline-none placeholder:text-faint focus:ring-2 focus:ring-accent/60"
    />
  </form>
  {#if sources.length > 0}
    <div class="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
      {#each sources as src (src.key)}
        {@const busy = pending.has(src.key)}
        {@const bad = failed.some((f) => f.name === src.name)}
        <span class="flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs {bad ? 'text-danger' : 'text-muted'}">
          {#if busy}<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"></span>{:else if searched && !bad}<span class="h-1.5 w-1.5 rounded-full bg-ok"></span>{/if}
          {src.name}
        </span>
      {/each}
    </div>
  {/if}
</div>

<ul class="mt-1 space-y-2 px-5">
  {#each visible as g (g.key)}
    <li>
      <button class="flex w-full items-center gap-3.5 rounded-[var(--radius-card)] bg-surface p-2.5 pr-3 text-left active:bg-raised" onclick={() => open(g)}>
        <Cover src={g.cover} alt={g.title} class="w-[68px] shrink-0" rounded="rounded-[14px]" />
        <div class="min-w-0 flex-1">
          <p class="font-display line-clamp-2 text-[17px] leading-snug font-semibold tracking-tight">{g.title}</p>
          {#if g.aka.length}<p class="mt-0.5 truncate text-xs text-muted">También: {g.aka.join(" · ")}</p>{/if}
          {#if ownedId(g) !== undefined}<p class="mt-1 flex items-center gap-1 text-xs font-semibold text-accent-soft"><Icon name="bookmark" size={12} filled /> En tu biblioteca</p>{/if}
          <div class="mt-2 flex flex-wrap gap-1">
            {#each g.hits as h (h.sourceKey)}
              <span class="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-soft">{h.sourceName}<span class="ml-1 text-faint uppercase">{h.lang}</span></span>
            {/each}
          </div>
        </div>
        {#if opening === g.key}<Spinner size={18} />{:else}<Icon name="chevronRight" size={20} class="shrink-0 text-faint" />{/if}
      </button>
    </li>
  {/each}
</ul>

{#if groups.length > visible.length}
  <div class="px-5">
    <button class="mt-3 h-12 w-full rounded-full bg-raised text-sm font-semibold text-soft" onclick={() => (showAll = true)}>
      Mostrar {groups.length - visible.length} resultados menos relevantes
    </button>
  </div>
{/if}

{#if searched && pending.size === 0 && groups.length === 0}
  <p class="px-6 py-16 text-center text-muted">Sin resultados para «{query}».</p>
{/if}

{#if !searched}
  <div class="px-8 py-16 text-center">
    <p class="font-display text-xl font-bold">¿Qué quieres leer?</p>
    <p class="mt-2 text-sm text-muted">Buscamos a la vez en todas las fuentes y juntamos la misma serie aunque cada web la llame distinto.</p>
  </div>
{/if}

{#if failed.length > 0 && pending.size === 0}
  <div class="mx-5 mt-4 rounded-[var(--radius-card)] bg-surface p-3.5 text-xs text-muted">
    {#each failed as f (f.name)}
      <p><span class="font-semibold text-soft">{f.name}</span> no respondió: {f.error}</p>
    {/each}
  </div>
{/if}
</div>
