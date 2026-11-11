<script lang="ts">
  import type { ReadingStats } from "@hanyo/types";
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import Cover from "$lib/components/Cover.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";

  let s = $state<ReadingStats | null>(null);
  let error = $state<string | null>(null);
  /** The day or week the reader tapped (charts are read by tapping on a phone). */
  let picked = $state<string | null>(null);

  onMount(() => {
    api.stats().then((r) => (s = r), (e) => (error = (e as Error).message));
  });

  const fmtDay = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /** Heatmap: weeks as columns (Monday first), the last column ends today. */
  const weeks = $derived.by(() => {
    if (!s) return [] as ({ date: string; chapters: number } | null)[][];
    const days = s.days;
    const lastDow = (new Date(`${days.at(-1)!.date}T12:00:00`).getDay() + 6) % 7;
    const padded: ({ date: string; chapters: number } | null)[] = [...days, ...Array(6 - lastDow).fill(null)];
    const cols: (typeof padded)[] = [];
    for (let i = padded.length - 7 * Math.floor(padded.length / 7); i < padded.length; i += 7) cols.push(padded.slice(i, i + 7));
    return cols;
  });
  /** Sequential, one hue: the accent at increasing strength; 0 is the empty track. */
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  const LEVEL_BG = ["var(--color-raised)", "color-mix(in srgb, var(--color-accent) 35%, var(--color-raised))", "color-mix(in srgb, var(--color-accent) 60%, var(--color-raised))", "color-mix(in srgb, var(--color-accent) 82%, var(--color-raised))", "var(--color-accent)"];

  /** Last 12 weeks, Monday-first, as bars. */
  const weekly = $derived.by(() => {
    if (!s) return [] as { label: string; chapters: number; start: string }[];
    const out: { label: string; chapters: number; start: string }[] = [];
    for (const col of weeks.slice(-12)) {
      const real = col.filter((d): d is { date: string; chapters: number } => d !== null);
      if (!real.length) continue;
      out.push({
        start: real[0]!.date,
        label: new Date(`${real[0]!.date}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }),
        chapters: real.reduce((n, d) => n + d.chapters, 0),
      });
    }
    return out;
  });
  const weeklyMax = $derived(Math.max(1, ...weekly.map((w) => w.chapters)));
  const genreMax = $derived(Math.max(1, ...(s?.topGenres ?? []).map((g) => g.chapters)));
  const pickedDay = $derived(s?.days.find((d) => d.date === picked) ?? null);
  const pickedWeek = $derived(weekly.find((w) => w.start === picked) ?? null);
</script>

<!-- Lists read best in a column on wide screens. -->
<div class="lg:mx-auto lg:max-w-3xl">

<header class="pt-safe sticky top-0 z-20 bg-base/90 backdrop-blur-xl">
  <div class="flex items-center gap-2 px-3 pt-3 pb-2">
    <a href="/updates?view=history" class="flex h-11 w-11 items-center justify-center rounded-full" aria-label="Volver"><Icon name="back" size={22} stroke={2.2} /></a>
    <h1 class="font-display text-[26px] font-bold tracking-[-0.03em]">Tus estadísticas</h1>
  </div>
</header>

{#if !s && !error}
  <div class="flex justify-center py-24"><Spinner /></div>
{:else if error}
  <p class="px-6 py-24 text-center text-muted">{error}</p>
{:else if s}
  <div class="space-y-6 px-5 pb-8">
    <!-- Headline numbers -->
    <section class="grid grid-cols-2 gap-2.5" aria-label="Resumen">
      <div class="col-span-2 flex items-center gap-4 rounded-[var(--radius-panel)] bg-surface p-4">
        <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-fresh/15 text-2xl" aria-hidden="true">🔥</span>
        <span>
          <span class="font-display block text-[34px] leading-none font-bold">{plural(s.streak.current, "día", "días")}</span>
          <span class="text-sm text-muted">de racha · tu mejor: {plural(s.streak.best, "día", "días")}</span>
        </span>
      </div>
      {#each [["Esta semana", s.totals.week], ["Este mes", s.totals.month], ["Este año", s.totals.year], ["En total", s.totals.all]] as const as [label, n] (label)}
        <div class="rounded-[var(--radius-card)] bg-surface px-4 py-3">
          <p class="font-display text-[26px] leading-tight font-bold">{n}</p>
          <p class="text-xs text-muted">{label} · capítulos</p>
        </div>
      {/each}
    </section>

    <!-- Activity heatmap -->
    <section aria-label="Actividad">
      <div class="flex items-baseline justify-between">
        <h2 class="font-display text-lg font-semibold">Actividad</h2>
        <p class="text-xs text-muted" aria-live="polite">
          {#if pickedDay}{fmtDay(pickedDay.date)} · {plural(pickedDay.chapters, "capítulo", "capítulos")}{:else}Toca un día{/if}
        </p>
      </div>
      <div class="mt-2">
        <!-- Fills the width: one column per week, square cells. -->
        <div class="grid gap-[3px]" style="grid-template-columns: repeat({weeks.length}, minmax(0, 1fr))" role="grid" aria-label="Capítulos por día, últimas {weeks.length} semanas">
          {#each weeks as col, ci (ci)}
            <div class="flex flex-col gap-[3px]" role="row">
              {#each col as d, di (di)}
                {#if d}
                  <button
                    role="gridcell"
                    class="aspect-square w-full rounded-[4px] {picked === d.date ? 'ring-2 ring-fg ring-offset-1 ring-offset-base' : ''}"
                    style="background: {LEVEL_BG[level(d.chapters)]}"
                    aria-label="{fmtDay(d.date)}: {plural(d.chapters, 'capítulo', 'capítulos')}"
                    onclick={() => (picked = picked === d.date ? null : d.date)}
                  ></button>
                {:else}
                  <span class="aspect-square w-full" aria-hidden="true"></span>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>
      <p class="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted" aria-hidden="true">
        Menos {#each LEVEL_BG as bg (bg)}<span class="h-[11px] w-[11px] rounded-[3px]" style="background: {bg}"></span>{/each} Más
      </p>
    </section>

    <!-- Weekly bars -->
    <section aria-label="Capítulos por semana">
      <div class="flex items-baseline justify-between">
        <h2 class="font-display text-lg font-semibold">Por semana</h2>
        <p class="text-xs text-muted" aria-live="polite">
          {#if pickedWeek}Semana del {pickedWeek.label} · {plural(pickedWeek.chapters, "capítulo", "capítulos")}{:else}Últimas 12 semanas{/if}
        </p>
      </div>
      <div class="mt-3 flex h-32 items-end gap-[2px] border-b border-line">
        {#each weekly as w (w.start)}
          <button
            class="group flex h-full flex-1 items-end justify-center"
            aria-label="Semana del {w.label}: {plural(w.chapters, 'capítulo', 'capítulos')}"
            onclick={() => (picked = picked === w.start ? null : w.start)}
          >
            <span
              class="w-[70%] max-w-[18px] rounded-t-[4px] {picked === w.start ? 'bg-fg' : 'bg-accent'}"
              style="height: {w.chapters ? Math.max(4, (w.chapters / weeklyMax) * 100) : 0}%"
            ></span>
          </button>
        {/each}
      </div>
      <div class="mt-1 flex text-[10px] text-faint">
        <span class="flex-1">{weekly[0]?.label ?? ""}</span><span>esta semana</span>
      </div>
    </section>

    {#if s.topSeries.length}
      <section aria-label="Lo que más has leído este año">
        <h2 class="font-display text-lg font-semibold">Lo más leído este año</h2>
        <ol class="mt-2 space-y-2">
          {#each s.topSeries as t, i (t.seriesId)}
            <li>
              <a href="/series/{t.seriesId}" class="flex items-center gap-3 rounded-2xl bg-surface p-2 pr-4">
                <span class="font-display w-5 text-center text-sm font-bold text-muted">{i + 1}</span>
                <span class="w-10 shrink-0"><Cover src={t.coverUrl} alt={t.title} rounded="rounded-[9px]" /></span>
                <span class="min-w-0 flex-1 truncate font-semibold">{t.title}</span>
                <span class="text-sm text-soft tabular-nums">{t.chapters}</span>
              </a>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if s.topGenres.length}
      <section aria-label="Géneros que más lees">
        <h2 class="font-display text-lg font-semibold">Tus géneros</h2>
        <ul class="mt-3 space-y-2.5">
          {#each s.topGenres as g (g.name)}
            <li class="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
              <span class="truncate text-soft">{g.name}</span>
              <span class="h-2.5 overflow-hidden rounded-full bg-raised">
                <span class="block h-full rounded-full bg-accent" style="width: {(g.chapters / genreMax) * 100}%"></span>
              </span>
              <span class="text-xs text-muted tabular-nums">{g.chapters}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <p class="text-center text-xs text-faint">
      {plural(s.finishedSeries, "serie terminada", "series terminadas")} en tu biblioteca · marcar varios capítulos de golpe no cuenta como lectura
    </p>
  </div>
{/if}
</div>
