"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Bell, Building2, CalendarDays, Car, Check, ChevronDown, CloudOff, Coins, CreditCard, FileText, Gauge, Home, Landmark, LayoutDashboard, LineChart, LogOut, Menu, Moon, PiggyBank, Plus, Receipt, RefreshCw, Repeat, Search, Settings as SettingsIcon, Shield, ShieldCheck, Sparkles, SlidersHorizontal, Sun, Target, TrendingUp, Upload, UserCircle, Users, Wallet, Wrench, X, ArrowLeftRight, HandCoins, FileSpreadsheet, Hammer, Package, FolderOpen } from "lucide-react";
import { api } from "@/lib/client/api";
import { flushQueue, listQueue, removeQueued, type QueuedRequest } from "@/lib/client/offline";
import { cn } from "@/lib/client/utils";
import { Alert, Badge, Button, Input } from "@/components/ui/primitives";
import { Dropdown, MenuItem } from "@/components/ui/menu";
import { Modal } from "@/components/ui/dialog";
import { QuickAddProvider, QUICK_ACTIONS, useQuickAdd } from "@/components/forms/quick-dialogs";
import { FinProvider, useFin } from "@/components/finance/provider";
import { TxDialogProvider, useTxDialog } from "@/components/finance/transaction-form";
import { ViewSwitch } from "@/components/finance/ui";
import { useMe, VehicleProvider } from "./providers";

