"use client";
// Client side finance context: the active household, the My / Household view, locale aware formatting, and query helpers.
import * as React from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api, qs, ApiError } from "@/lib/client/api";
import { useToast } from "@/components/ui/toast";

export type FinView = "my" | "household";
export interface FinHousehold { id: string; name: string; role: "ADMIN" | "MEMBER" | "READ_ONLY" | "CHILD" | "ACCOUNTANT"; onboarded: boolean; isDemo: boolean; currency: string; countryCode: string }
export interface FinProfile {
  id: string; name: string; countryCode: string; region: string | null; city: string | null; currency: string; timezone: string; fiscalYearStartMonth: number; dateFormat: string; numberLocale: string; structure: string | null;
  goalsPreference: string[]; budgetPeriod: string; dashboardLayout: { id: string; visible: boolean }[] | null; onboarded: boolean; isDemo: boolean; myRole: "ADMIN" | "MEMBER" | "READ_ONLY" | "CHILD" | "ACCOUNTANT"; myMemberId: string; sharingReviewed: boolean; memberCount: number; canWrite: boolean; today: string; hiddenAccountCount: number;
}
export interface Member { id: string; userId: string; name: string; email: string | null; role: string; accessUntil?: string | null; avatarColor: string | null; responsibilities: string | null; isMe: boolean; sharingDefaults?: Record<string, string> }
export interface MemberRef { id: string; name: string; color: string | null }

export function makeFmt(p: { currency: string; numberLocale: string; dateFormat: string }) {
  const locale = p.numberLocale || "en-CA";
  const cur = new Map<string, Intl.NumberFormat>();
  const nf = (c: string) => cur.get(c) ?? (cur.set(c, new Intl.NumberFormat(locale, { style: "currency", currency: c })), cur.get(c) as Intl.NumberFormat);
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  return {
    currency: p.currency, locale,
    /** Formats a money string or number. Missing values show "n/a" rather than a misleading zero. */
    money: (v: string | number | null | undefined, o: { currency?: string; sign?: boolean; zeroDash?: boolean } = {}) => {
      if (v === null || v === undefined || v === "") return "n/a";
      const n = Number(v);
      if (!Number.isFinite(n)) return "n/a";
      const s = nf(o.currency ?? p.currency).format(Math.abs(n));
      return n < 0 ? `-${s}` : o.sign && n > 0 ? `+${s}` : s;
    },
    compact: (v: string | number) => compact.format(Number(v)),
    num: (v: string | number | null | undefined, d = 2) => (v === null || v === undefined || v === "" ? "n/a" : new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(Number(v))),
    pct: (v: string | number | null | undefined, d = 1) => (v === null || v === undefined || v === "" ? "n/a" : `${new Intl.NumberFormat(locale, { maximumFractionDigits: d }).format(Number(v))}%`),
    date: (iso: string | null | undefined) => {
      if (!iso) return "n/a";
      const [y, m, d] = iso.slice(0, 10).split("-");
      switch (p.dateFormat) {
        case "DD/MM/YYYY": return `${d}/${m}/${y}`;
        case "MM/DD/YYYY": return `${m}/${d}/${y}`;
        case "D MMM YYYY": return `${Number(d)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
        default: return `${y}-${m}-${d}`;
      }
    },
    month: (key: string) => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${key.slice(0, 7)}-01T00:00:00Z`)),
  };
}
export type Fmt = ReturnType<typeof makeFmt>;

interface Ctx {
  hid: string | null; households: FinHousehold[]; setHid: (id: string) => void; loading: boolean;
  profile: FinProfile | undefined; fmt: Fmt; view: FinView; setView: (v: FinView) => void; canWrite: boolean; isAdmin: boolean;
}
const FinContext = React.createContext<Ctx | null>(null);
export const useFin = () => React.useContext(FinContext) as Ctx;

