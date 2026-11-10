<script lang="ts">
  import type { ExploreKind, SearchHit, SourceInfo, TrendingOrigin } from "@hanyo/types";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  const STORE = "hanyo.explore";
  const langOf = (s: SourceInfo) => (s.lang === "all" ? "en" : s.lang.split("-")[0]!);

  let sources = $state<SourceInfo[]>([]);
  let lang = $state("en");
  let kind = $state<ExploreKind>("popular");
  /** "trending" = AniList trending (any source); otherwise a source key. */
  const TRENDING = "trending";
  let sourceKey = $state(TRENDING);
  let origin = $state<TrendingOrigin>("KR");

  /** A grid entry: either a source's own series, or an AniList title to look up on every source. */
  interface Item {
    id: string;
    title: string;
    coverUrl: string | null;
    hit?: SearchHit;
  }
  let hits = $state<Item[]>([]);
  let page = $state(0);
  let hasNext = $state(true);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let opening = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  /** Bumped on every filter change so late responses for the old filter are dropped. */
  let generation = 0;

  const langSources = $derived(sources.filter((s) => langOf(s) === lang));
  const langs = $derived([...new Set(sources.map(langOf))].sort());
  const langNames: Record<string, string> = { en: "Inglés", es: "Español" };

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ lang, kind, sourceKey, origin }));
    } catch {}
  }

  function reset() {
    generation++;
    hits = [];
    page = 0;
    hasNext = true;
    error = null;
    loading = false;
    save();
    void more();
  }

  async function more() {
    if (loading || !hasNext || !sourceKey) return;
    loading = true;
    const gen = generation;
    try {
      let items: Item[];
      let next: boolean;
      if (sourceKey === TRENDING) {
        const r = await api.trending(origin, page + 1);
        items = r.items.map((i) => ({ id: `al${i.cluster.id}`, title: i.cluster.title, coverUrl: i.coverUrl }));
        next = r.hasNextPage;
      } else {
        const r = await api.explore(sourceKey, kind, page + 1);
        items = r.hits.map((h) => ({ id: h.externalId, title: h.title, coverUrl: h.coverUrl, hit: h }));
        next = r.hasNextPage;
      }
      if (gen !== generation) return;
      // Sources repeat entries across pages; keep the first.
      const seen = new Set(hits.map((h) => h.id));
      hits = [...hits, ...items.filter((h) => !seen.has(h.id))];
      page += 1;
      hasNext = next && items.length > 0;
    } catch (e) {
      if (gen === generation) error = (e as Error).message;
    } finally {
      if (gen === generation) loading = false;
    }
  }

  function pickLang(l: string) {
    lang = l;
    if (sourceKey !== TRENDING) sourceKey = langSources[0]?.key ?? "";
    reset();
  }

  async function open(item: Item) {
    // Trending titles aren't tied to a source: search them everywhere (search merges by AniList names).
    if (!item.hit) return goto(`/search?q=${encodeURIComponent(item.title)}`);
    const h = item.hit;
    opening = item.id;
    try {
      const { id } = await api.openSeries(h.sourceKey, h.externalId);
      await goto(`/series/${id}`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      opening = null;
    }
  }

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (saved.lang) lang = saved.lang;
      if (saved.kind) kind = saved.kind;
      if (saved.sourceKey) sourceKey = saved.sourceKey;
      if (saved.origin) origin = saved.origin;
    } catch {}
    api
      .sources()
      .then((list) => {
        sources = list;
        if (sourceKey !== TRENDING && !langSources.some((s) => s.key === sourceKey)) sourceKey = TRENDING;
        reset();
      })
      .catch((e) => (error = (e as Error).message));
  });

  // Infinite scroll: load the next page when the end of the grid comes into view.
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void more(), {
      rootMargin: "600px",
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  // Keep the selected source chip visible.
  $effect(() => {
    void sourceKey;
    document.querySelector(`[data-source="${CSS.escape(sourceKey)}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  });
</script>

<PageHeader title="Explorar" />

<div role="tablist" aria-label="Fuente" class="no-scrollbar flex gap-2 overflow-x-auto px-5">
  <button
    role="tab"
    data-source={TRENDING}
    aria-selected={sourceKey === TRENDING}
    onclick={() => { sourceKey = TRENDING; reset(); }}
    class="h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold {sourceKey === TRENDING ? 'bg-accent text-on-accent' : 'bg-raised text-soft'}"
  >Tendencias</button>
  {#each langSources as s (s.key)}
    <button
      role="tab"
      data-source={s.key}
      aria-selected={sourceKey === s.key}
      onclick={() => { sourceKey = s.key; reset(); }}
      class="h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold {sourceKey === s.key ? 'bg-accent text-on-accent' : 'bg-raised text-soft'}"
    >{s.name}</button>
  {/each}
</div>

<div class="mt-3 space-y-3 px-5">
  {#if sourceKey === TRENDING}
    <div class="grid grid-cols-4 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Origen">
      {#each [["KR", "Manhwa"], ["JP", "Manga"], ["CN", "Manhua"], ["all", "Todo"]] as const as [o, label] (o)}
        <button
          role="radio"
          aria-checked={origin === o}
          onclick={() => { origin = o; reset(); }}
          class="h-9 rounded-full text-[13px] font-semibold {origin === o ? 'bg-accent text-on-accent' : 'text-soft'}"
        >{label}</button>
      {/each}
    </div>
    <p class="px-1 text-xs text-muted">Lo más leído ahora mismo según AniList. Toca una serie para buscarla en tus fuentes.</p>
  {:else}
  <div class="grid grid-cols-2 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Orden">
    {#each [["popular", "Populares"], ["latest", "Novedades"]] as const as [k, label] (k)}
      <button
        role="radio"
        aria-checked={kind === k}
        onclick={() => { kind = k; reset(); }}
        class="h-9 rounded-full text-[13px] font-semibold {kind === k ? 'bg-accent text-on-accent' : 'text-soft'}"
      >{label}</button>
    {/each}
  </div>
  {/if}
  {#if langs.length > 1 && sourceKey !== TRENDING}
    <div class="flex gap-2" role="radiogroup" aria-label="Idioma">
      {#each langs as l (l)}
        <button
          role="radio"
          aria-checked={lang === l}
          onclick={() => pickLang(l)}
          class="h-8 rounded-full px-3.5 text-[13px] font-semibold {lang === l ? 'bg-fg text-base' : 'bg-raised text-soft'}"
        >{langNames[l] ?? l.toUpperCase()}</button>
      {/each}
    </div>
  {/if}
</div>



<div class="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 px-5">
  {#each hits as h (h.id)}
    <button class="relative min-w-0 self-start text-left" onclick={() => open(h)} disabled={opening !== null}>
      <Cover src={h.coverUrl} alt={h.title} />
      {#if opening === h.id}
        <div class="absolute inset-0 flex aspect-[3/4] items-center justify-center rounded-[var(--radius-card)] bg-base/60"><Spinner /></div>
      {/if}
      <p class="mt-1.5 line-clamp-2 text-[13px] leading-snug font-semibold">{h.title}</p>
    </button>
  {/each}
</div>

{#if error}
  <div class="px-6 py-10 text-center">
    <p class="text-sm text-muted">{error}</p>
    <button class="mt-3 h-9 rounded-full bg-raised px-4 text-sm font-semibold" onclick={() => { error = null; void more(); }}>Reintentar</button>
  </div>
{:else if loading}
  <div class="flex justify-center py-10"><Spinner /></div>
{:else if !hasNext && hits.length === 0}
  <p class="px-6 py-16 text-center text-sm text-muted">Esta fuente no tiene nada que mostrar aquí.</p>
{/if}
<div bind:this={sentinel} class="h-px"></div>
