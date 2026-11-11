<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { connection } from "$lib/connection.svelte";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { chapterLabel, formatBytes } from "$lib/format";

  let quota = $state<{ usage: number; quota: number } | null>(null);
  let open = $state<number | null>(null);
  const groups = $derived(downloads.bySeries());

  /** Downloaded chapters you've already read (needs the server to know read state). */
  let readIds = $state<number[]>([]);
  const readBytes = $derived(readIds.reduce((n, id) => n + (downloads.records.get(id)?.bytes ?? 0), 0));
  let clearing = $state(false);

  async function findRead() {
    if (!connection.online) return;
    const ids: number[] = [];
    for (const g of downloads.bySeries()) {
      try {
        const s = await api.series(g.seriesId);
        for (const c of s.chapters) if (c.read && downloads.records.has(c.id)) ids.push(c.id);
      } catch {
        // Series gone or offline: keep its downloads.
      }
    }
    readIds = ids;
  }

  let confirmAll = $state(false);
  let clearingAll = $state(false);
  async function clearAll() {
    clearingAll = true;
    downloads.cancelAll();
    await downloads.remove([...downloads.records.keys()]);
    readIds = [];
    clearingAll = false;
    confirmAll = false;
  }

  async function clearRead() {
    clearing = true;
    await downloads.remove(readIds);
    readIds = [];
    clearing = false;
  }

  onMount(async () => {
    await downloads.init();
    void findRead();
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) quota = { usage: est.usage ?? 0, quota: est.quota };
    } catch {
      // ignore
    }
  });
</script>

<!-- Lists read best in a column on wide screens. -->
<div class="lg:mx-auto lg:max-w-3xl">

<PageHeader title="Descargas" subtitle="{formatBytes(downloads.totalBytes)} en este dispositivo">
  {#snippet actions()}
    {#if downloads.records.size > 0}
      <button
        class="flex h-11 w-11 items-center justify-center rounded-full bg-raised text-danger active:bg-line"
        onclick={() => (confirmAll = true)}
        aria-label="Eliminar todas las descargas"
      >
        <Icon name="trash" size={19} stroke={2} />
      </button>
    {/if}
  {/snippet}
</PageHeader>

{#if confirmAll}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (confirmAll = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-5" role="alertdialog" aria-label="Eliminar todas las descargas">
    <p class="font-display text-lg font-semibold">¿Eliminar todas las descargas?</p>
    <p class="mt-1 text-sm text-muted">
      Se borrarán {downloads.records.size} {downloads.records.size === 1 ? "capítulo" : "capítulos"} ({formatBytes(downloads.totalBytes)}) de este dispositivo
      {downloads.queue.length ? " y se cancelará la cola" : ""}. Tu progreso de lectura no se pierde.
    </p>
    <button class="mt-4 h-12 w-full rounded-full bg-danger font-bold text-white disabled:opacity-60" disabled={clearingAll} onclick={clearAll}>
      {clearingAll ? "Eliminando…" : "Eliminar todo"}
    </button>
    <button class="mt-1 h-12 w-full rounded-full font-semibold text-muted" onclick={() => (confirmAll = false)}>Cancelar</button>
  </div>
{/if}

{#if quota}
  <div class="mx-4 mb-4">
    <div class="h-1.5 overflow-hidden rounded-full bg-raised">
      <div class="h-full rounded-full bg-accent" style="width: {Math.min(100, (quota.usage / quota.quota) * 100).toFixed(1)}%"></div>
    </div>
    <p class="mt-1.5 text-xs text-faint">{formatBytes(quota.usage)} usados de {formatBytes(quota.quota)} disponibles para Hanyo</p>
  </div>
{/if}

{#if readIds.length > 0}
  <div class="mx-4 mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3">
    <span class="min-w-0 text-sm">
      <span class="block font-semibold">{readIds.length} {readIds.length === 1 ? "capítulo ya leído" : "capítulos ya leídos"}</span>
      <span class="block text-xs text-muted">Libera {formatBytes(readBytes)}</span>
    </span>
    <button class="h-9 shrink-0 rounded-full bg-raised px-4 text-sm font-semibold text-danger" disabled={clearing} onclick={clearRead}>Borrar</button>
  </div>
{/if}

{#if downloads.active || downloads.queue.length}
  <section class="mx-4 mb-5 rounded-[var(--radius-card)] bg-surface p-4">
    <div class="flex items-center justify-between">
      <h2 class="font-display font-semibold">En cola · {downloads.queue.length + (downloads.active ? 1 : 0)}</h2>
      <button class="text-sm text-muted" onclick={() => downloads.cancelAll()}>Cancelar todo</button>
    </div>
    {#if downloads.active}
      {@const a = downloads.active}
      <p class="mt-3 truncate text-sm">{a.series.title} · {chapterLabel(a.chapter.number, a.chapter.title)}</p>
      <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
        <div class="h-full rounded-full bg-accent transition-all" style="width: {a.total ? (a.done / a.total) * 100 : 0}%"></div>
      </div>
      <p class="mt-1 text-xs text-faint">{a.done}/{a.total} páginas · mantén la app abierta</p>
    {/if}
    {#if downloads.error}<p class="mt-2 text-xs text-danger">{downloads.error}</p>{/if}
  </section>
{/if}

{#if groups.length === 0 && !downloads.active}
  <div class="flex flex-col items-center px-10 py-20 text-center">
    <div class="flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)] bg-surface text-accent-soft"><Icon name="download" size={30} /></div>
    <h2 class="font-display mt-6 text-2xl font-bold tracking-tight">Nada descargado todavía</h2>
    <p class="mt-1 text-sm text-muted">En la ficha de una serie, pulsa «Descargar» para leer sin conexión.</p>
  </div>
{:else}
  <ul class="space-y-2 px-4">
    {#each groups as g (g.seriesId)}
      <li class="overflow-hidden rounded-[var(--radius-card)] bg-surface">
        <button class="flex w-full items-center gap-3 p-3 text-left" onclick={() => (open = open === g.seriesId ? null : g.seriesId)}>
          <Cover src={g.cover} alt={g.title} class="w-12 shrink-0" rounded="rounded-[12px]" />
          <div class="min-w-0 flex-1">
            <p class="font-display truncate font-semibold">{g.title}</p>
            <p class="text-xs text-muted">{g.chapters.length} capítulos{g.bytes ? ` · ${formatBytes(g.bytes)}` : ""}</p>
          </div>
          <Icon name="back" size={18} class="text-faint transition-transform {open === g.seriesId ? 'rotate-90' : '-rotate-90'}" />
        </button>
        {#if open === g.seriesId}
          <div class="border-t border-fg/5">
            {#each g.chapters as c (c.chapterId)}
              <div class="flex items-center gap-2 border-b border-fg/5 pl-4 last:border-0">
                <a href="/read/{c.chapterId}" class="flex-1 py-2.5 text-sm">{chapterLabel(c.chapterNumber, c.chapterTitle)}</a>
                <span class="text-xs text-faint">{c.bytes ? formatBytes(c.bytes) : "directo"}</span>
                <button class="flex h-10 w-10 items-center justify-center text-muted" onclick={() => downloads.remove([c.chapterId])} aria-label="Eliminar">
                  <Icon name="trash" size={17} />
                </button>
              </div>
            {/each}
            <button class="w-full py-3 text-sm font-medium text-danger" onclick={() => downloads.remove(g.chapters.map((c) => c.chapterId))}>
              Eliminar todas las descargas de esta serie
            </button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
</div>
