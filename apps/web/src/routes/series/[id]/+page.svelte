<script lang="ts">
  import type { ChapterSummary, SeriesDetail } from "@hanyo/types";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import { downloads } from "$lib/offline/downloads.svelte";
  import { chapterLabel, relativeDate, statusLabel } from "$lib/format";

  const id = $derived(Number(page.params.id));
  let s = $state<SeriesDetail | null>(null);
  let error = $state<string | null>(null);
  let offline = $state(false);
  let busy = $state(false);
  let expanded = $state(false);
  let newestFirst = $state(true);
  let menuFor = $state<ChapterSummary | null>(null);
  let downloadMenu = $state(false);
  let sourcesOpen = $state(false);
  let sourcesBusy = $state<string | null>(null);
  let sourcesMsg = $state<string | null>(null);
  /** Linked sources, preferred first (lower priority value wins for duplicated chapter numbers). */
  const linked = $derived(s ? [...s.sources].sort((a, b) => a.priority - b.priority || a.id - b.id) : []);

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

  async function load(seriesId: number) {
    try {
      const res = await fetch(`/api/series/${seriesId}`);
      if (res.status === 401) return goto("/login");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
      offline = res.headers.get("x-hanyo-offline") === "1";
      s = (await res.json()) as SeriesDetail;
      if (page.url.searchParams.get("resume") && s.resume) {
        await goto(`/read/${s.resume.chapterId}`, { replaceState: true });
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const ordered = $derived(s ? (newestFirst ? [...s.chapters].reverse() : s.chapters) : []);
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
      ? s.chapters.filter((c) => !c.read && c.number !== null && c.number > lastRead).reverse().slice(0, 3)
      : [],
  );
  const statusDot: Record<string, string> = {
    ongoing: "bg-ok",
    completed: "bg-accent-soft",
    hiatus: "bg-fresh",
    cancelled: "bg-faint",
    unknown: "bg-faint",
  };

  async function toggleLibrary() {
    if (!s) return;
    busy = true;
    try {
      s = await api.setInLibrary(s.id, !s.inLibrary);
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
  <!-- Hero: the cover, full bleed -->
  <div class="relative h-[300px] overflow-hidden bg-accent">
    {#if s.coverUrl}
      <img src={s.coverUrl} alt="" class="absolute inset-0 h-full w-full object-cover object-top" />
    {:else}
      <span aria-hidden="true" class="font-display absolute right-[-6px] bottom-12 text-right text-[88px] leading-[0.85] font-bold tracking-[-0.05em] break-all text-white/25 uppercase">{s.title}</span>
    {/if}
    <div class="pt-safe absolute inset-x-0 top-0 flex justify-between px-3 pt-2">
      <button class="flex h-11 w-11 items-center justify-center rounded-full bg-base/60 text-fg backdrop-blur-md" onclick={() => history.back()} aria-label="Atrás">
        <Icon name="back" size={22} stroke={2.2} />
      </button>
      <button class="flex h-11 w-11 items-center justify-center rounded-full bg-base/60 text-fg backdrop-blur-md" onclick={refresh} aria-label="Actualizar capítulos" disabled={busy || offline}>
        {#if busy}<Spinner size={18} />{:else}<Icon name="refresh" size={19} stroke={2.2} />{/if}
      </button>
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

    <div class="mt-4 grid grid-cols-3 gap-2">
      <div class="rounded-2xl bg-surface px-3 py-2.5">
        <p class="font-display text-lg font-bold">{s.chapters.length}</p>
        <p class="text-xs text-muted">capítulos</p>
      </div>
      <button class="rounded-2xl bg-surface px-3 py-2.5 text-left active:bg-raised" onclick={() => (sourcesOpen = true)} aria-label="Gestionar fuentes">
        <p class="font-display flex items-center justify-between text-lg font-bold">{s.sources.length}<Icon name="chevronRight" size={16} class="text-faint" /></p>
        <p class="truncate text-xs text-muted">{s.sources.length === 1 ? "fuente" : "fuentes"}</p>
      </button>
      <div class="rounded-2xl bg-surface px-3 py-2.5">
        <p class="flex h-7 items-center"><span class="h-2.5 w-2.5 rounded-full {statusDot[s.status]}"></span></p>
        <p class="truncate text-xs text-muted">{statusLabel[s.status]?.toLowerCase()}</p>
      </div>
    </div>

    <div class="mt-4 flex gap-2.5">
      {#if readTarget}
        <a href="/read/{readTarget.id}" class="flex h-[54px] flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-bold text-on-accent">
          <Icon name="play" size={16} filled /> {readTarget.label}
        </a>
      {/if}
      <button
        onclick={toggleLibrary}
        disabled={busy || offline}
        aria-label={s.inLibrary ? "Quitar de la biblioteca" : "Añadir a la biblioteca"}
        aria-pressed={s.inLibrary}
        class="flex h-[54px] items-center justify-center gap-2 rounded-full bg-raised font-bold {s.inLibrary ? 'w-[54px] text-accent-soft' : readTarget ? 'px-5 text-fg' : 'flex-1 text-fg'}"
      >
        <Icon name="bookmark" size={22} filled={s.inLibrary} stroke={2} />
        {#if !s.inLibrary}<span class="text-[15px]">Añadir</span>{/if}
      </button>
      <button onclick={() => (downloadMenu = true)} aria-label="Descargar capítulos" class="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-raised text-fg">
        <Icon name="download" size={22} stroke={2} />
      </button>
    </div>

    {#if s.description}
      <button class="mt-4 block w-full text-left" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
        <p class="text-sm leading-relaxed break-words whitespace-pre-line text-soft {expanded ? '' : 'line-clamp-3'}">{s.description}</p>
      </button>
    {/if}

    {#if fresh.length > 0}
      <section aria-label="Capítulos nuevos" class="mt-6">
        <div class="flex items-baseline justify-between">
          <h2 class="font-display text-lg font-semibold">Nuevos</h2>
          <button class="text-[13px] font-medium text-accent-soft" onclick={() => download(fresh)}>Descargar {fresh.length === 1 ? "" : `los ${fresh.length}`}</button>
        </div>
        <ul class="mt-2 space-y-2">
          {#each fresh as c (c.id)}
            {@const st = downloads.status(c.id)}
            <li class="flex items-center gap-3 rounded-[18px] bg-surface pr-1 pl-3.5">
              <span class="rounded-lg bg-fresh px-1.5 py-0.5 text-[11px] font-bold text-on-fresh">NUEVO</span>
              <a href="/read/{c.id}" class="min-w-0 flex-1 py-3">
                <p class="truncate text-[15px] font-semibold">{chapterLabel(c.number, c.title)}</p>
                <p class="truncate text-xs text-muted">{relativeDate(c.publishedAt)}{c.publishedAt ? " · " : ""}{c.sourceName}</p>
              </a>
              <button class="flex h-11 w-11 items-center justify-center text-muted" onclick={() => (menuFor = c)} aria-label="Opciones de {chapterLabel(c.number)}">
                {#if st === "downloaded"}<Icon name="check" size={18} stroke={2.6} class="text-ok" />
                {:else if st === "active"}<Spinner size={18} />
                {:else}<Icon name="more" size={20} stroke={3} />{/if}
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section aria-label="Todos los capítulos" class="mt-6">
      <div class="flex items-baseline justify-between">
        <h2 class="font-display text-lg font-semibold">Todos</h2>
        <button class="text-[13px] text-muted" onclick={() => (newestFirst = !newestFirst)}>
          {newestFirst ? "Recientes primero" : "Primeros primero"}
        </button>
      </div>
      <ul class="mt-1">
        {#each ordered as c (c.id)}
          {@const st = downloads.status(c.id)}
          {@const current = s.resume?.chapterId === c.id}
          <li class="flex items-center">
            <a href="/read/{c.id}" class="min-w-0 flex-1 py-3">
              <p class="truncate text-[15px] {c.read ? 'text-faint' : current ? 'font-semibold text-accent-soft' : 'font-medium'}">
                {chapterLabel(c.number, c.title)}
                {#if c.title && c.number !== null && !/^ch(apter)?\.?\s*\d/i.test(c.title)}<span class="font-normal text-muted"> · {c.title}</span>{/if}
              </p>
              <p class="truncate text-xs text-muted">
                {#if current && s.resume}Leyendo · pág. {s.resume.page + 1}{:else}{relativeDate(c.publishedAt)}{c.publishedAt ? " · " : ""}{c.sourceName}{c.scanlator ? ` · ${c.scanlator}` : ""}{/if}
              </p>
            </a>
            <span class="flex w-7 justify-center">
              {#if st === "downloaded"}<Icon name="check" size={16} stroke={2.6} class="text-ok" />
              {:else if st === "active"}<Spinner size={16} />
              {:else if st === "queued"}<span class="h-1.5 w-1.5 rounded-full bg-muted"></span>{/if}
            </span>
            <button class="flex h-12 w-11 items-center justify-center text-muted" onclick={() => (menuFor = c)} aria-label="Opciones de {chapterLabel(c.number, c.title)}">
              <Icon name="more" size={20} stroke={3} />
            </button>
          </li>
        {/each}
      </ul>
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

{#if downloadMenu && s}
  {@const next5 = firstUnread ? s.chapters.filter((c) => c.number !== null && c.number >= firstUnread.number!).slice(0, 5) : []}
  <button class="fixed inset-0 z-40 bg-black/60" onclick={() => (downloadMenu = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] bg-raised p-3" role="dialog" aria-label="Descargar">
    <p class="font-display px-3 pt-2 text-lg font-semibold">Descargar</p>
    <p class="px-3 pb-3 text-sm text-muted">Para leer sin conexión</p>
    {#if next5.length}<button class="sheet-btn" onclick={() => download(next5)}>Los próximos {next5.length}</button>{/if}
    <button class="sheet-btn" disabled={!unread.length} onclick={() => download(unread)}>Todos los no leídos ({unread.length})</button>
    <button class="sheet-btn" onclick={() => download(s!.chapters)}>Todos ({s.chapters.length})</button>
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
              <p class="flex items-center gap-2 font-semibold">
                {src.sourceName}
                {#if i === 0}<span class="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-on-accent">Preferida</span>{/if}
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
            {#if i !== 0}
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
    <button class="mt-1 h-12 w-full rounded-full font-semibold text-muted active:bg-white/5" onclick={() => (sourcesOpen = false)}>Cerrar</button>
  </div>
{/if}
