<script lang="ts">
  import type { FeedItem, HistoryItem } from "@hanyo/types";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import SwipeRow from "$lib/components/SwipeRow.svelte";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { chapterLabel, timeAgo } from "$lib/format";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { markFeedSeen } from "$lib/feed-badge.svelte";

  /** Two views of "what's going on": new chapters, and where you left each series. */
  const view = $derived(page.url.searchParams.get("view") === "history" ? "history" : "new");
  let history = $state<HistoryItem[] | null>(null);
  $effect(() => {
    if (view === "history") api.history().then((h) => (history = h), () => (history = history ?? []));
  });
  async function forget(it: HistoryItem) {
    history = (history ?? []).filter((h) => h.seriesId !== it.seriesId);
    await api.forgetHistory(it.seriesId).catch(() => undefined);
  }

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

  /** Days, and within a day one entry per series (several chapters of one series collapse). */
  interface Cluster {
    key: string;
    seriesId: number;
    seriesTitle: string;
    coverUrl: string | null;
    items: FeedItem[];
  }
  const groups = $derived.by(() => {
    const out: { label: string; clusters: Cluster[] }[] = [];
    for (const it of items ?? []) {
      const label = dayLabel(it.chapter.publishedAt!);
      if (out.at(-1)?.label !== label) out.push({ label, clusters: [] });
      const day = out.at(-1)!;
      const c = day.clusters.find((x) => x.seriesId === it.seriesId);
      if (c) c.items.push(it);
      else
        day.clusters.push({
          key: `${label}-${it.seriesId}`,
          seriesId: it.seriesId,
          seriesTitle: it.seriesTitle,
          coverUrl: it.coverUrl,
          items: [it],
        });
    }
    return out;
  });
  let expanded = $state(new Set<string>());
  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expanded = next;
  }
  const range = (c: Cluster) => {
    const nums = c.items.map((i) => i.chapter.number).filter((n): n is number => n !== null);
    return nums.length ? `Caps. ${Math.min(...nums)}–${Math.max(...nums)}` : `${c.items.length} capítulos`;
  };

  async function downloadAll(c: Cluster) {
    try {
      downloads.enqueue(await api.series(c.seriesId), c.items.map((i) => i.chapter));
    } catch (e) {
      toast = (e as Error).message;
    }
  }

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

<!-- Lists read best in a column on wide screens. -->
<div class="lg:mx-auto lg:max-w-3xl">

