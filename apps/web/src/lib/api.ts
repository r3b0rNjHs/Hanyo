import type {
  ChapterPages,
  ExploreKind,
  FeedItem,
  HistoryItem,
  ExploreResponse,
  TrendingOrigin,
  TrendingSort,
  TrendingResponse,
  ProgressUpdate,
  ReadingStats,
  RecommendationsResponse,
  SearchMetaResponse,
  SearchResponse,
  SeriesDetail,
  SeriesSummary,
  ServerStats,
  Shelf,
  SourceHealth,
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
  if (res.status === 401 && !path.startsWith("/auth/") && !path.startsWith("/invites/")) {
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
  login: (username: string, password: string) =>
    post<{ ok: true; user: { id: number; username: string; isAdmin: boolean } }>("/auth/login", { username, password }),
  logout: () => post<{ ok: true }>("/auth/logout", {}),
  me: () => request<{ ok: true; user: { id: number; username: string; isAdmin: boolean } }>("/auth/me"),
  inviteValid: (token: string) => request<{ valid: boolean }>(`/invites/${encodeURIComponent(token)}`),
  redeemInvite: (token: string, username: string, password: string) =>
    post<{ ok: true; user: { id: number; username: string; isAdmin: boolean } }>(`/invites/${encodeURIComponent(token)}/redeem`, {
      username,
      password,
    }),
  adminUsers: () =>
    request<{ id: number; username: string; isAdmin: boolean; createdAt: number; librarySize: number; lastReadAt: number | null }[]>(
      "/admin/users",
    ),
  deleteUser: (id: number) => request<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" }),
  invites: () => request<{ token: string; createdAt: number; expiresAt: number }[]>("/admin/invites"),
  createInvite: () => post<{ token: string; expiresAt: number }>("/admin/invites", {}),
  revokeInvite: (token: string) => request<{ ok: true }>(`/admin/invites/${encodeURIComponent(token)}`, { method: "DELETE" }),
  updateAccount: (body: { currentPassword: string; username?: string; password?: string }) =>
    post<{ ok: true; user: { id: number; username: string; isAdmin: boolean } }>("/auth/account", body),

  sources: () => request<SourceInfo[]>("/sources"),
  search: (source: string, q: string, signal?: AbortSignal) =>
    request<SearchResponse>(`/search?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`, { signal }),

  explore: (source: string, kind: ExploreKind, page: number) =>
    request<ExploreResponse>(`/explore?source=${encodeURIComponent(source)}&kind=${kind}&page=${page}`),

  trending: (origin: TrendingOrigin, page: number, genre?: string, sort: TrendingSort = "trending") =>
    request<TrendingResponse>(
      `/explore/trending?origin=${origin}&page=${page}&sort=${sort}${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`,
    ),
  resolveSeries: (title: string, titles: string[]) => post<{ id: number }>("/series/resolve", { title, titles }),

  searchMeta: (q: string, signal?: AbortSignal) =>
    request<SearchMetaResponse>(`/search/meta?q=${encodeURIComponent(q)}`, { signal }),

  openSeries: (sourceKey: string, externalId: string) => post<{ id: number }>("/series/open", { sourceKey, externalId }),
  series: (id: number) => request<SeriesDetail>(`/series/${id}`),
  setInLibrary: (id: number, inLibrary: boolean) => post<SeriesDetail>(`/series/${id}/library`, { inLibrary }),
  refreshSeries: (id: number) =>
    post<{ newNumbers: number[]; errors: string[]; detail: SeriesDetail }>(`/series/${id}/refresh`, {}),
  autoLink: (id: number) => post<{ added: string[]; detail: SeriesDetail }>(`/series/${id}/autolink`, {}),
  recommendations: (id: number) => request<RecommendationsResponse>(`/series/${id}/recommendations`),
  setShelf: (id: number, shelf: Shelf) => post<SeriesDetail>(`/series/${id}/shelf`, { shelf }),
  setScanlator: (id: number, name: string | null) => post<SeriesDetail>(`/series/${id}/scanlator`, { name }),
  setNotify: (id: number, enabled: boolean) => post<SeriesDetail>(`/series/${id}/notify`, { enabled }),
  setAutoDownload: (id: number, enabled: boolean) => post<SeriesDetail>(`/series/${id}/autodownload`, { enabled }),
  setLang: (id: number, lang: string) => post<SeriesDetail>(`/series/${id}/lang`, { lang }),
  setSourcePriority: (id: number, linkId: number, priority: number) =>
    request<SeriesDetail>(`/series/${id}/sources/${linkId}`, { method: "PATCH", body: JSON.stringify({ priority }) }),
  unlinkSource: (id: number, linkId: number) =>
    request<SeriesDetail>(`/series/${id}/sources/${linkId}`, { method: "DELETE" }),
  markRead: (id: number, numbers: number[], read: boolean) =>
    post<SeriesDetail>(`/series/${id}/read`, { numbers, read }),

  library: () => request<SeriesSummary[]>("/library"),
  feed: () => request<FeedItem[]>("/feed"),
  history: () => request<HistoryItem[]>("/history"),
  stats: () => request<ReadingStats>(`/stats?tz=${-new Date().getTimezoneOffset()}`),
  forgetHistory: (seriesId: number) => request<{ ok: true }>(`/history/${seriesId}`, { method: "DELETE" }),
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

  sourceHealth: () => request<SourceHealth[]>("/sources/health"),
  checkSources: () => post<SourceHealth[]>("/sources/health/check", {}),
  serverStats: () => request<ServerStats>("/server/stats"),
  checkUpdates: () => post<UpdateCheckResult>("/updates/check", {}),
  pushKey: () => request<{ enabled: boolean; publicKey: string | null }>("/push/key"),
  pushSubscribe: (sub: PushSubscriptionJSON) => post("/push/subscribe", sub),
  pushTest: () => post("/push/test", {}),
};
