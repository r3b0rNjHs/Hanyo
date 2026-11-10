<script lang="ts">
  import type { SeriesSummary } from "@hanyo/types";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { chapterLabel } from "$lib/format";

  let items = $state<SeriesSummary[] | null>(null);
  let error = $state<string | null>(null);
  let checking = $state(false);
  let toast = $state<string | null>(null);
  let filter = $state<"all" | "unread" | "downloaded">("all");

  const downloadedSeries = $derived(new Set([...downloads.records.values()].map((r) => r.seriesId)));
  const continueReading = $derived(
    (items ?? []).filter((s) => s.lastReadChapter !== null && s.nextChapter !== null).slice(0, 8),
  );
  const visible = $derived(
    (items ?? []).filter((s) =>
      filter === "unread" ? s.unreadCount > 0 : filter === "downloaded" ? downloadedSeries.has(s.id) : true,
    ),
  );

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

<PageHeader title="Biblioteca" subtitle={items ? `${items.length} series` : undefined}>
  {#snippet actions()}
    <button
      class="flex h-10 w-10 items-center justify-center rounded-full text-ink-200 active:bg-white/10"
      onclick={checkUpdates}
      aria-label="Buscar capítulos nuevos"
    >
      {#if checking}<Spinner size={20} />{:else}<Icon name="refresh" />{/if}
    </button>
  {/snippet}
</PageHeader>

{#if toast}
  <div class="fixed inset-x-0 top-[calc(var(--safe-top)+64px)] z-30 flex justify-center">
    <div class="rounded-full bg-ink-700 px-4 py-2 text-sm font-medium shadow-lg">{toast}</div>
  </div>
{/if}

{#if items === null && !error}
  <div class="flex justify-center py-24"><Spinner /></div>
{:else if error && items === null}
  <p class="px-6 py-24 text-center text-ink-400">{error}</p>
{:else if items && items.length === 0}
  <div class="flex flex-col items-center px-10 py-24 text-center">
    <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-850 text-hanji-300">
      <Icon name="library" size={30} />
    </div>
    <h2 class="mt-5 text-lg font-semibold">Tu biblioteca está vacía</h2>
    <p class="mt-1 text-sm text-ink-400">Busca una serie y pulsa «Añadir» para tenerla siempre al día.</p>
    <a href="/search" class="mt-6 rounded-full bg-hanji-300 px-5 py-2.5 text-sm font-semibold text-ink-950">
      Buscar series
    </a>
  </div>
{:else if items}
  {#if continueReading.length > 0}
    <section class="mt-1">
      <h2 class="px-4 text-[15px] font-semibold text-ink-200">Continuar leyendo</h2>
      <div class="no-scrollbar mt-2.5 flex gap-3 overflow-x-auto px-4 pb-1">
        {#each continueReading as s (s.id)}
          <a href="/series/{s.id}?resume=1" class="w-[38%] max-w-40 shrink-0">
            <Cover src={s.coverUrl} alt={s.title} />
            <p class="mt-1.5 truncate text-[13px] font-medium">{s.title}</p>
            <p class="text-xs text-hanji-300">Sigue: {chapterLabel(s.nextChapter)}</p>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <div class="no-scrollbar mt-5 flex gap-2 overflow-x-auto px-4">
    {#each [["all", "Todas"], ["unread", "Con capítulos nuevos"], ["downloaded", "Descargadas"]] as const as [key, label] (key)}
      <button
        onclick={() => (filter = key)}
        class="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium {filter === key
          ? 'bg-ink-100 text-ink-950'
          : 'bg-ink-850 text-ink-200'}">{label}</button
      >
    {/each}
  </div>

  <div class="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 px-4">
    {#each visible as s (s.id)}
      <a href="/series/{s.id}" class="min-w-0">
        <div class="relative">
          <Cover src={s.coverUrl} alt={s.title} />
          {#if s.unreadCount > 0}
            <span
              class="absolute top-1.5 left-1.5 rounded-md bg-hanji-300 px-1.5 py-0.5 text-[11px] font-bold text-ink-950"
              >{s.unreadCount}</span
            >
          {/if}
          {#if downloadedSeries.has(s.id)}
            <span class="absolute top-1.5 right-1.5 rounded-md bg-ink-950/80 p-1 text-ink-100">
              <Icon name="download" size={12} stroke={2.4} />
            </span>
          {/if}
        </div>
        <p class="mt-1.5 line-clamp-2 text-[13px] leading-snug font-medium">{s.title}</p>
      </a>
    {/each}
  </div>
{/if}
