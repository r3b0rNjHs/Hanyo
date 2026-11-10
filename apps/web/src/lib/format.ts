export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function chapterLabel(n: number | null, title?: string | null): string {
  if (n === null) return title || "Extra";
  const num = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `Capítulo ${num}`;
}

export function relativeDate(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < day) return "hoy";
  if (diff < 2 * day) return "ayer";
  if (diff < 30 * day) return `hace ${Math.floor(diff / day)} días`;
  return new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

export const statusLabel: Record<string, string> = {
  ongoing: "En emisión",
  completed: "Finalizada",
  hiatus: "En pausa",
  cancelled: "Cancelada",
  unknown: "Estado desconocido",
};

/** Reading lists, in display order. */
export const SHELVES = [
  ["reading", "Leyendo"],
  ["plan", "Pendiente"],
  ["paused", "En pausa"],
  ["completed", "Terminada"],
] as const;

export function shelfLabel(shelf: string): string {
  return SHELVES.find(([k]) => k === shelf)?.[1] ?? shelf;
}
