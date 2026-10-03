'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, post } from '@/lib/api';
import { ToastProvider, useToast } from './ui';

/* ---------- auth ---------- */
export type Me = { user: any | null; roles: string[]; permissions: string[]; memberships: any[]; driver: any | null; cartCount: number; unreadNotifications: number };
const AuthCtx = createContext<{ me: Me | null; ready: boolean; refresh: () => Promise<Me | null>; logout: () => Promise<void>; can: (p: string) => boolean }>({ me: null, ready: false, refresh: async () => null, logout: async () => {}, can: () => false });
export const useAuth = () => useContext(AuthCtx);

/* ---------- cart ---------- */
const CartCtx = createContext<{ cart: any | null; count: number; busy: boolean; refresh: () => Promise<void>; add: (variantId: string, qty?: number) => Promise<boolean>; setQty: (variantId: string, qty: number) => Promise<void>; options: (o: any) => Promise<void>; open: boolean; setOpen: (b: boolean) => void }>(
  { cart: null, count: 0, busy: false, refresh: async () => {}, add: async () => false, setQty: async () => {}, options: async () => {}, open: false, setOpen: () => {} });
export const useCart = () => useContext(CartCtx);

/* ---------- delivery location (stored in a cookie so server components can personalise) ---------- */
export type Loc = { lat: number; lng: number; label: string; postal?: string; city?: string; region?: string };
const LocCtx = createContext<{ loc: Loc | null; setLoc: (l: Loc | null) => void; pickerOpen: boolean; setPickerOpen: (b: boolean) => void }>({ loc: null, setLoc: () => {}, pickerOpen: false, setPickerOpen: () => {} });
export const useLoc = () => useContext(LocCtx);
const LOC_COOKIE = 'ez_loc';

function Inner({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [cart, setCart] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [loc, setLocState] = useState<Loc | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try { const d = await api<Me>('/auth/me'); setMe(d.user ? d : null); setReady(true); return d.user ? d : null; } catch { setMe(null); setReady(true); return null; }
  }, []);
  const refreshCart = useCallback(async () => { try { const d = await api('/carts/current'); setCart(d.cart); } catch { /* keep previous */ } }, []);
  useEffect(() => { refresh(); refreshCart(); try { const raw = localStorage.getItem('ez_loc'); if (raw) setLocState(JSON.parse(raw)); } catch { /* ignore */ } }, [refresh, refreshCart]);
  useEffect(() => { if (ready) refreshCart(); }, [me?.user?.id, ready, refreshCart]);

  const setLoc = useCallback((l: Loc | null) => {
    setLocState(l);
    try { if (l) localStorage.setItem('ez_loc', JSON.stringify(l)); else localStorage.removeItem('ez_loc'); } catch { /* ignore */ }
    document.cookie = l ? `${LOC_COOKIE}=${encodeURIComponent(`${l.lat},${l.lng},${l.label}`)}; path=/; max-age=31536000; samesite=lax` : `${LOC_COOKIE}=; path=/; max-age=0`;
  }, []);

  const wrap = useCallback(async (fn: () => Promise<any>) => {
    setBusy(true);
    try { const d = await fn(); if (d?.cart) setCart(d.cart); return true; } catch (e: any) { toast(e.message, 'bad'); return false; } finally { setBusy(false); }
  }, [toast]);
  const add = useCallback(async (variantId: string, qty = 1) => {
    const ok = await wrap(() => post('/carts/items', { variantId, qty }));
    if (ok) { toast('Added to your cart'); }
    return ok;
  }, [wrap, toast]);
  const setQty = useCallback(async (variantId: string, qty: number) => { await wrap(() => api(`/carts/items/${variantId}`, { method: 'PATCH', body: { qty } })); }, [wrap]);
  const options = useCallback(async (o: any) => { await wrap(() => api('/carts/options', { method: 'PATCH', body: o })); }, [wrap]);

  const auth = useMemo(() => ({
    me, ready, refresh,
    logout: async () => { try { await post('/auth/logout'); } catch { /* the session is dropped in the browser either way */ } setMe(null); setCart(null); window.location.href = '/'; },
    can: (p: string) => !!me?.permissions?.includes(p),
  }), [me, ready, refresh, refreshCart]);
  const cartV = useMemo(() => ({ cart, count: cart?.itemCount ?? 0, busy, refresh: refreshCart, add, setQty, options, open, setOpen }), [cart, busy, refreshCart, add, setQty, options, open]);
  const locV = useMemo(() => ({ loc, setLoc, pickerOpen, setPickerOpen }), [loc, setLoc, pickerOpen]);
  return <AuthCtx.Provider value={auth}><LocCtx.Provider value={locV}><CartCtx.Provider value={cartV}>{children}</CartCtx.Provider></LocCtx.Provider></AuthCtx.Provider>;
}
export function Providers({ children }: { children: ReactNode }) { return <ToastProvider><Inner>{children}</Inner></ToastProvider>; }
