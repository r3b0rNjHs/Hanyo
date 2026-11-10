import type {
  ChapterPages,
  ExploreKind,
  ExploreResponse,
  TrendingOrigin,
  TrendingResponse,
  ProgressUpdate,
  SearchMetaResponse,
  SearchResponse,
  SeriesDetail,
  SeriesSummary,
  ServerStats,
  Shelf,
  SourceInfo,
  UpdateCheckResult,
} from "@hanyo/types";
import { goto } from "$app/navigation";
import { queueProgress } from "./offline/progress-queue";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** True when the response came from the service worker's offline cache. */
export function isFromCache(res: Response): boolean {
  return res.headers.get("x-hanyo-offline") === "1";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError(0, "Sin conexión");
  }
  if (res.status === 401 && !path.startsWith("/auth/")) {
    await goto("/login");
    throw new ApiError(401, "Inicia sesión");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

export const api = {
  login: (password: string) => post<{ ok: true }>("/auth/login", { password }),
  logout: () => post<{ ok: true }>("/auth/logout", {}),
  me: () => request<{ ok: true }>("/auth/me"),

  sources: () => request<SourceInfo[]>("/sources"),
  search: (source: string, q: string, signal?: AbortSignal) =>
    request<SearchResponse>(`/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`, { signal }),

  explore: (source: string, kind: ExploreKind, page: number) =>
    request<ExploreResponse>(`/explore?source=${encodeURIComponent(source)}&kind=${kind}&page=${page}`),

  trending: (origin: TrendingOrigin, page: number, genre?: string) =>
    request<TrendingResponse>(
      `/explore/trending?origin=${origin}&page=${page}${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`,
    ),

  searchMeta: (q: string, signal?: AbortSignal) =>
    request<SearchMetaResponse>(`/search/meta?q=${encodeURIComponent(q)}`, { signal }),

  openSeries: (sourceKey: string, externalId: string) => post<{ id: number }>("/series/open", { sourceKey, externalId }),
  series: (id: number) => request<SeriesDetail>(`/series/${id}`),
  setInLibrary: (id: number, inLibrary: boolean) => post<SeriesDetail>(`/series/${id}/library`, { inLibrary }),
  refreshSeries: (id: number) =>
    post<{ newNumbers: number[]; errors: string[]; detail: SeriesDetail }>(`/series/${id}/refresh`, {}),
  autoLink: (id: number) => post<{ added: string[]; detail: SeriesDetail }>(`/series/${id}/autolink`, {}),
  setShelf: (id: number, shelf: Shelf) => post<SeriesDetail>(`/series/${id}/shelf`, { shelf }),
  setAutoDownload: (id: number, enabled: boolean) => post<SeriesDetail>(`/series/${id}/autodownload`, { enabled }),
  setLang: (id: number, lang: string) => post<SeriesDetail>(`/series/${id}/lang`, { lang }),
  setSourcePriority: (id: number, linkId: number, priority: number) =>
    request<SeriesDetail>(`/series/${id}/sources/${linkId}`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  unlinkSource: (id: number, linkId: number) =>
    request<SeriesDetail>(`/series/${id}/sources/${linkId}`, { method: "DELETE" }),
  markRead: (id: number, numbers: number[], read: boolean) =>
    post<SeriesDetail>(`/series/${id}/read`, { numbers, read }),

  library: () => request<SeriesSummary[]>("/library"),
  libraryLinks: () => request<{ sourceKey: string; externalId: string; seriesId: number }[]>("/library/links"),
  relinkLibrary: () => post<{ started: boolean; series: number }>("/library/relink", {}),
  chapterPages: (chapterId: number) => request<ChapterPages>(`/chapters/${chapterId}/pages`),

  /** Saves progress; when offline it is queued and replayed later. */
  async progress(update: ProgressUpdate): Promise<void> {
    try {
      await post("/progress", update);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) await queueProgress(update);
      else throw e;
    }
  },

  serverStats: () => request<ServerStats>("/server/stats"),
  checkUpdates: () => post<UpdateCheckResult>("/updates/check", {}),
  pushKey: () => request<{ enabled: boolean; publicKey: string | null }>("/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => post("/push/subscribe", sub),
  pushTest: () => post("/push/test", {}),
};