type NavItem = { href: string; label: string; icon: React.ElementType };
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }, { href: "/household", label: "Household", icon: Users }] },
  { title: "Money", items: [{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight }, { href: "/spending", label: "Expenses", icon: Receipt }, { href: "/income", label: "Income", icon: HandCoins }, { href: "/accounts", label: "Accounts", icon: Landmark }, { href: "/budgets", label: "Budgets", icon: Wallet }, { href: "/bills", label: "Bills", icon: FileText }, { href: "/calendar", label: "Calendar", icon: CalendarDays }] },
  { title: "Plan", items: [{ href: "/goals", label: "Savings and goals", icon: PiggyBank }, { href: "/debts", label: "Debt", icon: CreditCard }, { href: "/forecast", label: "Forecast", icon: TrendingUp }, { href: "/simulator", label: "What if", icon: SlidersHorizontal }, { href: "/planner", label: "Home planner", icon: Home }] },
  { title: "Wealth", items: [{ href: "/networth", label: "Net worth", icon: LineChart }, { href: "/investments", label: "Investments", icon: Coins }, { href: "/insurance", label: "Insurance", icon: Shield }, { href: "/subscriptions", label: "Subscriptions", icon: Repeat }, { href: "/tax", label: "Tax", icon: Building2 }] },
  { title: "Tools", items: [{ href: "/reports", label: "Reports", icon: BarChart3 }, { href: "/import", label: "Import and export", icon: Upload }, { href: "/finance-documents", label: "Receipts", icon: FileSpreadsheet }, { href: "/assistant", label: "Assistant", icon: Sparkles }] },
  { title: "Vehicles", items: [{ href: "/vehicle-dashboard", label: "Vehicle overview", icon: LayoutDashboard }, { href: "/vehicles", label: "My vehicles", icon: Car }, { href: "/maintenance", label: "Maintenance", icon: Wrench }, { href: "/service-history", label: "Service history", icon: Gauge }, { href: "/repairs", label: "Repairs", icon: Hammer }, { href: "/parts", label: "Parts", icon: Package }, { href: "/reminders", label: "Reminders", icon: Bell }, { href: "/documents", label: "Vehicle documents", icon: FolderOpen }, { href: "/vehicle-costs", label: "Running costs", icon: Receipt }, { href: "/expenses", label: "Vehicle expenses", icon: Receipt }] },
];
export const NAV = NAV_GROUPS.flatMap((g) => g.items);
const VEHICLE_GROUP = "Vehicles";
const VEHICLE_HREFS = NAV_GROUPS.filter((g) => g.title === VEHICLE_GROUP).flatMap((g) => g.items.map((i) => i.href));
const FINANCE_HREFS = NAV_GROUPS.filter((g) => g.title !== VEHICLE_GROUP).flatMap((g) => g.items.map((i) => i.href));
const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <QuickAddProvider>
        <FinProvider>
          <TxDialogProvider>
            <Shell>{children}</Shell>
          </TxDialogProvider>
        </FinProvider>
      </QuickAddProvider>
    </VehicleProvider>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/60 text-accent" aria-hidden>
        <Landmark className="h-[18px] w-[18px]" />
      </span>
      <span className="display whitespace-nowrap text-[17px] leading-none">Family Finance Hub</span>
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
  const [area, setArea] = React.useState<"finance" | "vehicles">(VEHICLE_HREFS.some((h) => isActive(path, h)) ? "vehicles" : "finance");
  React.useEffect(() => {
    // follow the page you are on; shared pages (settings, notifications, assistant) keep the current section
    if (VEHICLE_HREFS.some((h) => isActive(path, h))) setArea("vehicles");
    else if (FINANCE_HREFS.some((h) => isActive(path, h))) setArea("finance");
  }, [path]);
  const tx = useTxDialog();
  const onboarding = path.startsWith("/onboarding");
  if (onboarding) return <div className="min-h-dvh bg-background">{children}</div>;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex" aria-label="Primary">
        <div className="px-5 pb-4 pt-6 text-white"><Logo /></div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main navigation">
          <div role="group" aria-label="Section" className="mx-1 mb-3 grid grid-cols-2 gap-1 rounded-lg bg-white/5 p-1">
            {([["finance", "Finance", "/dashboard", LayoutDashboard], ["vehicles", "Vehicles", "/vehicle-dashboard", Car]] as const).map(([k, label, href, Icon]) => (
              <Link key={k} href={href} aria-current={area === k ? "true" : undefined} className={cn("flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors", area === k ? "bg-white text-sidebar" : "text-white/70 hover:bg-white/10 hover:text-white")}>
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </Link>
            ))}
          </div>
          {NAV_GROUPS.filter((g) => (g.title === VEHICLE_GROUP) === (area === "vehicles")).map((g) => (
            <div key={g.title} className="mb-3">
              <p className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">{g.title}</p>
              <div className="space-y-px">
                {g.items.map((n) => (
                  <Link key={n.href} href={n.href} aria-current={isActive(path, n.href) ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors hover:bg-white/10 hover:text-white", isActive(path, n.href) ? "bg-white/10 text-white shadow-[inset_2px_0_0_rgb(var(--accent))]" : "")}>
                    <n.icon className="h-4 w-4 opacity-80" aria-hidden />
                    {n.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          {me.platformRole === "PLATFORM_ADMIN" && (
            <Link href="/admin" aria-current={isActive(path, "/admin") ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium hover:bg-white/10 hover:text-white", isActive(path, "/admin") && "bg-white/10 text-white")}>
              <ShieldCheck className="h-4 w-4 opacity-80" aria-hidden /> Platform admin
            </Link>
          )}
        </nav>
        <div className="border-t border-white/10 p-4 text-xs leading-relaxed text-white/45">Figures are built from records your household enters. Private records stay private.</div>
      </aside>

      <div className="lg:pl-64">
        <TopBar onSearch={() => setSearchOpen(true)} />
        <OfflineBanner />
        {!me.emailVerified && <VerifyBanner />}
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 pb-28 pt-6 outline-none sm:px-6 lg:pb-12">
          {children}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur lg:hidden safe-bottom" aria-label="Mobile navigation">
        <ul className="mx-auto grid max-w-lg grid-cols-5 items-end px-2 pt-1.5">
          <BottomLink href="/dashboard" label="Home" icon={LayoutDashboard} active={isActive(path, "/dashboard")} />
          <BottomLink href="/transactions" label="Ledger" icon={ArrowLeftRight} active={isActive(path, "/transactions")} />
          <li className="flex justify-center">
            <button onClick={() => tx.open()} aria-label="Add a transaction" className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-pop">
              <Plus className="h-7 w-7" />
            </button>
          </li>
          <BottomLink href="/budgets" label="Budgets" icon={Wallet} active={isActive(path, "/budgets")} />
          <li>
            <button onClick={() => setMore(true)} className="flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium text-muted-foreground" aria-haspopup="dialog">
              <Menu className="h-5 w-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="Everything" size="sm">
        <div className="space-y-4">
          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{g.title}</p>
              <ul className="grid grid-cols-2 gap-2">
                {g.items.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} className={cn("flex min-h-[48px] items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted", isActive(path, n.href) && "border-primary text-primary")}>
                      <n.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <Link href="/settings" className="flex min-h-[48px] items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"><SettingsIcon className="h-4 w-4" /> Settings</Link>
            <Button variant="outline" className="h-auto min-h-[48px]" onClick={signOut}><LogOut className="h-4 w-4" /> Sign out</Button>
          </div>
        </div>
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

function HouseholdSwitcher() {
  const { households, hid, setHid, profile } = useFin();
  const current = households.find((h) => h.id === hid);
  if (!current) return null;
  return (
    <Dropdown align="left" label="Choose household" trigger={(p) => (
      <Button variant="outline" size="sm" {...p} aria-label={`Household: ${current.name}`}>
        <Users className="h-4 w-4" aria-hidden />
        <span className="max-w-[10rem] truncate">{current.name}</span>
        {current.isDemo && <Badge tone="warning">Demo</Badge>}
        {households.length > 1 && <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />}
      </Button>
    )}>
      {(close) => (
        <>
          {households.map((h) => (
            <MenuItem key={h.id} onClick={() => { setHid(h.id); close(); }} icon={h.id === hid ? <Check className="h-4 w-4" /> : <span className="w-4" />}>{h.name}{h.isDemo ? " (demo)" : ""}</MenuItem>
          ))}
          <div className="my-1 border-t border-border" />
          <MenuItem href="/onboarding?new=1" onClick={close} icon={<Plus className="h-4 w-4" />}>New household</MenuItem>
        </>
      )}
    </Dropdown>
  );
}

function TopBar({ onSearch }: { onSearch: () => void }) {
  const me = useMe();
  const tx = useTxDialog();
  const quick = useQuickAdd();
  const { canWrite, profile } = useFin();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur safe-top">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Logo className="lg:hidden [&_span.display]:hidden sm:[&_span.display]:inline" />
        <div className="hidden items-center gap-3 lg:flex"><HouseholdSwitcher /><ViewSwitch /></div>
        <div className="ml-auto flex items-center gap-1">
          <div className="lg:hidden"><ViewSwitch className="text-xs [&_button]:px-2" /></div>
          <Button variant="ghost" size="icon" onClick={onSearch} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)"><Search className="h-5 w-5" /></Button>
          {canWrite && <div className="hidden sm:block"><Dropdown label="Add" trigger={(p) => <Button size="sm" {...p}><Plus className="h-4 w-4" aria-hidden /> Add <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden /></Button>}>
            <MenuItem onClick={() => tx.open()} icon={<Plus className="h-4 w-4" />}>Transaction</MenuItem>
            {QUICK_ACTIONS.map((a) => a.href ? <MenuItem key={a.key} href={a.href} icon={<a.icon className="h-4 w-4" />}>{a.label}</MenuItem> : <MenuItem key={a.key} onClick={() => quick.open(a.kind!)} icon={<a.icon className="h-4 w-4" />}>{a.label}</MenuItem>)}
          </Dropdown></div>}
          <NotificationsBell />
          <ThemeToggle />
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
                  {profile && <p className="mt-0.5 text-xs text-muted-foreground">{profile.myRole === "ADMIN" ? "Household administrator" : profile.myRole === "READ_ONLY" ? "Read-only member" : "Household member"}</p>}
                </div>
                <div className="my-1 border-t border-border" />
                <MenuItem href="/household" icon={<Users className="h-4 w-4" />} onClick={close}>Household and sharing</MenuItem>
                <MenuItem href="/settings" icon={<SettingsIcon className="h-4 w-4" />} onClick={close}>Settings</MenuItem>
                <MenuItem icon={<LogOut className="h-4 w-4" />} onClick={signOut}>Sign out</MenuItem>
              </>
            )}
          </Dropdown>
        </div>
      </div>
    </header>
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
            <MenuItem href="/notifications" onClick={close}>View all notifications</MenuItem>
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
            {!online ? "You're offline - showing saved data; new entries are kept as drafts and will sync automatically." : `${pending} change(s) waiting to sync${failed ? `, ${failed} need attention` : ""}.`}
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

// ───────── Global search (command palette): jump to a page or find a transaction
function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [idx, setIdx] = React.useState(0);
  const router = useRouter();
  const { hid, fmt } = useFin();
  React.useEffect(() => { const t = setTimeout(() => setDebounced(q), 220); return () => clearTimeout(t); }, [q]);
  React.useEffect(() => { if (open) { setQ(""); setDebounced(""); } }, [open]);
  const { data } = useQuery({ queryKey: ["fin", hid, "search", debounced], queryFn: () => api<any>(`/api/finance/${hid}/transactions?q=${encodeURIComponent(debounced)}&pageSize=8`), enabled: open && !!hid && debounced.trim().length >= 2 });
  const { data: veh } = useQuery({ queryKey: ["vehicle-search", debounced], queryFn: () => api<{ groups: { label: string; items: { id: string; title: string; subtitle: string; href: string }[] }[] }>(`/api/search?q=${encodeURIComponent(debounced)}`), enabled: open && debounced.trim().length >= 2 });
  const pages = debounced.trim() ? NAV.filter((n) => n.label.toLowerCase().includes(debounced.trim().toLowerCase())) : NAV.slice(0, 8);
  const txs: { id: string; title: string; subtitle: string; href: string }[] = (data?.items ?? []).map((t: any) => ({ id: t.id, title: t.description, subtitle: `${fmt.date(t.date)} · ${fmt.money(t.amount)} · ${t.accountName}`, href: `/transactions?focus=${t.id}` }));
  const vehicleHits = (veh?.groups ?? []).flatMap((g) => g.items.map((i) => ({ id: `${g.label}-${i.id}`, title: i.title, subtitle: `${g.label} · ${i.subtitle}`, href: i.href })));
  const flat = [...pages.map((p) => ({ id: p.href, title: p.label, subtitle: "Go to page", href: p.href })), ...txs, ...vehicleHits];
  React.useEffect(() => setIdx(0), [debounced, data, veh]);
  const go = (href: string) => { onClose(); router.push(href); };
  return (
    <Modal open={open} onClose={onClose} title="Search" description="Jump to a page, or find a transaction, vehicle, service or document" size="md">
      <div role="search" onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(flat.length - 1, i + 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
        if (e.key === "Enter" && flat[idx]) go(flat[idx].href);
      }}>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, for example groceries or budgets" aria-label="Search query" type="search" />
        <ul className="mt-3 max-h-80 overflow-y-auto" aria-live="polite">
          {flat.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">No results for {debounced}.</li> : flat.map((it, i) => (
            <li key={`${it.id}-${i}`}>
              <button className={cn("flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted", idx === i && "bg-muted")} onClick={() => go(it.href)} onMouseEnter={() => setIdx(i)}>
                <span className="text-sm font-medium">{it.title}</span>
                <span className="text-xs text-muted-foreground">{it.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
