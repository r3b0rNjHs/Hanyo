export type ReadingMode = "vertical" | "rtl" | "ltr";

interface ReaderSettings {
  defaultMode: ReadingMode | "auto";
  background: "black" | "gray" | "white";
  keepAwake: boolean;
  showPageNumber: boolean;
  brightness: number;
  /** Fetch the next chapter while reading this one. */
  prefetchNext: boolean;
}

const KEY = "hanyo.reader.v1";
const MODES_KEY = "hanyo.reader.modes.v1";

const defaults: ReaderSettings = {
  defaultMode: "auto",
  background: "black",
  keepAwake: true,
  showPageNumber: true,
  brightness: 1,
  prefetchNext: true,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode): settings just don't persist.
  }
}

export const readerSettings = $state<ReaderSettings>(load(KEY, defaults));

$effect.root(() => {
  $effect(() => save(KEY, $state.snapshot(readerSettings)));
});

/** Per-series reading mode chosen by the user (overrides auto-detection). */
const seriesModes: Record<string, ReadingMode> = load(MODES_KEY, {});

export function seriesMode(seriesId: number): ReadingMode | null {
  return seriesModes[seriesId] ?? null;
}

export function setSeriesMode(seriesId: number, mode: ReadingMode): void {
  seriesModes[seriesId] = mode;
  save(MODES_KEY, seriesModes);
}

const LONG_STRIP_TAGS = ["long strip", "webtoon", "manhwa", "manhua", "full color", "web comic", "webtoons"];

/**
 * Mode resolution: per-series choice > global default > auto.
 * Auto uses tags first (like Suwayomi's isLongStripType), then the page shape:
 * tall pages (median height/width > 2) are a vertical strip, otherwise manga RTL.
 */
export function resolveMode(seriesId: number, genres: string[], pageRatios: number[] = []): ReadingMode {
  const own = seriesMode(seriesId);
  if (own) return own;
  if (readerSettings.defaultMode !== "auto") return readerSettings.defaultMode;
  const tags = genres.map((g) => g.toLowerCase());
  if (tags.some((t) => LONG_STRIP_TAGS.includes(t))) return "vertical";
  if (pageRatios.length) {
    const sorted = [...pageRatios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    if (median > 2) return "vertical";
  }
  // Without signals default to vertical: Hanyo's main use is manhwa.
  return pageRatios.length ? "rtl" : "vertical";
}

export const backgroundColor: Record<ReaderSettings["background"], string> = {
  black: "#000",
  gray: "#2a2a2e",
  white: "#fff",
};
