import { goto } from "$app/navigation";
import { api, ApiError } from "./api";

/**
 * Open a series known only by its names (AniList): the server finds it on the sources and returns
 * the series id. When no source has it, fall back to the cross-source search for that title.
 */
export async function openByNames(title: string, titles: string[]): Promise<void> {
  try {
    const { id } = await api.resolveSeries(title, titles);
    await goto(`/series/${id}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) await goto(`/search?q=${encodeURIComponent(title)}`);
    else throw e;
  }
}
