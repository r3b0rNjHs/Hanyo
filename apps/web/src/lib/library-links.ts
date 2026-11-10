import { api } from "./api";

/** "sourceKey|externalId" → library series id, to mark (and open directly) series you already have. */
export async function libraryLinks(): Promise<Map<string, number>> {
  try {
    const links = await api.libraryLinks();
    return new Map(links.map((l) => [`${l.sourceKey}|${l.externalId}`, l.seriesId]));
  } catch {
    return new Map();
  }
}
