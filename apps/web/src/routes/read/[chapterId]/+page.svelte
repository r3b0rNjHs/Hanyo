<script lang="ts">
  import type { ChapterPages, ChapterSummary } from "@hanyo/types";
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { isPrefetched, prefetchChapter } from "$lib/offline/prefetch";
  import PagedView from "$lib/reader/PagedView.svelte";
  import StripView from "$lib/reader/StripView.svelte";
  import {
    backgroundColor,
    readerSettings,
    resolveMode,
    seriesMode,
    setSeriesMode,
    type ReadingMode,
  } from "$lib/reader/settings.svelte";
  import { chapterLabel } from "$lib/format";
  import { connection } from "$lib/connection.svelte";

  const chapterId = $derived(Number(page.params.chapterId));

  let data = $state<ChapterPages | null>(null);
  let error = $state<string | null>(null);
  let mode = $state<ReadingMode>("vertical");
  let current = $state(0);
  let uiVisible = $state(true);
  let completed = false;
  /** Position inside the current page (0–1); only the strip reader reports it. */
  let offset = $state(0);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let view = $state<{ jumpTo: (i: number) => void } | null>(null);
  const ratios = new Map<number, number>();
  let autoMode = false;
  let lastScrollY = 0;

  $effect(() => {
    void load(chapterId);
  });

  async function load(id: number) {
    // A save still pending belongs to the previous chapter.
    if (saveTimer) clearTimeout(saveTimer);
    data = null;
    error = null;
    completed = false;
    current = 0;
    ratios.clear();
    try {
      const d = await api.chapterPages(id);
      autoMode = seriesMode(d.seriesId) === null && readerSettings.defaultMode === "auto";
      mode = resolveMode(d.seriesId, d.genres);
      current = d.resumePage ?? 0;
      offset = d.resumeOffset ?? 0;
      data = d;
      uiVisible = true;
    } catch (e) {
      error = downloads.isDownloaded(id) ? "No se pudo abrir la descarga" : (e as Error).message;
    }
  }

  // Auto mode with no tags: decide from the shape of the first pages, once.
  function onRatio(i: number, r: number) {
    if (!data || !autoMode || i > 2) return;
    ratios.set(i, r);
    if (ratios.size < Math.min(3, data.pages.length)) return;
    autoMode = false;
    const next = resolveMode(data.seriesId, data.genres, [...ratios.values()]);
    if (next !== mode && current === 0) mode = next;
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    // Keep `completed` once the end was reached: a later scroll save must not move the resume
    // point back from the next chapter to this one.
    saveTimer = setTimeout(() => saveProgress(completed), 1200);
  }

  function onPage(i: number) {
    current = i;
    offset = 0;
    scheduleSave();
  }

  function onOffset(o: number) {
    if (Math.abs(o - offset) < 0.02) return;
    offset = o;
    scheduleSave();
  }

  function onEnd() {
    if (completed || !data) return;
    completed = true;
    current = data.pages.length - 1;
    void saveProgress(true);
  }

  async function saveProgress(done: boolean) {
    if (!data) return;
    await api.progress({ chapterId: data.chapterId, page: current, offset, completed: done }).catch(() => null);
  }

  /** Last-chance save when iOS suspends the app. */
  function flushOnHide() {
    if (!data || document.visibilityState !== "hidden") return;
    void fetch("/api/progress", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId: data.chapterId, page: current, offset, completed }),
    }).catch(() => null);
  }

  let settingsOpen = $state(false);

  // Chapter list: jump to any chapter without leaving the reader (newest first, like the series page).
  let listOpen = $state(false);
  let chapterList = $state<ChapterSummary[] | null>(null);
  async function openList() {
    if (!data) return;
    listOpen = true;
    chapterList = null;
    try {
      chapterList = [...(await api.series(data.seriesId)).chapters].reverse();
    } catch {
      chapterList = [];
    }
    await tick();
    document.querySelector('[data-current-chapter="true"]')?.scrollIntoView({ block: "center" });
  }

  function setMode(next: ReadingMode) {
    if (!data || next === mode) return;
    mode = next;
    setSeriesMode(data.seriesId, mode);
    autoMode = false;
  }

  async function goChapter(id: number | null) {
    if (!id) return;
    await goto(`/read/${id}`, { replaceState: true });
  }

  // Webtoon convention: scrolling down hides the bars, scrolling up shows them.
  function onWindowScroll() {
    if (mode !== "vertical") return;
    const y = window.scrollY;
    if (y > lastScrollY + 12) uiVisible = false;
    else if (y < lastScrollY - 40) uiVisible = true;
    lastScrollY = y;
  }

  // Screen Wake Lock (iOS 18.4+ in home-screen apps).
  let wakeLock: WakeLockSentinel | null = null;
  async function requestWakeLock() {
    if (!readerSettings.keepAwake || !("wakeLock" in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => (wakeLock = null));
    } catch {
      // Needs a user gesture on some versions; retried on next tap.
    }
  }

  onMount(() => {
    void requestWakeLock();
    const vis = () => {
      flushOnHide();
      if (document.visibilityState === "visible") void requestWakeLock();
    };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      if (saveTimer) clearTimeout(saveTimer);
      void wakeLock?.release();
      void saveProgress(completed);
    };
  });

  const modes: Array<[ReadingMode, string]> = [
    ["vertical", "Vertical"],
    ["rtl", "Páginas ←"],
    ["ltr", "Páginas →"],
  ];
  const nextIsDownloaded = $derived(data?.nextChapterId ? downloads.isDownloaded(data.nextChapterId) : false);

  // Halfway through a chapter, fetch the next one so it opens instantly (and offline).
  let nextReady = $state(false);
  $effect(() => {
    const d = data;
    if (!d?.nextChapterId) return;
    nextReady = nextIsDownloaded || isPrefetched(d.nextChapterId);
    if (nextReady || !readerSettings.prefetchNext || !connection.online) return;
    if (current < Math.floor(d.pages.length / 2)) return;
    const id = d.nextChapterId;
    void prefetchChapter(id).then((ok) => {
      if (data?.nextChapterId === id) nextReady = ok;
    });
  });
