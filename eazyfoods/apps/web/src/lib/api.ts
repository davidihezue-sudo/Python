// Browser API client. All calls go to the same origin; Next forwards /api to the API service.
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: any) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: any; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { 'x-requested-with': 'ezweb', ...(opts.body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : isForm ? opts.body : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Something went wrong. Please try again.', res.status, data?.error?.details);
  return data as T;
}
export const get = <T = any>(path: string) => api<T>(path);
export const post = <T = any>(path: string, body?: any) => api<T>(path, { method: 'POST', body: body ?? {} });
export const put = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PUT', body: body ?? {} });
export const patch = <T = any>(path: string, body?: any) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

export const qs = (o: Record<string, any>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export async function upload(file: File, purpose = 'image'): Promise<{ id: string; url: string }> {
  const f = new FormData();
  f.append('purpose', purpose);
  f.append('file', file);
  return api('/files', { method: 'POST', body: f });
}