<PageHeader title="Novedades">
  {#snippet actions()}
    {#if view === "new"}
    <button
      class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-fg active:bg-line"
      onclick={checkUpdates}
      aria-label="Buscar capítulos nuevos"
    >
      {#if checking}<Spinner size={18} />{:else}<Icon name="refresh" size={20} stroke={2} />{/if}
    </button>
    {/if}
  {/snippet}
</PageHeader>

<div class="mx-5 mb-2 grid grid-cols-2 gap-1 rounded-full bg-surface p-1" role="tablist" aria-label="Vista">
  {#each [["new", "Capítulos nuevos", "/updates"], ["history", "Historial", "/updates?view=history"]] as const as [k, label, href] (k)}
    <button
      role="tab"
      aria-selected={view === k}
      onclick={() => goto(href, { replaceState: true, noScroll: true })}
      class="h-9 rounded-full text-[13px] font-semibold {view === k ? 'bg-accent text-on-accent' : 'text-soft'}"
    >{label}</button>
  {/each}
</div>

{#if view === "history"}
  <a href="/stats" class="mx-5 mt-1 mb-2 flex items-center gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3">
    <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent-soft"><Icon name="sliders" size={18} stroke={2} /></span>
    <span class="min-w-0 flex-1">
      <span class="block font-semibold">Tus estadísticas</span>
      <span class="block text-xs text-muted">Racha, capítulos por semana, géneros…</span>
    </span>
    <Icon name="chevronRight" size={18} class="text-muted" />
  </a>
  {#if history === null}
    <div class="flex justify-center py-24"><Spinner /></div>
  {:else if history.length === 0}
    <p class="px-8 py-20 text-center text-sm text-muted">Aquí verás lo último que has leído, para seguir donde lo dejaste.</p>
  {:else}
    <ul class="px-5 pt-1">
      {#each history as it (it.seriesId)}
        <li>
          <SwipeRow width={96}>
            {#snippet actions(close)}
              <button class="flex-1 bg-danger text-xs font-semibold text-white" onclick={() => { close(); void forget(it); }}>Quitar</button>
            {/snippet}
            <div class="flex items-center gap-3 py-1.5">
              <a href="/series/{it.seriesId}" class="w-11 shrink-0" aria-label="Ficha de {it.seriesTitle}">
                <Cover src={it.coverUrl} alt={it.seriesTitle} rounded="rounded-[10px]" />
              </a>
              <a href="/read/{it.chapterId}" class="min-w-0 flex-1">
                <span class="block truncate text-[15px] font-semibold">{it.seriesTitle}</span>
                <span class="block truncate text-xs text-muted">{chapterLabel(it.chapterNumber)}{it.page > 0 ? ` · pág. ${it.page + 1}` : ""} · {timeAgo(it.readAt)}</span>
              </a>
              <a href="/read/{it.chapterId}" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent" aria-label="Seguir leyendo {it.seriesTitle}">
                <Icon name="play" size={14} filled />
              </a>
            </div>
          </SwipeRow>
        </li>
      {/each}
    </ul>
    <p class="px-8 pt-3 pb-6 text-center text-xs text-faint">Desliza una serie a la izquierda para quitarla del historial.</p>
  {/if}
{:else}

{#if toast}
  <div class="fixed inset-x-0 top-[calc(var(--safe-top)+76px)] z-30 flex justify-center px-4" role="status">
    <div class="rounded-full bg-raised px-4 py-2 text-sm font-medium shadow-lg">{toast}</div>
  </div>
{/if}

{#snippet row(it: FeedItem, withCover: boolean)}
  {@const st = downloads.status(it.chapter.id)}
  <li class="flex items-center gap-3 {withCover ? '' : 'pl-14'}">
    {#if withCover}
      <a href="/series/{it.seriesId}" class="w-11 shrink-0" aria-label="Ficha de {it.seriesTitle}">
        <Cover src={it.coverUrl} alt={it.seriesTitle} rounded="rounded-[10px]" />
      </a>
    {/if}
    <a href="/read/{it.chapter.id}" class="min-w-0 flex-1 rounded-2xl py-1.5 active:bg-fg/5">
      {#if withCover}<span class="block truncate text-xs text-muted">{it.seriesTitle}</span>{/if}
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
{/snippet}

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
        {#each g.clusters as c (c.key)}
          {#if c.items.length === 1}
            {@render row(c.items[0]!, true)}
          {:else}
            {@const unreadN = c.items.filter((i) => !i.chapter.read).length}
            {@const allDone = c.items.every((i) => downloads.status(i.chapter.id) === "downloaded")}
            <li class="flex items-center gap-3">
              <a href="/series/{c.seriesId}" class="w-11 shrink-0" aria-label="Ficha de {c.seriesTitle}">
                <Cover src={c.coverUrl} alt={c.seriesTitle} rounded="rounded-[10px]" />
              </a>
              <button class="min-w-0 flex-1 rounded-2xl py-1.5 text-left active:bg-fg/5" onclick={() => toggle(c.key)} aria-expanded={expanded.has(c.key)}>
                <span class="block truncate text-xs text-muted">{c.seriesTitle}</span>
                <span class="flex items-center gap-2">
                  <span class="truncate text-[15px] font-semibold">{range(c)}</span>
                  {#if unreadN}<span class="shrink-0 rounded-md bg-fresh px-1.5 text-[10px] leading-[18px] font-bold text-on-fresh">{unreadN} nuevos</span>{/if}
                </span>
                <span class="flex items-center gap-1 text-xs text-faint">{expanded.has(c.key) ? "Ocultar" : "Ver capítulos"} <Icon name="chevronRight" size={12} class="transition-transform {expanded.has(c.key) ? 'rotate-90' : ''}" /></span>
              </button>
              <button
                class="flex h-11 w-10 shrink-0 items-center justify-center {allDone ? 'text-ok' : 'text-muted'}"
                onclick={() => downloadAll(c)}
                aria-label={allDone ? "Descargados" : `Descargar los ${c.items.length} de ${c.seriesTitle}`}
              >
                {#if allDone}<Icon name="check" size={17} stroke={2.6} />{:else}<Icon name="download" size={18} stroke={2} />{/if}
              </button>
            </li>
            {#if expanded.has(c.key)}
              {#each c.items as it (it.chapter.id)}{@render row(it, false)}{/each}
            {/if}
          {/if}
        {/each}
      </ul>
    </section>
  {/each}
{/if}
{/if}
</div>