</script>

<svelte:window onscroll={onWindowScroll} onpointerdown={requestWakeLock} />
<svelte:head><title>{data ? `${chapterLabel(data.chapterNumber)} · ${data.seriesTitle}` : "Hanyo"}</title></svelte:head>

<div class="min-h-dvh" style="background: {backgroundColor[readerSettings.background]}">
  {#if error}
    <div class="pt-safe flex min-h-dvh flex-col items-center justify-center px-8 text-center" role="alert">
      <span class="flex h-16 w-16 items-center justify-center rounded-[var(--radius-card)] bg-raised text-fresh"><Icon name="cloudOff" size={30} stroke={2} /></span>
      <p class="font-display mt-5 text-xl font-bold">No se pueden cargar las imágenes</p>
      <p class="mt-2 text-sm text-muted">{error}</p>
      <div class="mt-6 flex w-full max-w-xs flex-col gap-2.5">
        <button class="h-12 rounded-full bg-accent font-bold text-on-accent" onclick={() => load(chapterId)}>Reintentar</button>
        <button class="h-12 rounded-full bg-raised font-semibold" onclick={() => history.back()}>Volver a la serie</button>
      </div>
    </div>
  {:else if !data}
    <div class="flex min-h-dvh items-center justify-center"><Spinner size={28} /></div>
  {:else}
    {#snippet transition()}
      <div class="mx-auto flex w-full max-w-sm flex-col gap-4 px-5 pt-8 pb-28">
        <p class="flex items-center gap-2.5 text-sm text-soft">
          <span class="flex h-7 w-7 items-center justify-center rounded-full bg-ok text-on-accent"><Icon name="check" size={16} stroke={3} /></span>
          {chapterLabel(data!.chapterNumber, data!.chapterTitle)} terminado
        </p>
        {#if data!.nextChapterId}
          <button
            class="flex flex-col gap-3.5 rounded-[var(--radius-panel)] border border-line bg-surface p-[18px] text-left"
            onclick={(e) => { e.stopPropagation(); void goChapter(data!.nextChapterId); }}
          >
            <span class="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Siguiente</span>
            <span class="flex items-center gap-3.5">
              <span class="relative h-[86px] w-16 shrink-0 overflow-hidden rounded-[14px] bg-accent">
                {#if data!.seriesCover}
                  <img src={data!.seriesCover} alt="" class="absolute inset-0 h-full w-full object-cover" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                {/if}
                <span class="font-display absolute bottom-1 left-1 rounded-lg bg-accent px-1.5 text-base font-bold text-on-accent">{data!.nextChapterNumber ?? "→"}</span>
              </span>
              <span class="flex flex-col gap-1">
                <span class="font-display text-2xl font-bold tracking-tight">{chapterLabel(data!.nextChapterNumber)}</span>
                <span class="text-[13px] text-muted">{nextIsDownloaded ? "Descargado · disponible sin conexión" : nextReady ? "Listo para leer" : connection.online ? "Se cargará online" : "No descargado"}</span>
              </span>
            </span>
            <span class="flex h-[52px] items-center justify-center gap-2 rounded-full bg-accent font-bold text-on-accent">
              Seguir leyendo <Icon name="arrowRight" size={18} stroke={2.4} />
            </span>
          </button>
          {#if !connection.online && !nextIsDownloaded && !nextReady}
            <p class="text-center text-xs text-muted">Sin conexión y el siguiente no está descargado.</p>
          {/if}
        {:else}
          <div class="rounded-[var(--radius-panel)] bg-surface p-5 text-center">
            <p class="font-display text-xl font-bold">Estás al día</p>
            <p class="mt-1 text-sm text-muted">Te avisaremos cuando salga el siguiente capítulo.</p>
          </div>
        {/if}
        <a href="/series/{data!.seriesId}" class="py-2 text-center text-sm text-muted" onclick={(e) => e.stopPropagation()}>Volver a la serie</a>
      </div>
    {/snippet}

    {#key `${data.chapterId}-${mode}`}
      {#if mode === "vertical"}
        <StripView
          bind:this={view}
          pages={data.pages}
          knownRatios={data.ratios}
          initialPage={current}
          initialOffset={offset}
          {onPage}
          {onOffset}
          {onEnd}
          {onRatio}
          onTap={(z) => {
            if (z === "menu") uiVisible = !uiVisible;
          }}
          footer={transition}
        />
      {:else}
        <PagedView
          bind:this={view}
          pages={data.pages}
          initialPage={current}
          direction={mode}
          {onPage}
          {onEnd}
          {onRatio}
          onToggleUi={() => (uiVisible = !uiVisible)}
          footer={transition}
        />
      {/if}
    {/key}

    <!-- Brightness dimmer -->
    {#if readerSettings.brightness < 1}
      <div class="pointer-events-none fixed inset-0 z-10 bg-black" style="opacity: {1 - readerSettings.brightness}"></div>
    {/if}

    <!-- Top pill -->
    <div class="pt-safe fixed inset-x-4 top-0 z-20 transition-all duration-200 {uiVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-4 opacity-0'}">
      <div class="mt-2 flex h-[52px] items-center gap-1 rounded-full border border-line bg-raised/95 px-1 shadow-[0_10px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <a href="/series/{data.seriesId}" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label="Volver a la serie">
          <Icon name="back" size={22} stroke={2.2} />
        </a>
        <p class="min-w-0 flex-1 truncate text-sm font-semibold">
          {data.seriesTitle} <span class="font-normal text-muted">· {chapterLabel(data.chapterNumber, data.chapterTitle).replace("Capítulo", "Cap.")}</span>
        </p>
        <span class="shrink-0 rounded-xl bg-line px-2.5 py-1 text-xs font-semibold text-soft tabular-nums">{current + 1}/{data.pages.length}</span>
        <button class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" onclick={openList} aria-label="Capítulos">
          <Icon name="list" size={20} stroke={2} />
        </button>
        <button class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" onclick={() => (settingsOpen = true)} aria-label="Ajustes de lectura">
          <Icon name="sliders" size={20} stroke={2} />
        </button>
      </div>
    </div>

    <!-- Bottom pill -->
    <div class="fixed inset-x-4 z-20 transition-all duration-200 {uiVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'}" style="bottom: calc(var(--safe-bottom) + 12px)">
      <div class="flex h-14 items-center gap-1 rounded-full border border-line bg-raised/95 px-1 shadow-[0_10px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <button class="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30" disabled={!data.prevChapterId} onclick={() => goChapter(data!.prevChapterId)} aria-label="Capítulo anterior">
          <Icon name="back" size={22} stroke={2.2} />
        </button>
        <input
          type="range"
          min="0"
          max={data.pages.length - 1}
          value={current}
          oninput={(e) => view?.jumpTo(Number((e.currentTarget as HTMLInputElement).value))}
          class="mx-1 min-w-0 flex-1 accent-[var(--color-accent)]"
          style={mode === "rtl" ? "direction: rtl" : ""}
          aria-label="Página"
        />
        <button class="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-30" disabled={!data.nextChapterId} onclick={() => goChapter(data!.nextChapterId)} aria-label="Capítulo siguiente">
          <Icon name="chevronRight" size={22} stroke={2.2} />
        </button>
      </div>
    </div>

    {#if readerSettings.showPageNumber && !uiVisible}
      <div class="pointer-events-none fixed right-3 z-20 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white/85 tabular-nums" style="bottom: calc(var(--safe-bottom) + 10px)">
        {current + 1}/{data.pages.length}
      </div>
    {/if}

    <!-- Chapter list -->
    {#if listOpen}
      <button class="fixed inset-0 z-40 bg-black/50" onclick={() => (listOpen = false)} aria-label="Cerrar capítulos"></button>
      <div class="pb-safe fixed inset-x-0 bottom-0 z-50 flex max-h-[75dvh] flex-col rounded-t-[28px] bg-raised" role="dialog" aria-label="Capítulos">
        <p class="font-display px-5 pt-5 pb-2 text-lg font-semibold">Capítulos</p>
        <ul class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {#if chapterList === null}
            <li class="flex justify-center py-8"><Spinner /></li>
          {:else}
            {#each chapterList as c (c.id)}
              {@const here = c.number === data.chapterNumber}
              <li>
                <button
                  data-current-chapter={here}
                  class="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left {here ? 'bg-accent/15' : 'active:bg-fg/5'}"
                  onclick={() => { listOpen = false; if (!here) void goChapter(c.id); }}
                >
                  <span class="min-w-0 flex-1 truncate text-[15px] {here ? 'font-semibold text-accent-soft' : c.read ? 'text-faint' : 'font-medium'}">{chapterLabel(c.number, c.title)}</span>
                  {#if downloads.isDownloaded(c.id)}<Icon name="check" size={16} stroke={2.6} class="text-ok" />{/if}
                  {#if here}<span class="text-xs text-muted">Leyendo</span>{/if}
                </button>
              </li>
            {:else}
              <li class="py-8 text-center text-sm text-muted">No se pudo cargar la lista.</li>
            {/each}
          {/if}
        </ul>
      </div>
    {/if}

    <!-- Quick settings sheet -->
    {#if settingsOpen}
      <button class="fixed inset-0 z-40 bg-black/50" onclick={() => (settingsOpen = false)} aria-label="Cerrar ajustes"></button>
      <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised px-5 pt-5" role="dialog" aria-label="Ajustes de lectura">
        <p class="font-display text-lg font-semibold">Lectura</p>
        <p class="mt-4 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Modo</p>
        <div class="mt-2 grid grid-cols-3 gap-1.5 rounded-2xl bg-base p-1">
          {#each modes as [m, label] (m)}
            <button
              class="h-10 rounded-xl text-[13px] font-semibold {mode === m ? 'bg-accent text-on-accent' : 'text-soft'}"
              aria-pressed={mode === m}
              onclick={() => setMode(m)}
            >{label}</button>
          {/each}
        </div>
        <p class="mt-1.5 text-xs text-muted">Se recuerda para esta serie.</p>
        <label class="mt-5 block">
          <span class="flex justify-between text-xs font-semibold tracking-[0.08em] text-muted uppercase"><span>Brillo</span><span class="tabular-nums">{Math.round(readerSettings.brightness * 100)}%</span></span>
          <span class="mt-2 flex items-center gap-3">
            <Icon name="sun" size={18} class="text-muted" />
            <input type="range" min="0.3" max="1" step="0.05" bind:value={readerSettings.brightness} class="flex-1 accent-[var(--color-accent)]" />
          </span>
        </label>
        <button class="mt-5 mb-4 h-12 w-full rounded-full bg-line font-semibold" onclick={() => (settingsOpen = false)}>Listo</button>
      </div>
    {/if}
  {/if}
</div>
