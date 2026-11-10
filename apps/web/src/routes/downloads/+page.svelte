<script lang="ts">
  import { onMount } from "svelte";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { chapterLabel, formatBytes } from "$lib/format";

  let quota = $state<{ usage: number; quota: number } | null>(null);
  let open = $state<number | null>(null);
  const groups = $derived(downloads.bySeries());

  onMount(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.quota) quota = { usage: est.usage ?? 0, quota: est.quota };
    } catch {
      // ignore
    }
  });
</script>

<PageHeader title="Descargas" subtitle="{formatBytes(downloads.totalBytes)} en este dispositivo" />

{#if quota}
  <div class="mx-4 mb-4">
    <div class="h-1.5 overflow-hidden rounded-full bg-raised">
      <div class="h-full rounded-full bg-accent" style="width: {Math.min(100, (quota.usage / quota.quota) * 100).toFixed(1)}%"></div>
    </div>
    <p class="mt-1.5 text-xs text-faint">{formatBytes(quota.usage)} usados de {formatBytes(quota.quota)} disponibles para Hanyo</p>
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
          <div class="border-t border-white/5">
            {#each g.chapters as c (c.chapterId)}
              <div class="flex items-center gap-2 border-b border-white/5 pl-4 last:border-0">
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
