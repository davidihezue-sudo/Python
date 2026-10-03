'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

// Loads data for the current user. Re-runs when `path` changes. Returns stable `reload` and `setData` for optimistic UI.
export function useApi<T = any>(path: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    const n = ++seq.current;
    setLoading(true);
    try { const d = await api<T>(path); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError(e); }
    finally { if (n === seq.current) setLoading(false); }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: load, setData };
}

// Server sent events with automatic reconnect (the browser handles retry). onEvent(type, payload) fires per message.
const EVENT_TYPES = ['order.status', 'order.new', 'order.message', 'suborder.status', 'delivery.status', 'driver.location', 'driver.availability', 'offer', 'job.assigned', 'job.cancelled', 'job.completed', 'notification', 'ticket.new', 'ticket.message', 'refund.issued', 'low_inventory', 'ready'];
export function useStream(topics: string[], onEvent: (type: string, data: any) => void, enabled = true) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  const key = topics.join(',');
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const base = process.env.NEXT_PUBLIC_STREAM_URL ?? '/api/stream';
    const es = new EventSource(`${base}${key ? `?topics=${encodeURIComponent(key)}` : ''}`, { withCredentials: true });
    EVENT_TYPES.forEach((n) => es.addEventListener(n, ((e: MessageEvent) => { let d: any = e.data; try { d = JSON.parse(e.data); } catch { /* keep raw */ } cb.current(n, d); }) as any));
    return () => es.close();
  }, [enabled, key]);
}
export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}
