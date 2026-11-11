<script lang="ts">
  import type { ExploreKind, SearchHit, SourceInfo, TrendingOrigin, TrendingSort } from "@hanyo/types";
  import { openByNames } from "$lib/resolve";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { libraryLinks } from "$lib/library-links";

  const STORE = "hanyo.explore";
  const langOf = (s: SourceInfo) => (s.lang === "all" ? "en" : s.lang.split("-")[0]!);

  let sources = $state<SourceInfo[]>([]);
  let lang = $state("en");
  let kind = $state<ExploreKind>("popular");
  /** "trending" = AniList trending (any source); otherwise a source key. */
  const TRENDING = "trending";
  let sourceKey = $state(TRENDING);
  let origin = $state<TrendingOrigin>("KR");
  /** AniList genre names (sent as-is) with their Spanish label. */
  const GENRES: [string, string][] = [
    ["", "Todos"],
    ["Action", "Acción"],
    ["Fantasy", "Fantasía"],
    ["Romance", "Romance"],
    ["Drama", "Drama"],
    ["Comedy", "Comedia"],
    ["Adventure", "Aventura"],
    ["Supernatural", "Sobrenatural"],
    ["Psychological", "Psicológico"],
    ["Mystery", "Misterio"],
    ["Thriller", "Thriller"],
    ["Horror", "Terror"],
    ["Sci-Fi", "Ciencia ficción"],
    ["Slice of Life", "Cotidiano"],
    ["Sports", "Deportes"],
    ["Ecchi", "Ecchi"],
    ["Hentai", "Hentai"],
  ];
  let genre = $state("");
  let genreOpen = $state(false);
  let sort = $state<TrendingSort>("trending");
  const SORT_LABELS: Record<TrendingSort, string> = { trending: "Tendencia", popular: "Más populares", score: "Mejor valoradas" };

  /** A grid entry: either a source's own series, or an AniList title to look up on every source. */
  interface Item {
    id: string;
    title: string;
    coverUrl: string | null;
    hit?: SearchHit;
    /** Every name AniList knows (trending items), used to find it on the sources. */
    titles?: string[];
  }
  let hits = $state<Item[]>([]);
  let owned = $state(new Map<string, number>());
  const ownedId = (item: Item) => (item.hit ? owned.get(`${item.hit.sourceKey}|${item.hit.externalId}`) : undefined);
  let page = $state(0);
  let hasNext = $state(true);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let opening = $state<string | null>(null);
  let sentinel = $state<HTMLElement | null>(null);
  /** Bumped on every filter change so late responses for the old filter are dropped. */
  let generation = 0;

  const langSources = $derived(sources.filter((s) => langOf(s) === lang));
  /** Some sources have no "latest" listing: Novedades is disabled there and Populares used. */
  const noLatest = $derived(sources.find((s) => s.key === sourceKey)?.supportsLatest === false);
  const langs = $derived([...new Set(sources.map(langOf))].sort());
  const langNames: Record<string, string> = { en: "Inglés", es: "Español" };

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ lang, kind, sourceKey, origin, genre, sort }));
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
        const r = await api.trending(origin, page + 1, genre || undefined, sort);
        items = r.items.map((i) => ({ id: `al${i.cluster.id}`, title: i.cluster.title, coverUrl: i.coverUrl, titles: i.cluster.titles }));
        next = r.hasNextPage;
      } else {
        const r = await api.explore(sourceKey, noLatest ? "popular" : kind, page + 1);
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
    // Trending titles aren't tied to a source: the server finds them by name and opens the series.
    if (!item.hit) {
      opening = item.id;
      try {
        await openByNames(item.title, item.titles ?? []);
      } catch (e) {
        error = (e as Error).message;
      } finally {
        opening = null;
      }
      return;
    }
    const h = item.hit;
    const mine = ownedId(item);
    if (mine !== undefined) return goto(`/series/${mine}`);
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
    void libraryLinks().then((m) => (owned = m));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "{}");
      if (saved.lang) lang = saved.lang;
      if (saved.kind) kind = saved.kind;
      if (saved.sourceKey) sourceKey = saved.sourceKey;
      if (saved.origin) origin = saved.origin;
      if (typeof saved.genre === "string") genre = saved.genre;
      if (saved.sort === "popular" || saved.sort === "score") sort = saved.sort;
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

<!-- Search lives here: one place to find something new. -->
<a
  href="/search"
  class="mx-5 mb-3 flex h-12 items-center gap-2.5 rounded-full bg-surface px-4 text-[15px] text-muted active:bg-raised"
>
  <Icon name="search" size={18} stroke={2} /> Buscar en todas las fuentes…
</a>

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

