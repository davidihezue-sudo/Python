// Server side data loading for server components. Forwards the visitor's cookies when asked.
import { cookies } from 'next/headers';

const BASE = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export async function sget<T = any>(path: string, opts: { auth?: boolean; revalidate?: number } = {}): Promise<T | null> {
  try {
    const headers: Record<string, string> = {};
    if (opts.auth) {
      const c = await cookies();
      const all = c.getAll().map((x) => `${x.name}=${x.value}`).join('; ');
      if (all) headers.cookie = all;
    }
    const res = await fetch(`${BASE}/api${path}`, { headers, ...(opts.auth ? { cache: 'no-store' as const } : { next: { revalidate: opts.revalidate ?? 15 } }) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
