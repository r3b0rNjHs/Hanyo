/**
 * Normalize a title so the same series from different sources groups together.
 * "Return of the Mount Hua Sect!" and "return of the mount hua sect" -> "return of the mount hua sect"
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort chapter number from a chapter name, for sources that don't give one.
 * "Chapter 123.5 - The End" -> 123.5 ; "Ep. 45" -> 45 ; "Prologue" -> null
 */
export function parseChapterNumber(name: string): number | null {
  const m =
    /(?:chapter|chap|ch|episode|ep)\.?\s*(\d+(?:\.\d+)?)/i.exec(name) ?? /(\d+(?:\.\d+)?)/.exec(name);
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}
