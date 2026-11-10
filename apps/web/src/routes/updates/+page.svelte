<script lang="ts">
  import type { FeedItem } from "@hanyo/types";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { chapterLabel } from "$lib/format";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { markFeedSeen } from "$lib/feed-badge.svelte";

  let items = $state<FeedItem[] | null>(null);
  let error = $state<string | null>(null);
  let checking = $state(false);
  let toast = $state<string | null>(null);

  /** "Hoy", "Ayer", weekday this week, else the date. */
  function dayLabel(ms: number): string {
    const d = new Date(ms);
    const today = new Date();
    const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
    if (days <= 0) return "Hoy";
    if (days === 1) return "Ayer";
    if (days < 7) return d.toLocaleDateString("es-ES", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: days > 300 ? "numeric" : undefined });
  }

  const groups = $derived.by(() => {
    const out: { label: string; items: FeedItem[] }[] = [];
    for (const it of items ?? []) {
      const label = dayLabel(it.chapter.publishedAt!);
      if (out.at(-1)?.label === label) out.at(-1)!.items.push(it);
      else out.push({ label, items: [it] });
    }
    return out;
  });

  async function load() {
    try {
      items = await api.feed();
      error = null;
      markFeedSeen();
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

  async function download(it: FeedItem) {
    const st = downloads.status(it.chapter.id);
    if (st === "queued") return downloads.cancel(it.chapter.id);
    if (st !== "none") return;
    try {
      downloads.enqueue(await api.series(it.seriesId), [it.chapter]);
    } catch (e) {
      toast = (e as Error).message;
    }
  }

  onMount(load);
</script>

<PageHeader title="Novedades">
  {#snippet actions()}
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-fg active:bg-line"
      onclick={checkUpdates}
      aria-label="Buscar capítulos nuevos"
    >
      {#if checking}<Spinner size={18} />{:else}<Icon name="refresh" size={20} stroke={2} />{/if}
    </button>
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
    <div class="flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)] bg-surface text-accent-soft"><Icon name="bell" size={30} /></div>
    <h2 class="font-display mt-6 text-2xl font-bold tracking-tight">Nada nuevo todavía</h2>
    <p class="mt-1 text-sm text-muted">Aquí aparecen los capítulos que salen de las series de tu biblioteca.</p>
  </div>
{:else}
  {#each groups as g (g.label)}
    <section class="px-5 pb-2" aria-label={g.label}>
      <h2 class="pt-3 pb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">{g.label}</h2>
      <ul class="space-y-1">
        {#each g.items as it (it.chapter.id)}
          {@const st = downloads.status(it.chapter.id)}
          <li class="flex items-center gap-3">
            <a href="/series/{it.seriesId}" class="w-11 shrink-0" aria-label="Ficha de {it.seriesTitle}">
              <Cover src={it.coverUrl} alt={it.seriesTitle} rounded="rounded-[10px]" />
            </a>
            <a href="/read/{it.chapter.id}" class="min-w-0 flex-1 rounded-2xl py-1.5 active:bg-fg/5">
              <span class="block truncate text-xs text-muted">{it.seriesTitle}</span>
              <span class="flex items-center gap-2">
                <span class="truncate text-[15px] {it.chapter.read ? 'text-faint' : 'font-semibold'}">{chapterLabel(it.chapter.number, it.chapter.title)}</span>
                {#if !it.chapter.read}<span class="h-2 w-2 shrink-0 rounded-full bg-fresh" aria-label="Sin leer"></span>{/if}
              </span>
              <span class="block truncate text-xs text-faint">{it.chapter.sourceName}</span>
            </a>
            <button
              class="flex h-11 w-10 shrink-0 items-center justify-center {st === 'downloaded' ? 'text-ok' : 'text-muted'}"
              onclick={() => download(it)}
              aria-label={st === "none" ? `Descargar ${chapterLabel(it.chapter.number)} de ${it.seriesTitle}` : st === "downloaded" ? "Descargado" : "Descargando"}
            >
              {#if st === "downloaded"}<Icon name="check" size={17} stroke={2.6} />
              {:else if st === "active"}<Spinner size={17} />
              {:else if st === "queued"}<span class="h-2 w-2 rounded-full bg-muted"></span>
              {:else}<Icon name="download" size={18} stroke={2} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
{/if}
