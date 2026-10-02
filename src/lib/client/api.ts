"use client";
// Typed fetch wrapper. Throws ApiError for non-2xx responses; the UI renders field errors from `details.fieldErrors`.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public requestId?: string,
  ) {
    super(message);
  }
  get fieldErrors(): Record<string, string[]> {
    return this.details?.fieldErrors ?? {};
  }
}

export class NetworkError extends Error {
  constructor() {
    super("You appear to be offline");
  }
}

async function parse(res: Response) {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const e = json?.error;
    if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
      window.dispatchEvent(new CustomEvent("av:unauthenticated"));
    }
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`, e?.details, e?.requestId);
  }
  return json?.data;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined && !(init.body instanceof FormData) ? { "content-type": "application/json" } : undefined,
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new NetworkError();
  }
  return parse(res);
}

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== "all") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};
