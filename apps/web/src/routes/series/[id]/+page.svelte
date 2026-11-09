<script lang="ts">
  import type { ChapterSummary, SeriesDetail } from "@hanyo/types";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
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
    s?.resume ? { id: s.resume.chapterId, label: `Continuar · ${chapterLabel(s.resume.chapterNumber)}` }
    : firstUnread ? { id: firstUnread.id, label: s && s.chapters.some((c) => c.read) ? `Seguir · ${chapterLabel(firstUnread.number)}` : "Empezar a leer" }
    : null,
  );
  const unread = $derived(s?.chapters.filter((c) => !c.read) ?? []);

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
    {#if error}<p class="px-6 text-center text-ink-400">{error}</p>{:else}<Spinner />{/if}
  </div>
{:else}
  <!-- Hero -->
  <div class="relative overflow-hidden">
    {#if s.coverUrl}
      <img src={s.coverUrl} alt="" class="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl" />
    {/if}
    <div class="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/70 to-ink-950"></div>

    <div class="pt-safe relative">
      <div class="flex items-center justify-between px-2 pt-1">
        <button class="flex h-10 w-10 items-center justify-center rounded-full active:bg-white/10" onclick={() => history.back()} aria-label="Atrás">
          <Icon name="back" size={24} />
        </button>
        <button class="flex h-10 w-10 items-center justify-center rounded-full active:bg-white/10" onclick={refresh} aria-label="Actualizar capítulos" disabled={busy || offline}>
          {#if busy}<Spinner size={18} />{:else}<Icon name="refresh" size={20} />{/if}
        </button>
      </div>

      <div class="flex gap-4 px-4 pt-2 pb-4">
        <Cover src={s.coverUrl} alt={s.title} class="w-28 shrink-0 shadow-2xl" />
        <div class="min-w-0 pt-1">
          <h1 class="text-xl leading-tight font-bold">{s.title}</h1>
          {#if s.authors.length}<p class="mt-1 truncate text-sm text-ink-200">{s.authors.join(", ")}</p>{/if}
          <p class="mt-1 text-xs text-ink-400">{statusLabel[s.status]} · {s.chapters.length} capítulos</p>
          <div class="mt-2 flex flex-wrap gap-1">
            {#each s.sources as src (src.id)}
              <span class="rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-ink-200" title="{src.chapterCount} capítulos">
                {src.sourceName} · {src.chapterCount}
              </span>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>

  {#if offline}
    <p class="mx-4 mb-3 flex items-center gap-2 rounded-lg bg-ink-850 px-3 py-2 text-xs text-ink-400">
      <Icon name="cloudOff" size={14} /> Datos guardados · puede no estar al día
    </p>
  {/if}

  <!-- Actions -->
  <div class="flex gap-2 px-4">
    {#if readTarget}
      <a href="/read/{readTarget.id}" class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-hanji-300 to-hanji-500 py-3 text-[15px] font-semibold text-ink-950">
        <Icon name="play" size={18} stroke={2.2} /> {readTarget.label}
      </a>
    {/if}
    <button
      onclick={toggleLibrary}
      disabled={busy || offline}
      class="flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-[15px] font-semibold {s.inLibrary ? 'bg-ink-800 text-ink-100' : 'bg-ink-100 text-ink-950'} {readTarget ? '' : 'flex-1'}"
    >
      <Icon name={s.inLibrary ? "check" : "plus"} size={18} stroke={2.4} />
      {s.inLibrary ? "En biblioteca" : "Añadir"}
    </button>
  </div>

  {#if s.description}
    <button class="mt-4 block w-full px-4 text-left" onclick={() => (expanded = !expanded)}>
      <p class="text-sm leading-relaxed break-words whitespace-pre-line text-ink-200 {expanded ? '' : 'line-clamp-3'}">
        {s.description}
      </p>
    </button>
  {/if}
  {#if s.genres.length}
    <div class="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto px-4">
      {#each s.genres as g (g)}<span class="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-xs text-ink-400">{g}</span>{/each}
    </div>
  {/if}

  <!-- Chapters -->
  <div class="mt-6 flex items-center justify-between px-4">
    <h2 class="text-lg font-semibold">Capítulos</h2>
    <div class="flex items-center gap-1">
      <button class="rounded-full px-3 py-1.5 text-[13px] font-medium text-hanji-300 active:bg-white/5" onclick={() => (downloadMenu = true)}>
        Descargar
      </button>
      <button class="rounded-full px-3 py-1.5 text-[13px] text-ink-400 active:bg-white/5" onclick={() => (newestFirst = !newestFirst)}>
        {newestFirst ? "Recientes ↓" : "Primeros ↑"}
      </button>
    </div>
  </div>

  <ul class="mt-1">
    {#each ordered as c (c.id)}
      {@const st = downloads.status(c.id)}
      <li class="flex items-center border-b border-white/5">
        <a href="/read/{c.id}" class="min-w-0 flex-1 py-3 pl-4">
          <p class="truncate text-[15px] font-medium {c.read ? 'text-ink-500' : ''}">
            {chapterLabel(c.number, c.title)}
            {#if c.title && c.number !== null && !/^ch(apter)?\.?\s*\d/i.test(c.title)}<span class="font-normal text-ink-400"> · {c.title}</span>{/if}
          </p>
          <p class="mt-0.5 truncate text-xs text-ink-500">
            {relativeDate(c.publishedAt)}{c.publishedAt ? " · " : ""}{c.sourceName}{c.scanlator ? ` · ${c.scanlator}` : ""}
          </p>
        </a>
        <span class="flex w-8 justify-center text-ink-400">
          {#if st === "downloaded"}<Icon name="check" size={16} class="text-hanji-300" stroke={2.4} />
          {:else if st === "active"}<Spinner size={16} />
          {:else if st === "queued"}<span class="h-1.5 w-1.5 rounded-full bg-ink-400"></span>{/if}
        </span>
        <button class="flex h-12 w-11 items-center justify-center text-ink-400 active:bg-white/5" onclick={() => (menuFor = c)} aria-label="Opciones">
          <Icon name="more" size={20} stroke={3} />
        </button>
      </li>
    {/each}
  </ul>
{/if}

<!-- Action sheets -->
{#if menuFor && s}
  {@const c = menuFor}
  {@const st = downloads.status(c.id)}
  <button class="fixed inset-0 z-40 bg-black/50" onclick={() => (menuFor = null)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-ink-850 p-2">
    <p class="px-3 pt-2 pb-3 text-sm font-semibold text-ink-400">{chapterLabel(c.number, c.title)}</p>
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
    <button class="sheet-btn mt-1 text-ink-400" onclick={() => (menuFor = null)}>Cancelar</button>
  </div>
{/if}

{#if downloadMenu && s}
  {@const next5 = firstUnread ? s.chapters.filter((c) => c.number !== null && c.number >= firstUnread.number!).slice(0, 5) : []}
  <button class="fixed inset-0 z-40 bg-black/50" onclick={() => (downloadMenu = false)} aria-label="Cerrar"></button>
  <div class="pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-ink-850 p-2">
    <p class="px-3 pt-2 pb-3 text-sm font-semibold text-ink-400">Descargar para leer sin conexión</p>
    {#if next5.length}<button class="sheet-btn" onclick={() => download(next5)}>Los próximos {next5.length}</button>{/if}
    <button class="sheet-btn" disabled={!unread.length} onclick={() => download(unread)}>Todos los no leídos ({unread.length})</button>
    <button class="sheet-btn" onclick={() => download(s!.chapters)}>Todos ({s.chapters.length})</button>
    <button class="sheet-btn mt-1 text-ink-400" onclick={() => (downloadMenu = false)}>Cancelar</button>
  </div>
{/if}

<style>
  :global(.sheet-btn) {
    display: block;
    width: 100%;
    border-radius: 0.75rem;
    padding: 0.85rem 0.75rem;
    text-align: left;
    font-size: 16px;
  }
  :global(.sheet-btn:active) {
    background: rgb(255 255 255 / 0.06);
  }
  :global(.sheet-btn:disabled) {
    opacity: 0.4;
  }
</style>
