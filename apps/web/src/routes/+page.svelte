<script lang="ts">
  import type { SeriesSummary } from "@hanyo/types";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { chapterLabel, SHELVES } from "$lib/format";

  type Filter = "all" | "new" | "downloaded" | SeriesSummary["shelf"];
  const FILTERS: (readonly [Filter, string])[] = [["all", "Todas"], ["new", "Nuevos"], ...SHELVES, ["downloaded", "Descargadas"]];

  let items = $state<SeriesSummary[] | null>(null);
  let error = $state<string | null>(null);
  let checking = $state(false);
  let toast = $state<string | null>(null);
  let filter = $state<Filter>("all");

  const downloadedSeries = $derived(new Set([...downloads.records.values()].map((r) => r.seriesId)));
  /** Started series with something left to read: the "Leyendo" carousel. */
  const reading = $derived((items ?? []).filter((s) => s.lastReadChapter !== null && s.nextChapter !== null).slice(0, 10));
  /** New chapters since where you left off. */
  const hasNew = (s: SeriesSummary) => s.lastReadChapter !== null && s.unreadCount > 0;
  const matches = (s: SeriesSummary, f: Filter) =>
    f === "all" ? true : f === "new" ? hasNew(s) : f === "downloaded" ? downloadedSeries.has(s.id) : s.shelf === f;
  const counts = $derived(Object.fromEntries(FILTERS.map(([f]) => [f, (items ?? []).filter((s) => matches(s, f)).length])));
  /** Empty lists stay hidden so the chip row stays short. */
  const shownFilters = $derived(FILTERS.filter(([f]) => f === "all" || f === "new" || f === filter || counts[f]! > 0));
  type Sort = "updated" | "read" | "title";
  let sort = $state<Sort>(
    (() => {
      try {
        const v = localStorage.getItem("hanyo.library.sort");
        return v === "read" || v === "title" ? v : "updated";
      } catch {
        return "updated";
      }
    })(),
  );
  $effect(() => {
    try {
      localStorage.setItem("hanyo.library.sort", sort);
    } catch {}
  });
  const sorters: Record<Sort, (a: SeriesSummary, b: SeriesSummary) => number> = {
    updated: (a, b) => b.updatedAt - a.updatedAt,
    read: (a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.updatedAt - a.updatedAt,
    title: (a, b) => a.title.localeCompare(b.title, "es", { sensitivity: "base" }),
  };
  const visible = $derived((items ?? []).filter((s) => matches(s, filter)).sort(sorters[sort]));

  function progress(s: SeriesSummary): number {
    if (!s.latestChapter || s.lastReadChapter === null) return 0;
    return Math.min(100, Math.round((s.lastReadChapter / s.latestChapter) * 100));
  }

  function meta(s: SeriesSummary): string {
    if (s.lastReadChapter === null) return s.latestChapter ? `Sin empezar · ${s.latestChapter} caps.` : "Sin empezar";
    if (s.nextChapter === null) return "Al día";
    return `Cap. ${fmt(s.nextChapter)} · ${s.unreadCount} sin leer`;
  }

  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  async function load() {
    try {
      items = await api.library();
      error = null;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function checkUpdates() {
    checking = true;
    try {
      const r = await api.checkUpdates();
      toast = r.newChapters > 0 ? `${r.newChapters} capítulos nuevos` : "Todo al día";
      await load();
    } catch (e) {
      toast = (e as Error).message;
    } finally {
      checking = false;
      setTimeout(() => (toast = null), 2500);
    }
  }

  onMount(load);
</script>

<PageHeader title="Tu biblioteca">
  {#snippet actions()}
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-fg active:bg-line"
      onclick={checkUpdates}
      aria-label="Buscar capítulos nuevos"
    >
      {#if checking}<Spinner size={18} />{:else}<Icon name="refresh" size={20} stroke={2} />{/if}
    </button>
    <a href="/settings" class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-fg active:bg-line" aria-label="Ajustes">
      <Icon name="settings" size={20} stroke={2} />
    </a>
  {/snippet}
</PageHeader>

{#if toast}
  <div class="fixed inset-x-0 top-[calc(var(--safe-top)+76px)] z-30 flex justify-center px-4" role="status">
    <div class="rounded-full bg-raised px-4 py-2 text-sm font-medium shadow-lg">{toast}</div>
  </div>
{/if}

{#if items === null && !error}
  <div class="flex justify-center py-24"><Spinner /></div>
{:else if error && items === null}
  <p class="px-6 py-24 text-center text-muted">{error}</p>
{:else if items && items.length === 0}
  <div class="flex flex-col items-center px-10 py-20 text-center">
    <div class="flex h-20 w-20 items-center justify-center rounded-[var(--radius-panel)] bg-accent text-on-accent">
      <Icon name="library" size={34} stroke={2} />
    </div>
    <h2 class="font-display mt-6 text-2xl font-bold tracking-tight">Empieza tu biblioteca</h2>
    <p class="mt-2 text-[15px] text-muted">Busca una serie y pulsa «Añadir»: la tendrás siempre al día y podrás descargarla.</p>
    <a href="/search" class="mt-7 flex h-[52px] items-center gap-2 rounded-full bg-accent px-6 font-bold text-on-accent">
      <Icon name="search" size={18} stroke={2.4} /> Buscar series
    </a>
  </div>
{:else if items}
  {#if reading.length > 0}
    <section aria-label="Leyendo ahora" class="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 pt-1 pb-1">
      {#each reading as s (s.id)}
        <a
          href="/series/{s.id}?resume=1"
          class="flex h-[188px] w-[78%] max-w-[300px] shrink-0 snap-start overflow-hidden rounded-[var(--radius-panel)] border border-line/70 bg-surface"
        >
          <Cover src={s.coverUrl} alt={s.title} rounded="rounded-none" class="h-full w-[118px] shrink-0 !aspect-auto" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-4">
            <span class="text-xs text-muted">Leyendo</span>
            <span class="font-display line-clamp-2 text-xl leading-tight font-semibold tracking-tight">{s.title}</span>
            <span class="text-[13px] text-soft">{chapterLabel(s.nextChapter).replace("Capítulo", "Cap.")}{s.latestChapter ? ` de ${fmt(s.latestChapter)}` : ""}</span>
            <div class="mt-auto flex items-center gap-2.5">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={progress(s)} aria-valuemin="0" aria-valuemax="100" aria-label="Progreso">
                <div class="h-full rounded-full bg-accent" style="width: {progress(s)}%"></div>
              </div>
              <span class="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent" aria-hidden="true">
                <Icon name="play" size={14} filled />
              </span>
            </div>
          </div>
        </a>
      {/each}
    </section>
  {/if}

  <div role="tablist" aria-label="Filtros" class="no-scrollbar mt-5 flex gap-2 overflow-x-auto px-5">
    {#each shownFilters as [key, label] (key)}
      {@const selected = filter === key}
      <button
        role="tab"
        aria-selected={selected}
        onclick={() => (filter = key)}
        class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold {selected
          ? 'bg-accent text-on-accent'
          : 'bg-raised text-soft'}"
      >
        {label}
        {#if key === "new" && counts.new > 0}
          <span class="rounded-lg bg-fresh px-1.5 text-[11px] leading-[18px] font-bold text-on-fresh">{counts.new}</span>
        {:else if key !== "new"}
          <span class={selected ? "" : "text-muted"}>· {counts[key]}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="mt-3 flex justify-end px-5">
    <label class="flex items-center gap-1.5 text-xs text-muted">
      <Icon name="sliders" size={14} />
      <span class="sr-only">Ordenar</span>
      <select bind:value={sort} class="bg-transparent font-semibold text-soft" aria-label="Ordenar">
        <option value="updated">Actualizadas</option>
        <option value="read">Leídas recientemente</option>
        <option value="title">Título A–Z</option>
      </select>
    </label>
  </div>

  {#if visible.length === 0}
    <p class="px-6 py-16 text-center text-sm text-muted">
      {filter === "new"
        ? "No hay capítulos nuevos en las series que sigues."
        : filter === "downloaded"
          ? "Todavía no has descargado nada."
          : "No hay series en esta lista."}
    </p>
  {:else}
    <div class="mt-2 grid grid-cols-2 gap-x-3.5 gap-y-5 px-5">
      {#each visible as s (s.id)}
        <a href="/series/{s.id}" class="min-w-0">
          <div class="relative">
            <Cover src={s.coverUrl} alt={s.title} />
            {#if hasNew(s)}
              <span class="absolute top-2.5 left-2.5 rounded-[10px] bg-fresh px-2 py-0.5 text-xs font-bold text-on-fresh">+{s.unreadCount}</span>
            {/if}
            {#if downloadedSeries.has(s.id)}
              <span class="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-base/80 text-fg" aria-label="Descargada">
                <Icon name="download" size={14} stroke={2.4} />
              </span>
            {/if}
          </div>
          <p class="mt-2 truncate text-[14px] font-semibold">{s.title}</p>
          <p class="truncate text-xs text-muted">{meta(s)}</p>
        </a>
      {/each}
    </div>
  {/if}
{/if}