export function FinProvider({ children }: { children: React.ReactNode }) {
  const [hid, setHidState] = React.useState<string | null>(null);
  const [view, setViewState] = React.useState<FinView>("household");
  const { data, isLoading } = useQuery({ queryKey: ["fin", "context"], queryFn: () => api<{ households: FinHousehold[] }>("/api/finance/context"), staleTime: 30_000 });
  React.useEffect(() => {
    try {
      const v = localStorage.getItem("ffh:view");
      if (v === "my" || v === "household") setViewState(v);
    } catch { /* storage unavailable */ }
  }, []);
  React.useEffect(() => {
    if (!data?.households.length) return;
    let want: string | null = null;
    try { want = localStorage.getItem("ffh:household"); } catch { /* ignore */ }
    const pick = data.households.find((h) => h.id === want) ?? data.households.find((h) => !h.isDemo) ?? data.households[0];
    setHidState((cur) => (cur && data.households.some((h) => h.id === cur) ? cur : pick.id));
  }, [data]);
  const setHid = React.useCallback((id: string) => { setHidState(id); try { localStorage.setItem("ffh:household", id); } catch { /* ignore */ } }, []);
  const setView = React.useCallback((v: FinView) => { setViewState(v); try { localStorage.setItem("ffh:view", v); } catch { /* ignore */ } }, []);
  const { data: profile } = useQuery({ queryKey: ["fin", hid, "profile"], queryFn: () => api<FinProfile>(`/api/finance/${hid}/profile`), enabled: !!hid, staleTime: 30_000 });
  const fmt = React.useMemo(() => makeFmt({ currency: profile?.currency ?? "CAD", numberLocale: profile?.numberLocale ?? "en-CA", dateFormat: profile?.dateFormat ?? "YYYY-MM-DD" }), [profile?.currency, profile?.numberLocale, profile?.dateFormat]);
  const value = React.useMemo<Ctx>(() => ({ hid, households: data?.households ?? [], setHid, loading: isLoading, profile, fmt, view, setView, canWrite: profile?.canWrite ?? false, isAdmin: profile?.myRole === "ADMIN" }), [hid, data, setHid, isLoading, profile, fmt, view, setView]);
  return <FinContext.Provider value={value}>{children}</FinContext.Provider>;
}

/** Query a household scoped endpoint. The cache key includes the household so switching households never shows stale data. */
export function useFinQuery<T = any>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}, opts: Partial<UseQueryOptions<T>> & { enabled?: boolean } = {}) {
  const { hid } = useFin();
  const { enabled, ...rest } = opts;
  return useQuery<T>({ queryKey: ["fin", hid, path, params], queryFn: () => api<T>(`/api/finance/${hid}${path}${qs(params)}`), enabled: !!hid && (enabled ?? true), staleTime: 15_000, ...(rest as object) } as never);
}

/** Mutation against a household endpoint. On success every household query is refreshed, so dashboards, balances and reports stay consistent. */
export function useFinMutation<B = any, R = any>(method: "POST" | "PATCH" | "PUT" | "DELETE", path: string | ((b: B) => string), o: { success?: string; onSuccess?: (r: R, b: B) => void } = {}) {
  const { hid } = useFin();
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation<R, Error, B>({
    mutationFn: (body: B) => api<R>(`/api/finance/${hid}${typeof path === "function" ? path(body) : path}`, { method, body: method === "DELETE" ? undefined : body }),
    onSuccess: (r, b) => {
      void qc.invalidateQueries({ queryKey: ["fin", hid] });
      if (o.success) toast({ title: o.success });
      o.onSuccess?.(r, b);
    },
    onError: (e) => toast({ title: "That did not work", description: e instanceof ApiError ? e.message : (e as Error).message, variant: "error" }),
  });
}
export async function finApi<T = any>(hid: string, path: string, init?: { method?: string; body?: unknown }) {
  return api<T>(`/api/finance/${hid}${path}`, init);
}
export function useInvalidateFin() {
  const qc = useQueryClient();
  const { hid } = useFin();
  return React.useCallback(() => qc.invalidateQueries({ queryKey: ["fin", hid] }), [qc, hid]);
}
