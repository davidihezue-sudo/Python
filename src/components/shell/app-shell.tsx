"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Bell, Car, ChevronDown, CloudOff, FileText, History, LayoutDashboard, LogOut, Menu, Moon, Package, Plus, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, Sun, UserCircle, Wallet, Wrench, X, Check, RefreshCw } from "lucide-react";
import { api } from "@/lib/client/api";
import { flushQueue, listQueue, removeQueued, type QueuedRequest } from "@/lib/client/offline";
import { cn } from "@/lib/client/utils";
import { Alert, Badge, Button, Input } from "@/components/ui/primitives";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/dialog";
import { QUICK_ACTIONS, QuickAddProvider, useQuickAdd } from "@/components/forms/quick-dialogs";
import { useMe, useSelectedVehicle, useVehicles, VehicleProvider } from "./providers";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vehicles", label: "My Vehicles", icon: Car },
  { href: "/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/service-history", label: "Service History", icon: History },
  { href: "/repairs", label: "Repairs & Issues", icon: AlertTriangle },
  { href: "/parts", label: "Parts Inventory", icon: Package },
  { href: "/expenses", label: "Expenses", icon: Wallet },
  { href: "/reminders", label: "Reminders", icon: Bell },
  { href: "/reports", label: "Reports & Analytics", icon: BarChart3 },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <QuickAddProvider>
        <Shell>{children}</Shell>
      </QuickAddProvider>
    </VehicleProvider>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Car className="h-5 w-5" aria-hidden />
      </span>
      AutoVault
    </span>
  );
}

async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* proceed anyway */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "LOGOUT" });
    localStorage.removeItem("av:vehicle");
  } catch {
    /* ignore */
  }
  window.location.href = "/login";
}

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const me = useMe();
  const [more, setMore] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => setMore(false), [path]);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex" aria-label="Primary">
        <div className="px-5 py-5 text-white">
          <Logo />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white", isActive(path, n.href) && "bg-white/10 text-white")}>
              <n.icon className="h-[18px] w-[18px]" aria-hidden />
              {n.label}
            </Link>
          ))}
          <div className="my-3 border-t border-white/10" />
          <Link href="/assistant" aria-current={isActive(path, "/assistant") ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white", isActive(path, "/assistant") && "bg-white/10 text-white")}>
            <Sparkles className="h-[18px] w-[18px]" aria-hidden /> AI Assistant
          </Link>
          {me.platformRole === "PLATFORM_ADMIN" && (
            <Link href="/admin" aria-current={isActive(path, "/admin") ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-white/10 hover:text-white", isActive(path, "/admin") && "bg-white/10 text-white")}>
              <ShieldCheck className="h-[18px] w-[18px]" aria-hidden /> Platform admin
            </Link>
          )}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs text-white/50">Vehicle records stay private to your household.</div>
      </aside>

      <div className="lg:pl-64">
        <TopBar onSearch={() => setSearchOpen(true)} />
        <OfflineBanner />
        {!me.emailVerified && <VerifyBanner />}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pb-28 pt-5 outline-none sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden safe-bottom" aria-label="Mobile navigation">
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-1.5">
          <BottomLink href="/dashboard" label="Home" icon={LayoutDashboard} active={isActive(path, "/dashboard")} />
          <BottomLink href="/vehicles" label="Vehicles" icon={Car} active={isActive(path, "/vehicles")} />
          <li className="flex justify-center">
            <Dropdown label="Quick add" sheet trigger={(p) => (
              <button {...p} aria-label="Quick add" className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop">
                <Plus className="h-7 w-7" />
              </button>
            )}>
              {(close) => <QuickMenu onPick={close} />}
            </Dropdown>
          </li>
          <BottomLink href="/maintenance" label="Maintenance" icon={Wrench} active={isActive(path, "/maintenance")} />
          <li>
            <button onClick={() => setMore(true)} className="flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium text-muted-foreground" aria-haspopup="dialog">
              <Menu className="h-5 w-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More" size="sm">
        <ul className="grid grid-cols-2 gap-2">
          {[...NAV.slice(2), { href: "/assistant", label: "AI Assistant", icon: Sparkles }].map((n) => (
            <li key={n.href}>
              <Link href={n.href} className={cn("flex min-h-[52px] items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted", isActive(path, n.href) && "border-primary text-primary")}>
                <n.icon className="h-5 w-5 shrink-0" aria-hidden />
                {n.label}
              </Link>
            </li>
          ))}
          {me.platformRole === "PLATFORM_ADMIN" && (
            <li>
              <Link href="/admin" className="flex min-h-[52px] items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><ShieldCheck className="h-5 w-5" /> Admin</Link>
            </li>
          )}
          <li className="col-span-2">
            <Button variant="outline" className="w-full" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
          </li>
        </ul>
      </Modal>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ElementType; active: boolean }) {
  return (
    <li>
      <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
        <Icon className="h-5 w-5" aria-hidden />
        {label}
      </Link>
    </li>
  );
}

