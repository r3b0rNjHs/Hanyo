export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/** fetch with a timeout and a readable error on non-2xx responses. */
export async function fetchOk(url: string, opts: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 20_000, ...init } = opts;
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, `${init.method ?? "GET"} ${url} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchOk(url, opts);
  return (await res.json()) as T;
}
