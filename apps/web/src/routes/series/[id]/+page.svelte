<script lang="ts">
  import type { ChapterSummary, RecommendationsResponse, SeriesDetail } from "@hanyo/types";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import SwipeRow from "$lib/components/SwipeRow.svelte";
  import { openByNames } from "$lib/resolve";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { AUTO_AHEAD, nextUnread } from "$lib/offline/auto-download";
  import { chapterLabel, formatBytes, relativeDate, SHELVES, shelfLabel, statusLabel } from "$lib/format";
  import type { Shelf } from "@hanyo/types";

  const id = $derived(Number(page.params.id));
  let s = $state<SeriesDetail | null>(null);
  let error = $state<string | null>(null);
  let offline = $state(false);
  let busy = $state(false);
  let expanded = $state(false);
  let newestFirst = $state(true);
  let menuFor = $state<ChapterSummary | null>(null);
  let downloadMenu = $state(false);
  let shelfMenu = $state(false);
  let sourcesOpen = $state(false);
  let sourcesBusy = $state<string | null>(null);
  let sourcesMsg = $state<string | null>(null);
  /** Linked sources, preferred first (lower priority value wins for duplicated chapter numbers). */
  const linked = $derived(
    s ? [...s.sources].sort((a, b) => Number(b.lang === s!.lang) - Number(a.lang === s!.lang) || a.priority - b.priority || a.id - b.id) : [],
  );

  const langNames: Record<string, string> = { en: "Inglés", es: "Español" };
  let langBusy = $state(false);

  async function switchLang(lang: string) {
    if (!s || s.lang === lang) return;
    langBusy = true;
    try {
      s = await api.setLang(s.id, lang);
    } finally {
      langBusy = false;
    }
  }

  async function makePreferred(linkId: number) {
    if (!s) return;
    sourcesBusy = `pref-${linkId}`;
    try {
      const min = Math.min(...s.sources.map((x) => x.priority));
      s = await api.setSourcePriority(s.id, linkId, min - 10);
    } catch (e) {
      sourcesMsg = (e as Error).message;
    } finally {
      sourcesBusy = null;
    }
  }

  async function removeSource(linkId: number) {
    if (!s) return;
    sourcesBusy = `del-${linkId}`;
    try {
      s = await api.unlinkSource(s.id, linkId);
    } catch (e) {
      sourcesMsg = (e as Error).message;
    } finally {
      sourcesBusy = null;
    }
  }

  async function findMoreSources() {
    if (!s) return;
    sourcesBusy = "find";
    sourcesMsg = null;
    try {
      const r = await api.autoLink(s.id);
      s = r.detail;
      sourcesMsg = r.added.length ? `Añadida: ${r.added.join(", ")}` : "No está con el mismo título en otras fuentes.";
    } catch (e) {
      sourcesMsg = (e as Error).message;
    } finally {
      sourcesBusy = null;
    }
  }

  $effect(() => {
    void load(id);
  });

  /** "Si te gusta esto…": AniList recommendations, loaded after the page (online only). */
  let recs = $state<RecommendationsResponse["items"]>([]);
  let openingRec = $state<number | null>(null);
  async function openRec(key: number, title: string, titles: string[]) {
    openingRec = key;
    try {
      await openByNames(title, titles);
    } finally {
      openingRec = null;
    }
  }
  async function loadRecs(seriesId: number) {
    recs = [];
    try {
      const r = await api.recommendations(seriesId);
      if (s?.id === seriesId) recs = r.items.slice(0, 12);
    } catch {
      // Optional: no AniList, no section.
    }
  }

  async function load(seriesId: number) {
    try {
      const res = await fetch(`/api/series/${seriesId}`);
      if (res.status === 401) return goto("/login");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
      offline = res.headers.get("x-hanyo-offline") === "1";
      s = (await res.json()) as SeriesDetail;
      if (!offline) void loadRecs(seriesId);
      if (page.url.searchParams.get("resume") && s.resume) {
        await goto(`/read/${s.resume.chapterId}`, { replaceState: true });
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  type ListFilter = "all" | "unread" | "downloaded";
  let listFilter = $state<ListFilter>("all");
  /** Long series have hundreds of chapters: render in steps instead of one huge list. */
  const STEP = 60;
  let shown = $state(STEP);
  const filtered = $derived(
    s
      ? s.chapters.filter((c) =>
          listFilter === "unread" ? !c.read : listFilter === "downloaded" ? downloads.records.has(c.id) : true,
        )
      : [],
  );
  const ordered = $derived(newestFirst ? [...filtered].reverse() : filtered);
  const firstUnread = $derived(s?.chapters.find((c) => !c.read && c.number !== null) ?? null);
  const readTarget = $derived(
    s?.resume ? { id: s.resume.chapterId, label: `Leer ${chapterLabel(s.resume.chapterNumber).toLowerCase()}` }
    : firstUnread ? { id: firstUnread.id, label: s && s.chapters.some((c) => c.read) ? `Leer ${chapterLabel(firstUnread.number).toLowerCase()}` : "Empezar a leer" }
    : null,
  );
  const unread = $derived(s?.chapters.filter((c) => !c.read) ?? []);
  const lastRead = $derived(
    s ? s.chapters.reduce<number | null>((m, c) => (c.read && c.number !== null && (m === null || c.number > m) ? c.number : m), null) : null,
  );
  /** Chapters released after where you left off (only once you've started), newest first. */
  const fresh = $derived(
    s && lastRead !== null
      ? s.chapters.filter((c) => !c.read && c.number !== null && c.number > lastRead).reverse()
      : [],
  );
  const freshIds = $derived(new Set(fresh.map((c) => c.id)));
  const statusDot: Record<string, string> = {
    ongoing: "bg-ok",
    completed: "bg-accent-soft",
    hiatus: "bg-fresh",
    cancelled: "bg-faint",
    unknown: "bg-faint",
  };

  /** Not in the library: add it ("Leyendo" once started, else "Pendiente"). In it: pick a list. */
  async function libraryButton() {
    if (!s) return;
    if (s.inLibrary) {
      shelfMenu = true;
      return;
    }
    await setShelf(s.lastReadChapter !== null ? "reading" : "plan");
  }

  async function setShelf(shelf: Shelf) {
    if (!s) return;
    shelfMenu = false;
    busy = true;
    try {
      s = await api.setShelf(s.id, shelf);
    } finally {
      busy = false;
    }
  }

  async function removeFromLibrary() {
    if (!s) return;
    shelfMenu = false;
    busy = true;
    try {
      s = await api.setInLibrary(s.id, false);
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    if (!s) return;
    busy = true;
    try {
      const r = await api.refreshSeries(s.id);
      s = r.detail;
    } finally {
      busy = false;
    }
  }

  async function setRead(c: ChapterSummary, read: boolean, includePrevious = false) {
    if (!s) return;
    const nums = includePrevious
      ? s.chapters.filter((x) => x.number !== null && x.number <= (c.number ?? -1)).map((x) => x.number!)
      : c.number !== null ? [c.number] : [];
    if (nums.length) s = await api.markRead(s.id, nums, read);
    menuFor = null;
  }

  /** This series' downloads: what's stored and what's still in the queue. */
  const dl = $derived.by(() => {
    if (!s) return { done: 0, bytes: 0, pending: 0, ids: [] as number[] };
    const ids = s.chapters.map((c) => c.id).filter((id) => downloads.records.has(id));
    const bytes = ids.reduce((n, id) => n + (downloads.records.get(id)?.bytes ?? 0), 0);
    const mine = new Set(s.chapters.map((c) => c.id));
    const pending = downloads.queue.filter((j) => mine.has(j.chapterId)).length + (downloads.active && mine.has(downloads.active.chapterId) ? 1 : 0);
    return { done: ids.length, bytes, pending, ids };
  });

  let notifyToast = $state<string | null>(null);
  async function toggleNotify() {
    if (!s) return;
    s = await api.setNotify(s.id, !s.notify);
    notifyToast = s.notify ? "Te avisaremos de los capítulos nuevos" : "Sin avisos para esta serie";
    setTimeout(() => (notifyToast = null), 2200);
  }

  async function toggleAuto() {
    if (!s) return;
    const enabled = !s.autoDownload;
    s = await api.setAutoDownload(s.id, enabled);
    if (enabled) downloads.enqueue(s, nextUnread(s));
  }

  function cancelPending() {
    if (!s) return;
    for (const c of s.chapters) downloads.cancel(c.id);
    downloadMenu = false;
  }

  async function removeDownloads() {
    downloadMenu = false;
    await downloads.remove(dl.ids);
  }

  /** Row button: download a chapter in one tap; once stored, the same button offers to delete it. */
  function rowDownload(c: ChapterSummary) {
    const st = downloads.status(c.id);
    if (st === "none") download([c]);
    else if (st === "queued") downloads.cancel(c.id);
    else if (st === "downloaded") menuFor = c;
  }

  function download(list: ChapterSummary[]) {
    if (s) downloads.enqueue(s, list);
    downloadMenu = false;
    menuFor = null;
  }
</script>

{#if !s}
  <div class="pt-safe flex justify-center py-32">
    {#if error}<p class="px-6 text-center text-muted">{error}</p>{:else}<Spinner />{/if}
  </div>
{:else}
  {#if notifyToast}
    <div class="pt-safe fixed inset-x-0 top-16 z-30 flex justify-center px-4" role="status">
      <div class="rounded-full bg-raised px-4 py-2 text-sm font-medium shadow-lg">{notifyToast}</div>
    </div>
  {/if}

  <!-- Hero: the cover, full bleed -->
  <div class="relative h-[230px] overflow-hidden bg-accent">
    {#if s.coverUrl}
      <img src={s.coverUrl} alt="" class="absolute inset-0 h-full w-full object-cover object-top" />
    {:else}
      <span aria-hidden="true" class="font-display absolute right-[-6px] bottom-12 text-right text-[88px] leading-[0.85] font-bold tracking-[-0.05em] break-all text-white/25 uppercase">{s.title}</span>
    {/if}
    <div class="pt-safe absolute inset-x-0 top-0 flex justify-between px-3 pt-2">
      <button class="flex h-11 w-11 items-center justify-center rounded-full bg-base/60 text-fg backdrop-blur-md" onclick={() => history.back()} aria-label="Atrás">
        <Icon name="back" size={22} stroke={2.2} />
      </button>
      <div class="flex gap-2">
        {#if s.inLibrary}
          <button
            class="flex h-11 w-11 items-center justify-center rounded-full bg-base/60 backdrop-blur-md {s.notify ? 'text-fg' : 'text-muted'}"
            onclick={toggleNotify}
            disabled={offline}
            aria-pressed={s.notify}
            aria-label={s.notify ? "Avisos de capítulos nuevos activados" : "Avisos de capítulos nuevos desactivados"}
          >
            <Icon name={s.notify ? "bell" : "bellOff"} size={19} stroke={2.2} />
          </button>
        {/if}
        <button class="flex h-11 w-11 items-center justify-center rounded-full bg-base/60 text-fg backdrop-blur-md" onclick={refresh} aria-label="Actualizar capítulos" disabled={busy || offline}>
          {#if busy}<Spinner size={18} />{:else}<Icon name="refresh" size={19} stroke={2.2} />{/if}
        </button>
      </div>
    </div>
  </div>

  <!-- Sheet overlapping the cover -->
  <div class="relative -mt-9 rounded-t-[28px] bg-base px-5 pt-5">
    <h1 class="font-display text-[30px] leading-[1.05] font-bold tracking-[-0.03em]">{s.title}</h1>
    <p class="mt-1.5 line-clamp-2 text-sm text-muted">
      {[...s.authors.slice(0, 2), ...s.genres.slice(0, 2)].join(" · ")}
    </p>

    {#if offline}
      <p class="mt-3 flex items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-xs text-muted">
        <Icon name="cloudOff" size={14} /> Datos guardados · puede no estar al día
      </p>
    {/if}

    <!-- Status, size and (when there's a choice) the reading language, in one line. -->
    <div class="mt-3 flex items-center gap-3">
      <p class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-soft">
        <span class="h-2 w-2 shrink-0 rounded-full {statusDot[s.status]}"></span>
        <span class="truncate">{statusLabel[s.status]} · {s.chapters.length} capítulos</span>
      </p>
      {#if s.availableLangs.length > 1}
        <div class="flex shrink-0 gap-0.5 rounded-full bg-surface p-0.5" role="radiogroup" aria-label="Idioma de lectura">
          {#each s.availableLangs as l (l)}
            <button
              role="radio"
              aria-checked={s.lang === l}
              aria-label={langNames[l] ?? l}
              disabled={langBusy || offline}
              onclick={() => switchLang(l)}
              class="h-7 rounded-full px-2.5 text-[11px] font-bold tracking-wide uppercase {s.lang === l ? 'bg-accent text-on-accent' : 'text-muted'}"
            >{l}</button>
          {/each}
        </div>
      {/if}
    </div>

    {#if readTarget}
      <a href="/read/{readTarget.id}" class="mt-4 flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-on-accent">
        <Icon name="play" size={16} filled /> {readTarget.label}
      </a>
    {/if}

    <!-- Secondary actions: same weight, labelled. -->
    <div class="mt-2.5 grid grid-cols-3 gap-2">
      <button
        onclick={libraryButton}
        disabled={busy || offline}
        aria-label={s.inLibrary ? `Lista: ${shelfLabel(s.shelf)}` : "Añadir a la biblioteca"}
        aria-haspopup={s.inLibrary ? "dialog" : undefined}
        class="flex h-[60px] flex-col items-center justify-center gap-1 rounded-2xl text-xs font-semibold {s.inLibrary ? 'bg-accent/15 text-accent-soft' : 'bg-surface text-fg'}"
      >
        <Icon name="bookmark" size={19} filled={s.inLibrary} stroke={2} />
        {s.inLibrary ? shelfLabel(s.shelf) : "Añadir"}
      </button>
      <button onclick={() => (downloadMenu = true)} aria-label="Descargar capítulos" class="flex h-[60px] flex-col items-center justify-center gap-1 rounded-2xl bg-surface text-xs font-semibold">
        <Icon name="download" size={19} stroke={2} />
        Descargar
      </button>
      <button onclick={() => (sourcesOpen = true)} aria-label="Gestionar fuentes" class="flex h-[60px] flex-col items-center justify-center gap-1 rounded-2xl bg-surface text-xs font-semibold">
        <Icon name="layers" size={19} stroke={2} />
        {s.sources.length} {s.sources.length === 1 ? "fuente" : "fuentes"}
      </button>
    </div>

    {#if dl.done > 0 || dl.pending > 0}
      <button
        onclick={() => (downloadMenu = true)}
        class="mt-3 flex w-full items-center gap-3 rounded-[18px] bg-surface px-4 py-3 text-left"
        aria-label="Gestionar descargas"
      >
        {#if dl.pending > 0}<Spinner size={18} />{:else}<Icon name="check" size={18} stroke={2.6} class="text-ok" />{/if}
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold">
            {#if dl.pending > 0}
              Descargando · faltan {dl.pending}
            {:else}
              {dl.done === s.chapters.length ? "Serie descargada" : `${dl.done} de ${s.chapters.length} descargados`}
            {/if}
          </span>
          <span class="block text-xs text-muted">
            {#if downloads.active && dl.pending > 0 && s.chapters.some((c) => c.id === downloads.active?.chapterId)}
              {chapterLabel(downloads.active.chapter.number)} · pág. {downloads.active.done}/{downloads.active.total || "…"}
            {:else}
              {formatBytes(dl.bytes)} · disponible sin conexión
            {/if}
          </span>
        </span>
        <Icon name="chevronRight" size={18} class="text-muted" />
      </button>
    {/if}

    {#if s.description}
      <button class="mt-4 block w-full text-left" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
        <p class="text-sm leading-relaxed break-words whitespace-pre-line text-soft {expanded ? '' : 'line-clamp-3'}">{s.description}</p>
      </button>
    {/if}

    {#if recs.length > 0}
      <section aria-label="Si te gusta esto" class="mt-6">
        <h2 class="font-display text-lg font-semibold">Si te gusta esto…</h2>
        <ul class="no-scrollbar -mx-5 mt-2 flex gap-3 overflow-x-auto px-5 pb-1">
          {#each recs as r (r.cluster.id)}
            <li class="w-[104px] shrink-0">
              <button class="relative block w-full text-left" disabled={openingRec !== null} onclick={() => openRec(r.cluster.id, r.cluster.title, r.cluster.titles)}>
                <Cover src={r.coverUrl} alt={r.cluster.title} rounded="rounded-[14px]" />
                {#if openingRec === r.cluster.id}
                  <span class="absolute inset-x-0 top-0 flex aspect-[3/4] items-center justify-center rounded-[14px] bg-base/60"><Spinner /></span>
                {/if}
                <p class="mt-1.5 line-clamp-2 text-[12px] leading-snug font-semibold">{r.cluster.title}</p>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-label="Todos los capítulos" class="mt-6">
      <div class="flex items-baseline justify-between">
        <h2 class="font-display text-lg font-semibold">Capítulos</h2>
        <button class="flex items-center gap-1 text-[13px] text-muted" onclick={() => (newestFirst = !newestFirst)} aria-label="Cambiar orden">
          {newestFirst ? "Recientes primero" : "Primeros primero"}
          <Icon name="sliders" size={14} />
        </button>
      </div>
      <div class="no-scrollbar mt-2 flex gap-2 overflow-x-auto" role="radiogroup" aria-label="Mostrar">
        {#each [["all", "Todos", s.chapters.length], ["unread", "Sin leer", unread.length], ["downloaded", "Descargados", dl.done]] as const as [k, label, n] (k)}
          <button
            role="radio"
            aria-checked={listFilter === k}
            onclick={() => { listFilter = k; shown = STEP; }}
            class="h-8 shrink-0 rounded-full px-3.5 text-[13px] font-semibold {listFilter === k ? 'bg-fg text-base' : 'bg-surface text-soft'}"
          >{label} <span class={listFilter === k ? "" : "text-muted"}>{n}</span></button>
        {/each}
      </div>
      <ul class="mt-1">
        {#each ordered.slice(0, shown) as c (c.id)}
          {@const st = downloads.status(c.id)}
          {@const current = s.resume?.chapterId === c.id}
          <li>
            <SwipeRow>
              {#snippet actions(close)}
                <button
                  class="flex-1 bg-accent text-xs font-semibold text-on-accent"
                  onclick={() => { close(); void setRead(c, !c.read); }}
                >{c.read ? "No leído" : "Leído"}</button>
                <button class="flex-1 bg-raised text-xs font-semibold" onclick={() => { close(); menuFor = c; }}>Más</button>
              {/snippet}
              <div class="flex items-center">
                <a href="/read/{c.id}" class="min-w-0 flex-1 py-3">
                  <p class="flex items-center gap-2 truncate text-[15px] {c.read ? 'text-faint' : current ? 'font-semibold text-accent-soft' : 'font-medium'}">
                    {#if freshIds.has(c.id)}<span class="shrink-0 rounded-md bg-fresh px-1.5 text-[10px] leading-[18px] font-bold text-on-fresh">NUEVO</span>{/if}
                    <span class="truncate">
                      {chapterLabel(c.number, c.title)}
                      {#if c.title && c.number !== null && !/^ch(apter)?\.?\s*\d/i.test(c.title)}<span class="font-normal text-muted"> · {c.title}</span>{/if}
                    </span>
                  </p>
                  <p class="truncate text-xs text-muted">
                    {#if current && s.resume}Leyendo · pág. {s.resume.page + 1}{:else}{relativeDate(c.publishedAt)}{c.publishedAt ? " · " : ""}{c.sourceName}{c.scanlator ? ` · ${c.scanlator}` : ""}{/if}
                  </p>
                </a>
                <button
                  class="flex h-12 w-11 items-center justify-center {st === 'downloaded' ? 'text-ok' : 'text-muted'}"
                  onclick={() => rowDownload(c)}
                  aria-label={st === "none" ? `Descargar ${chapterLabel(c.number)}` : st === "queued" ? "Cancelar descarga" : st === "active" ? "Descargando" : "Descargado"}
                >
                  {#if st === "downloaded"}<Icon name="check" size={17} stroke={2.6} />
                  {:else if st === "active"}<Spinner size={17} />
                  {:else if st === "queued"}<span class="h-2 w-2 rounded-full bg-muted"></span>
                  {:else}<Icon name="download" size={18} stroke={2} />{/if}
                </button>
              </div>
            </SwipeRow>
          </li>
        {/each}
      </ul>
      {#if ordered.length > shown}
        <button class="mt-2 h-11 w-full rounded-full bg-surface text-sm font-semibold text-soft" onclick={() => (shown += STEP * 3)}>
          Mostrar más ({ordered.length - shown})
        </button>
      {:else if ordered.length === 0}
        <p class="py-8 text-center text-sm text-muted">{listFilter === "downloaded" ? "No hay capítulos descargados." : "Ya lo has leído todo."}</p>
      {/if}
    </section>
  </div>
{/if}

<!-- Action sheets -->
{#if menuFor && s}
  {@const c = menuFor}
  {@const st = downloads.status(c.id)}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (menuFor = null)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-3" role="dialog" aria-label={chapterLabel(c.number, c.title)}>
    <p class="font-display px-3 pt-2 pb-3 text-lg font-semibold">{chapterLabel(c.number, c.title)}</p>
    {#if st === "downloaded"}
      <button class="sheet-btn" onclick={() => { void downloads.remove([c.id]); menuFor = null; }}>Eliminar descarga</button>
    {:else if st === "none"}
      <button class="sheet-btn" onclick={() => download([c])}>Descargar</button>
    {/if}
    {#if c.read}
      <button class="sheet-btn" onclick={() => setRead(c, false)}>Marcar como no leído</button>
    {:else}
      <button class="sheet-btn" onclick={() => setRead(c, true)}>Marcar como leído</button>
    {/if}
    <button class="sheet-btn" onclick={() => setRead(c, true, true)}>Marcar este y anteriores como leídos</button>
    <button class="sheet-btn mt-1 text-muted" onclick={() => (menuFor = null)}>Cancelar</button>
  </div>
{/if}

{#if shelfMenu && s}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (shelfMenu = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-3" role="dialog" aria-label="Lista de lectura">
    <p class="font-display px-3 pt-2 pb-3 text-lg font-semibold">Lista de lectura</p>
    {#each SHELVES as [key, label] (key)}
      <button class="sheet-btn {s.shelf === key ? 'text-accent-soft' : ''}" aria-pressed={s.shelf === key} onclick={() => setShelf(key)}>
        <span class="flex items-center justify-between">
          {label}
          {#if s.shelf === key}<Icon name="check" size={18} stroke={2.6} />{/if}
        </span>
      </button>
    {/each}
    <button class="sheet-btn mt-1 text-danger" onclick={removeFromLibrary}>Quitar de la biblioteca</button>
    <button class="sheet-btn text-muted" onclick={() => (shelfMenu = false)}>Cancelar</button>
  </div>
{/if}

{#if downloadMenu && s}
  {@const next5 = firstUnread ? s.chapters.filter((c) => c.number !== null && c.number >= firstUnread.number!).slice(0, 5) : []}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (downloadMenu = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-3" role="dialog" aria-label="Descargar">
    <p class="font-display px-3 pt-2 text-lg font-semibold">Descargar</p>
    <p class="px-3 pb-3 text-sm text-muted">Para leer sin conexión</p>
    {#if fresh.length}<button class="sheet-btn" onclick={() => download(fresh)}>Los nuevos ({fresh.length})</button>{/if}
    {#if next5.length}<button class="sheet-btn" onclick={() => download(next5)}>Los próximos {next5.length}</button>{/if}
    <button class="sheet-btn" disabled={!unread.length} onclick={() => download(unread)}>Todos los no leídos ({unread.length})</button>
    <button class="sheet-btn" disabled={dl.done === s.chapters.length} onclick={() => download(s!.chapters)}>Toda la serie ({s.chapters.length})</button>
    <label class="sheet-btn">
      <span class="flex items-center justify-between gap-3">
        <span>
          <span class="block">Descargar nuevos automáticamente</span>
          <span class="block text-xs text-muted">Al abrir la app, los {AUTO_AHEAD} siguientes sin leer</span>
        </span>
        <input type="checkbox" class="switch shrink-0" checked={s.autoDownload} disabled={offline} onchange={toggleAuto} />
      </span>
    </label>
    {#if dl.pending > 0}<button class="sheet-btn" onclick={cancelPending}>Cancelar pendientes ({dl.pending})</button>{/if}
    {#if dl.done > 0}<button class="sheet-btn text-danger" onclick={removeDownloads}>Eliminar descargas · {formatBytes(dl.bytes)}</button>{/if}
    <button class="sheet-btn mt-1 text-muted" onclick={() => (downloadMenu = false)}>Cancelar</button>
  </div>
{/if}

{#if sourcesOpen && s}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (sourcesOpen = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-[28px] bg-raised p-4" role="dialog" aria-label="Fuentes de la serie">
    <p class="font-display px-1 text-lg font-semibold">Fuentes</p>
    <p class="px-1 pb-3 text-sm text-muted">Si un capítulo está en varias, se lee de la preferida. Si falla, se prueba la siguiente.</p>
    <ul class="space-y-2">
      {#each linked as src, i (src.id)}
        <li class="rounded-[var(--radius-card)] bg-surface p-3.5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex items-center gap-2 font-semibold {src.lang === s.lang ? '' : 'text-muted'}">
                {src.sourceName}
                <span class="rounded-full bg-raised px-1.5 py-0.5 text-[10px] font-bold text-muted uppercase">{src.lang}</span>
                {#if i === 0 && src.lang === s.lang}<span class="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">Preferida</span>{/if}
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {src.chapterCount} capítulos{src.latestChapter !== null ? ` · hasta el ${src.latestChapter}` : ""}
              </p>
            </div>
            {#if src.url}
              <a href={src.url} target="_blank" rel="noopener noreferrer" class="shrink-0 text-xs text-accent-soft">Ver web</a>
            {/if}
          </div>
          <div class="mt-3 flex gap-2">
            {#if i !== 0 && src.lang === s.lang}
              <button class="h-9 rounded-full bg-raised px-3.5 text-[13px] font-semibold disabled:opacity-40" disabled={sourcesBusy !== null || offline} onclick={() => makePreferred(src.id)}>
                {sourcesBusy === `pref-${src.id}` ? "…" : "Hacer preferida"}
              </button>
            {/if}
            {#if linked.length > 1}
              <button class="h-9 rounded-full px-3.5 text-[13px] font-semibold text-danger disabled:opacity-40" disabled={sourcesBusy !== null || offline} onclick={() => removeSource(src.id)}>
                {sourcesBusy === `del-${src.id}` ? "…" : "Quitar"}
              </button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if sourcesMsg}<p class="mt-3 px-1 text-sm text-soft" role="status">{sourcesMsg}</p>{/if}
    <button class="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent font-bold text-on-accent disabled:opacity-50" disabled={sourcesBusy !== null || offline} onclick={findMoreSources}>
      {#if sourcesBusy === "find"}<Spinner size={18} /> Buscando…{:else}<Icon name="search" size={18} stroke={2.4} /> Buscar en otras fuentes{/if}
    </button>
    <button class="mt-1 h-12 w-full rounded-full font-semibold text-muted active:bg-fg/5" onclick={() => (sourcesOpen = false)}>Cerrar</button>
  </div>
{/if}