function QuickMenu({ onPick }: { onPick: () => void }) {
  const { open } = useQuickAdd();
  const router = useRouter();
  return (
    <div>
      {QUICK_ACTIONS.map((a) => (
        <MenuItem
          key={a.key}
          icon={<a.icon className="h-4 w-4 text-muted-foreground" />}
          onClick={() => {
            onPick();
            if (a.href) router.push(a.href);
            else if (a.kind) open(a.kind);
          }}
        >
          {a.label}
        </MenuItem>
      ))}
    </div>
  );
}

function TopBar({ onSearch }: { onSearch: () => void }) {
  const me = useMe();
  const { vehicleId, setVehicleId } = useSelectedVehicle();
  const { data: vehicles } = useVehicles();
  const current = vehicles?.find((v) => v.id === vehicleId);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur safe-top">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Logo className="lg:hidden" />
        <div className="hidden lg:block">
          <Dropdown align="left" label="Choose vehicle" trigger={(p) => (
            <Button variant="outline" size="sm" {...p} aria-label={`Selected vehicle: ${current?.nickname ?? "All vehicles"}`}>
              <Car className="h-4 w-4" aria-hidden />
              <span className="max-w-[12rem] truncate">{current?.nickname ?? "All vehicles"}</span>
              <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
            </Button>
          )}>
            {(close) => (
              <>
                <MenuItem onClick={() => { setVehicleId("all"); close(); }} icon={vehicleId === "all" ? <Check className="h-4 w-4" /> : <span className="w-4" />}>All vehicles (household)</MenuItem>
                {vehicles?.map((v) => (
                  <MenuItem key={v.id} onClick={() => { setVehicleId(v.id); close(); }} icon={vehicleId === v.id ? <Check className="h-4 w-4" /> : <span className="w-4" />}>
                    {v.nickname}
                  </MenuItem>
                ))}
                {!vehicles?.length && <p className="px-3 py-2 text-sm text-muted-foreground">No vehicles yet</p>}
              </>
            )}
          </Dropdown>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <div className="lg:hidden">
            <VehicleSwitcherMobile />
          </div>
          <Button variant="ghost" size="icon" onClick={onSearch} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)">
            <Search className="h-5 w-5" />
          </Button>
          <div className="hidden sm:block">
            <Dropdown label="Quick add" trigger={(p) => (
              <Button {...p} size="sm"><Plus className="h-4 w-4" aria-hidden /> Quick add</Button>
            )}>
              {(close) => <QuickMenu onPick={close} />}
            </Dropdown>
          </div>
          <NotificationsBell />
          <div className="max-sm:hidden"><ThemeToggle /></div>
          <Dropdown label="Account" trigger={(p) => (
            <Button {...p} variant="ghost" size="icon" aria-label="Account menu">
              {me.imageUrl ? <img src={me.imageUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : <UserCircle className="h-6 w-6" />}
            </Button>
          )}>
            {(close) => (
              <>
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium">{me.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{me.email}</p>
                </div>
                <div className="my-1 border-t border-border" />
                <MenuItem href="/settings" icon={<SettingsIcon className="h-4 w-4" />} onClick={close}>Settings</MenuItem>
                <MenuItem href="/assistant" icon={<Sparkles className="h-4 w-4" />} onClick={close}>AI Assistant</MenuItem>
                <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={signOut}>Sign out</MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      </div>
    </header>
  );
}

function VehicleSwitcherMobile() {
  const { vehicleId, setVehicleId } = useSelectedVehicle();
  const { data: vehicles } = useVehicles();
  if (!vehicles || vehicles.length < 2) return null;
  return (
    <select aria-label="Selected vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className="h-10 max-w-[5.5rem] truncate rounded-md border border-input bg-card px-2 text-sm">
      <option value="all">All vehicles</option>
      {vehicles.map((v) => (
        <option key={v.id} value={v.id}>{v.nickname}</option>
      ))}
    </select>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = React.useState<string>("system");
  React.useEffect(() => {
    setTheme(document.documentElement.dataset.theme || "system");
  }, []);
  const qc = useQueryClient();
  const set = (t: string) => {
    setTheme(t);
    document.documentElement.dataset.theme = t === "system" ? "" : t;
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    document.cookie = `av_theme=${t}; path=/; max-age=31536000; samesite=lax`;
    void api("/api/users/me/preferences", { method: "PATCH", body: { theme: t } }).then(() => qc.invalidateQueries({ queryKey: ["me"] })).catch(() => undefined);
  };
  const dark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return (
    <Dropdown label="Theme" trigger={(p) => (
      <Button {...p} variant="ghost" size="icon" aria-label="Change theme">
        {dark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
      </Button>
    )}>
      {(close) => (
        <>
          {[["light", "Light"], ["dark", "Dark"], ["system", "Match system"]].map(([k, l]) => (
            <MenuItem key={k} onClick={() => { set(k); close(); }} icon={theme === k ? <Check className="h-4 w-4" /> : <span className="w-4" />}>{l}</MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({ queryKey: ["notifications", "bell"], queryFn: () => api<any>("/api/notifications?pageSize=8"), refetchInterval: 60_000 });
  const unread = data?.unread ?? 0;
  return (
    <Dropdown label="Notifications" trigger={(p) => (
      <Button {...p} variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </Button>
    )}>
      {(close) => (
        <div className="w-[min(22rem,calc(100vw-2rem))]">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <button className="text-xs text-primary hover:underline" onClick={async () => { await api("/api/notifications", { method: "PATCH", body: { all: true, action: "read" } }); void qc.invalidateQueries({ queryKey: ["notifications"] }); }}>Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {data?.items?.length ? (
              data.items.map((n: any) => (
                <button key={n.id} role="menuitem" className={cn("flex w-full items-start gap-2 rounded-md px-3 py-2 text-left hover:bg-muted", !n.read && "bg-primary/5")} onClick={async () => { close(); void api("/api/notifications", { method: "PATCH", body: { ids: [n.id], action: "actioned" } }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] })); if (n.actionUrl) router.push(n.actionUrl); }}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.severity === "CRITICAL" ? "bg-danger" : n.severity === "WARNING" ? "bg-warning" : "bg-info")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{n.title}</span>
                    <span className="block text-xs text-muted-foreground">{n.body}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
            )}
          </div>
          <div className="border-t border-border p-1">
            <MenuItem href="/reminders#notifications" onClick={close}>View all notifications</MenuItem>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

function OfflineBanner() {
  const [online, setOnline] = React.useState(true);
  const [queue, setQueue] = React.useState<QueuedRequest[]>([]);
  const [panel, setPanel] = React.useState(false);
  const refresh = React.useCallback(() => void listQueue().then(setQueue), []);
  React.useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("av:queue-changed", refresh);
    window.addEventListener("av:synced", refresh);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("av:queue-changed", refresh);
      window.removeEventListener("av:synced", refresh);
    };
  }, [refresh]);
  if (online && queue.length === 0) return null;
  const pending = queue.filter((q) => q.status === "pending").length;
  const failed = queue.filter((q) => q.status === "failed").length;
  return (
    <>
      <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm" role="status">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 sm:px-6">
          {!online ? <CloudOff className="h-4 w-4 text-warning" aria-hidden /> : <RefreshCw className="h-4 w-4 text-warning" aria-hidden />}
          <span>
            {!online ? "You're offline — showing saved data; new entries are kept as drafts and will sync automatically." : `${pending} change(s) waiting to sync${failed ? `, ${failed} need attention` : ""}.`}
          </span>
          {queue.length > 0 && <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setPanel(true)}>Review {queue.length} draft{queue.length === 1 ? "" : "s"}</button>}
        </div>
      </div>
      <Modal open={panel} onClose={() => setPanel(false)} title="Offline drafts" description="Entries saved on this device that haven't reached your account yet." footer={<><Button variant="outline" onClick={() => setPanel(false)}>Close</Button><Button onClick={async () => { await flushQueue(); refresh(); }} disabled={!online}>Sync now</Button></>}>
        <ul className="divide-y divide-border">
          {queue.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-3 py-2.5">
              <div>
                <p className="text-sm font-medium">{q.label}</p>
                <p className="text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleString()}</p>
                {q.status === "failed" && <p className="mt-1 text-xs text-danger">Couldn't be saved: {q.error}</p>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={q.status === "failed" ? "danger" : "warning"}>{q.status === "failed" ? "Failed" : "Pending"}</Badge>
                <Button size="sm" variant="ghost" aria-label={`Discard ${q.label}`} onClick={async () => { await removeQueued(q.id); refresh(); }}><X className="h-4 w-4" /></Button>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function VerifyBanner() {
  const me = useMe();
  const [sent, setSent] = React.useState(false);
  return (
    <div className="border-b border-info/30 bg-info/10 px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 sm:px-6">
        <span>Please verify your email address ({me.email}) to enable sharing and invitations.</span>
        <button className="font-medium text-primary hover:underline disabled:opacity-60" disabled={sent} onClick={async () => { await api("/api/auth/resend-verification", { method: "POST", body: { email: me.email } }).catch(() => undefined); setSent(true); }}>{sent ? "Verification email sent" : "Resend verification email"}</button>
      </div>
    </div>
  );
}

// ───────── Global search (command palette)
function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const router = useRouter();
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    if (open) {
      setQ("");
      setDebounced("");
    }
  }, [open]);
  const { data, isFetching } = useQuery({ queryKey: ["search", debounced], queryFn: () => api<{ groups: { label: string; items: { id: string; title: string; subtitle: string; href: string }[] }[] }>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: open && debounced.trim().length >= 2 });
  const flat = (data?.groups ?? []).flatMap((g) => g.items);
  React.useEffect(() => setIdx(0), [data]);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Modal open={open} onClose={onClose} title="Search" description="Vehicles, services, repairs, parts, receipts and documents" size="md">
      <div role="search" onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
        if (e.key === "Enter" && flat[idx]) go(flat[idx].href);
      }}>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. brake pads, VIN, receipt…" aria-label="Search query" type="search" />
        <div className="mt-3 min-h-[8rem]" aria-live="polite">
          {debounced.trim().length < 2 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Type at least 2 characters.</p>
          ) : isFetching && !data ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
          ) : flat.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No results for “{debounced}”.</p>
          ) : (
            (() => {
              let n = -1;
              return data!.groups.map((g) => (
                <div key={g.label} className="mb-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                  <ul>
                    {g.items.map((it) => {
                      n++;
                      const mine = n;
                      return (
                        <li key={it.id}>
                          <button className={cn("flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted", idx === mine && "bg-muted")} onClick={() => go(it.href)} onMouseEnter={() => setIdx(mine)}>
                            <span className="text-sm font-medium">{it.title}</span>
                            <span className="text-xs text-muted-foreground">{it.subtitle}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ));
            })()
          )}
        </div>
      </div>
    </Modal>
  );
}