<!-- One row of controls: what to show (+ genre / language on the side). -->
<div class="mt-3 flex items-center gap-2 px-5">
  {#if sourceKey === TRENDING}
    <div class="grid flex-1 grid-cols-4 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Origen">
      {#each [["KR", "Manhwa"], ["JP", "Manga"], ["CN", "Manhua"], ["all", "Todo"]] as const as [o, label] (o)}
        <button
          role="radio"
          aria-checked={origin === o}
          onclick={() => { origin = o; reset(); }}
          class="h-9 rounded-full text-[13px] font-semibold {origin === o ? 'bg-accent text-on-accent' : 'text-soft'}"
        >{label}</button>
      {/each}
    </div>
    <button
      class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full {genre || sort !== 'trending' ? 'bg-accent/20 text-accent-soft' : 'bg-surface text-soft'}"
      onclick={() => (genreOpen = true)}
      aria-label="Filtros: {GENRES.find(([g]) => g === genre)?.[1] ?? 'Todos'}, {SORT_LABELS[sort]}"
    >
      <Icon name="sliders" size={18} stroke={2} />
      {#if genre || sort !== "trending"}<span class="absolute top-2 right-2 h-2 w-2 rounded-full bg-accent"></span>{/if}
    </button>
  {:else}
    <div class="grid flex-1 grid-cols-2 gap-1 rounded-full bg-surface p-1" role="radiogroup" aria-label="Orden">
      {#each [["popular", "Populares"], ["latest", "Novedades"]] as const as [k, label] (k)}
        <button
          role="radio"
          aria-checked={(noLatest ? "popular" : kind) === k}
          disabled={k === "latest" && noLatest}
          onclick={() => { kind = k; reset(); }}
          class="h-9 rounded-full text-[13px] font-semibold disabled:opacity-40 {(noLatest ? 'popular' : kind) === k ? 'bg-accent text-on-accent' : 'text-soft'}"
        >{label}</button>
      {/each}
    </div>
    {#if langs.length > 1}
      <div class="flex shrink-0 gap-0.5 rounded-full bg-surface p-1" role="radiogroup" aria-label="Idioma">
        {#each langs as l (l)}
          <button
            role="radio"
            aria-checked={lang === l}
            aria-label={langNames[l] ?? l}
            onclick={() => pickLang(l)}
            class="h-9 rounded-full px-3 text-[12px] font-bold uppercase {lang === l ? 'bg-fg text-base' : 'text-muted'}"
          >{l}</button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
{#if sourceKey === TRENDING && (genre || sort !== "trending")}
  <p class="mt-2 px-6 text-xs text-muted">
    {SORT_LABELS[sort]}{#if genre} · <span class="font-semibold text-soft">{GENRES.find(([g]) => g === genre)?.[1]}</span>{/if}
    · <button class="text-accent-soft" onclick={() => { genre = ""; sort = "trending"; reset(); }}>quitar filtros</button>
  </p>
{/if}

{#if genreOpen}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (genreOpen = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-5" role="dialog" aria-label="Género">
    <p class="font-display text-lg font-semibold">Ordenar por</p>
    <div class="mt-3 grid grid-cols-3 gap-1 rounded-full bg-base p-1" role="radiogroup" aria-label="Ordenar por">
      {#each Object.entries(SORT_LABELS) as [k, label] (k)}
        <button
          role="radio"
          aria-checked={sort === k}
          onclick={() => { sort = k as TrendingSort; reset(); }}
          class="h-9 rounded-full text-[12px] font-semibold {sort === k ? 'bg-accent text-on-accent' : 'text-soft'}"
        >{label}</button>
      {/each}
    </div>
    <p class="mt-1.5 text-xs text-muted">
      {sort === "trending" ? "Lo que más se está leyendo estos días." : sort === "popular" ? "Las más seguidas de siempre." : "Las mejor puntuadas por los lectores."}
    </p>
    <p class="font-display mt-5 text-lg font-semibold">Género</p>
    <div class="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Géneros">
      {#each GENRES as [g, label] (g)}
        <button
          role="radio"
          aria-checked={genre === g}
          onclick={() => { genre = g; genreOpen = false; reset(); }}
          class="h-9 rounded-full px-4 text-[13px] font-semibold {genre === g ? 'bg-accent text-on-accent' : 'bg-base text-soft'}"
        >{label}</button>
      {/each}
    </div>
    <button class="mt-4 h-12 w-full rounded-full bg-line font-semibold" onclick={() => (genreOpen = false)}>Cerrar</button>
  </div>
{/if}



<div class="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 px-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">
  {#each hits as h (h.id)}
    <button class="relative min-w-0 self-start text-left transition-transform duration-150 [@media(hover:hover)]:hover:-translate-y-0.5" onclick={() => open(h)} disabled={opening !== null}>
      <Cover src={h.coverUrl} alt={h.title} />
      {#if ownedId(h) !== undefined}
        <span class="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-on-accent" aria-label="En tu biblioteca">
          <Icon name="bookmark" size={13} filled stroke={2.2} />
        </span>
      {/if}
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
