<script lang="ts">
  import type { ChapterPages } from "@hanyo/types";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
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

  const chapterId = $derived(Number(page.params.chapterId));

  let data = $state<ChapterPages | null>(null);
  let error = $state<string | null>(null);
  let mode = $state<ReadingMode>("vertical");
  let current = $state(0);
  let uiVisible = $state(true);
  let completed = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let view = $state<{ jumpTo: (i: number) => void } | null>(null);
  const ratios = new Map<number, number>();
  let autoMode = false;
  let lastScrollY = 0;

  $effect(() => {
    void load(chapterId);
  });

  async function load(id: number) {
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

  function onPage(i: number) {
    current = i;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveProgress(false), 1200);
  }

  function onEnd() {
    if (completed || !data) return;
    completed = true;
    current = data.pages.length - 1;
    void saveProgress(true);
  }

  async function saveProgress(done: boolean) {
    if (!data) return;
    await api.progress({ chapterId: data.chapterId, page: current, completed: done }).catch(() => null);
  }

  /** Last-chance save when iOS suspends the app. */
  function flushOnHide() {
    if (!data || document.visibilityState !== "hidden") return;
    void fetch("/api/progress", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId: data.chapterId, page: current, completed }),
    }).catch(() => null);
  }

  function cycleMode() {
    if (!data) return;
    const order: ReadingMode[] = ["vertical", "rtl", "ltr"];
    mode = order[(order.indexOf(mode) + 1) % order.length]!;
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

  const modeLabel: Record<ReadingMode, string> = { vertical: "Vertical", rtl: "Páginas ←", ltr: "Páginas →" };
  const nextIsDownloaded = $derived(data?.nextChapterId ? downloads.isDownloaded(data.nextChapterId) : false);
</script>

<svelte:window onscroll={onWindowScroll} onpointerdown={requestWakeLock} />
<svelte:head><title>{data ? `${chapterLabel(data.chapterNumber)} · ${data.seriesTitle}` : "Hanyo"}</title></svelte:head>

<div class="min-h-dvh" style="background: {backgroundColor[readerSettings.background]}">
  {#if error}
    <div class="pt-safe flex min-h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
      <p class="text-ink-200">{error}</p>
      <button class="rounded-full bg-ink-800 px-4 py-2 text-sm" onclick={() => history.back()}>Volver</button>
    </div>
  {:else if !data}
    <div class="flex min-h-dvh items-center justify-center"><Spinner size={28} /></div>
  {:else}
    {#snippet transition()}
      <div class="mx-auto w-full max-w-sm px-6 py-16 text-center">
        <p class="text-sm text-ink-400">Has terminado</p>
        <p class="mt-1 text-lg font-semibold text-ink-100">{chapterLabel(data!.chapterNumber, data!.chapterTitle)}</p>
        {#if data!.nextChapterId}
          <button
            class="mt-6 w-full rounded-xl bg-gradient-to-r from-hanji-300 to-hanji-500 py-3.5 font-semibold text-ink-950"
            onclick={(e) => { e.stopPropagation(); void goChapter(data!.nextChapterId); }}
          >
            Siguiente capítulo
          </button>
          {#if !navigator.onLine && !nextIsDownloaded}
            <p class="mt-2 text-xs text-ink-400">El siguiente no está descargado y no hay conexión.</p>
          {/if}
        {:else}
          <p class="mt-6 text-sm text-ink-400">Estás al día. Te avisaremos cuando salga el siguiente.</p>
        {/if}
        <a href="/series/{data!.seriesId}" class="mt-3 block py-2 text-sm text-ink-400" onclick={(e) => e.stopPropagation()}>Volver a la serie</a>
      </div>
    {/snippet}

    {#key `${data.chapterId}-${mode}`}
      {#if mode === "vertical"}
        <StripView
          bind:this={view}
          pages={data.pages}
          initialPage={current}
          {onPage}
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

    <!-- Top bar -->
    <div
      class="pt-safe fixed inset-x-0 top-0 z-20 bg-ink-950/90 backdrop-blur-xl transition-transform duration-200 {uiVisible ? '' : '-translate-y-full'}"
    >
      <div class="flex items-center gap-1 px-1 py-1.5">
        <a href="/series/{data.seriesId}" class="flex h-11 w-11 items-center justify-center" aria-label="Volver a la serie">
          <Icon name="back" size={24} />
        </a>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[15px] font-semibold">{data.seriesTitle}</p>
          <p class="truncate text-xs text-ink-400">{chapterLabel(data.chapterNumber, data.chapterTitle)} · {data.sourceName}</p>
        </div>
        <button class="flex h-11 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-ink-200 active:bg-white/10" onclick={cycleMode}>
          <Icon name={mode === "vertical" ? "vertical" : "paged"} size={18} />
          {modeLabel[mode]}
        </button>
      </div>
    </div>

    <!-- Bottom bar -->
    <div
      class="pb-safe fixed inset-x-0 bottom-0 z-20 bg-ink-950/90 backdrop-blur-xl transition-transform duration-200 {uiVisible ? '' : 'translate-y-full'}"
    >
      <div class="flex items-center gap-2 px-2 py-2">
        <button
          class="flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-30"
          disabled={!data.prevChapterId}
          onclick={() => goChapter(data!.prevChapterId)}
          aria-label="Capítulo anterior"
        >
          <Icon name="back" size={22} />
        </button>
        <span class="w-9 text-right text-xs text-ink-400 tabular-nums">{current + 1}</span>
        <input
          type="range"
          min="0"
          max={data.pages.length - 1}
          value={current}
          oninput={(e) => view?.jumpTo(Number((e.currentTarget as HTMLInputElement).value))}
          class="flex-1 accent-hanji-400"
          style={mode === "rtl" ? "direction: rtl" : ""}
          aria-label="Página"
        />
        <span class="w-9 text-xs text-ink-400 tabular-nums">{data.pages.length}</span>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-30"
          disabled={!data.nextChapterId}
          onclick={() => goChapter(data!.nextChapterId)}
          aria-label="Capítulo siguiente"
        >
          <Icon name="back" size={22} class="rotate-180" />
        </button>
      </div>
    </div>

    {#if readerSettings.showPageNumber && !uiVisible}
      <div class="pb-safe pointer-events-none fixed right-3 bottom-2 z-20 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/80 tabular-nums">
        {current + 1}/{data.pages.length}
      </div>
    {/if}
  {/if}
</div>
