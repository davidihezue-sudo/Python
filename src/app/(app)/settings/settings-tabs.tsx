"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Copy, Download, Trash2, UserCircle } from "lucide-react";
import { api } from "@/lib/client/api";
import { changePasswordSchema, householdSchema, inviteSchema } from "@/lib/validation";
import { flushQueue, listQueue, offlineCapabilities } from "@/lib/client/offline";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Skeleton, Switch } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { applyApiErrors, useZodForm } from "@/components/forms";
import { label } from "@/components/forms/common";
import { useMe, useVehicles } from "@/components/shell/providers";
import { titleCase } from "@/lib/client/utils";

export function SettingsTabs({ tab }: { tab: string }) {
  return (
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
      {tab === "profile" && <Profile />}
      {tab === "preferences" && <Preferences />}
      {tab === "notifications" && <Notifications />}
      {tab === "household" && <Household />}
      {tab === "integrations" && <Integrations />}
      {tab === "privacy" && <Privacy />}
      {tab === "app" && <AppTab />}
    </div>
  );
}

function usePrefsSave() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return async (patch: Record<string, unknown>, msg = "Saved") => {
    try {
      await api("/api/users/me/preferences", { method: "PATCH", body: patch });
      await qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries();
      toast({ title: msg });
    } catch (e) {
      toast({ title: "Couldn't save", description: (e as Error).message, variant: "error" });
    }
  };
}

function Profile() {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = React.useState(me.name);
  const photo = React.useRef<HTMLInputElement>(null);
  const form = useZodForm(changePasswordSchema, { currentPassword: "", newPassword: "" });
  const [err, setErr] = React.useState("");
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Profile" /><CardBody className="space-y-4">
        <div className="flex items-center gap-4">
          {me.imageUrl ? <img src={me.imageUrl} alt="Profile photo" className="h-16 w-16 rounded-full object-cover" /> : <UserCircle className="h-16 w-16 text-muted-foreground" aria-hidden />}
          <div><Button variant="outline" size="sm" onClick={() => photo.current?.click()}><Camera className="h-4 w-4" /> Change photo</Button><input ref={photo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.set("file", file); try { await api("/api/users/me/photo", { method: "POST", body: fd }); toast({ title: "Photo updated" }); void qc.invalidateQueries({ queryKey: ["me"] }); } catch (x) { toast({ title: "Upload failed", description: (x as Error).message, variant: "error" }); } }} /></div>
        </div>
        <Field label="Name">{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" hint={me.emailVerified ? "Verified" : "Not verified"}>{(p) => <Input {...p} value={me.email} disabled />}</Field>
        <Button onClick={async () => { await api("/api/users/me", { method: "PATCH", body: { name } }); toast({ title: "Profile saved" }); void qc.invalidateQueries({ queryKey: ["me"] }); }}>Save profile</Button>
      </CardBody></Card>
      <Card><CardHeader title="Password" description={me.hasPassword ? "Changing your password signs out your other devices." : "Your account signs in with Google. Use “Forgot password” on the sign-in page to add a password."} /><CardBody>
        {me.hasPassword && (
          <form onSubmit={form.handleSubmit(async (v) => { setErr(""); try { await api("/api/auth/change-password", { method: "POST", body: v }); toast({ title: "Password changed" }); form.reset(); } catch (e) { setErr(applyApiErrors(form, e)); } })} className="space-y-3" noValidate>
            {err && <Alert tone="danger">{err}</Alert>}
            <Field label="Current password" error={form.formState.errors.currentPassword?.message as string}>{(p) => <Input type="password" autoComplete="current-password" {...p} {...form.register("currentPassword")} />}</Field>
            <Field label="New password" error={form.formState.errors.newPassword?.message as string} hint="At least 10 characters, with letters and a number or symbol.">{(p) => <Input type="password" autoComplete="new-password" {...p} {...form.register("newPassword")} />}</Field>
            <Button type="submit" loading={form.formState.isSubmitting}>Change password</Button>
          </form>
        )}
        {me.linkedProviders.length > 0 && <p className="mt-3 text-sm text-muted-foreground">Linked sign-in: {me.linkedProviders.map(titleCase).join(", ")}</p>}
      </CardBody></Card>
    </div>
  );
}

const CURRENCIES = ["CAD", "USD", "EUR", "GBP", "AUD", "NZD", "MXN", "JPY", "CHF", "SEK", "NOK", "DKK", "INR", "ZAR", "BRL"];
function Preferences() {
  const me = useMe();
  const p = me.preferences;
  const save = usePrefsSave();
  const [tz, setTz] = React.useState(p.timezone);
  const tzList = React.useMemo(() => { try { return (Intl as any).supportedValuesOf("timeZone") as string[]; } catch { return [p.timezone]; } }, [p.timezone]);
  const th = p.thresholds;
  const [t, setT] = React.useState({ upcomingKm: th.upcomingKm, upcomingDays: th.upcomingDays, dueSoonKm: th.dueSoonKm, dueSoonDays: th.dueSoonDays, graceKm: th.graceKm, graceDays: th.graceDays });
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Units, currency & time zone" description="Odometer values are stored in kilometres and converted for display - never silently mixed." /><CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Distance">{(x) => <Select {...x} value={p.distanceUnit} onChange={(e) => save({ distanceUnit: e.target.value })}><option value="KM">Kilometres</option><option value="MI">Miles</option></Select>}</Field>
        <Field label="Fuel volume">{(x) => <Select {...x} value={p.volumeUnit} onChange={(e) => save({ volumeUnit: e.target.value })}><option value="L">Litres</option><option value="GAL_US">US gallons</option><option value="GAL_UK">UK gallons</option></Select>}</Field>
        <Field label="Fuel economy">{(x) => <Select {...x} value={p.fuelEconomyUnit} onChange={(e) => save({ fuelEconomyUnit: e.target.value })}><option value="L_PER_100KM">L/100 km</option><option value="KM_PER_L">km/L</option><option value="MPG_US">MPG (US)</option><option value="MPG_UK">MPG (UK)</option></Select>}</Field>
        <Field label="Currency">{(x) => <Select {...x} value={p.currency} onChange={(e) => save({ currency: e.target.value })}>{[...new Set([p.currency, ...CURRENCIES])].map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Time zone" className="sm:col-span-2">{(x) => <Select {...x} value={tz} onChange={(e) => { setTz(e.target.value); void save({ timezone: e.target.value }); }}>{tzList.map((z) => <option key={z}>{z}</option>)}</Select>}</Field>
        <Field label="Theme">{(x) => <Select {...x} value={p.theme} onChange={(e) => { document.cookie = `av_theme=${e.target.value}; path=/; max-age=31536000; samesite=lax`; if (e.target.value === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = e.target.value; void save({ theme: e.target.value }); }}><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></Select>}</Field>
      </CardBody></Card>
      <Card><CardHeader title="Maintenance status thresholds" description={`When does an item become “upcoming”, “due soon” or overdue? Distances in ${p.distanceUnit === "MI" ? "miles" : "kilometres"} are stored as kilometres.`} /><CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["upcomingKm", "Upcoming within (km)"], ["upcomingDays", "Upcoming within (days)"], ["dueSoonKm", "Due soon within (km)"], ["dueSoonDays", "Due soon within (days)"], ["graceKm", "Overdue only after (km grace)"], ["graceDays", "Overdue only after (days grace)"]] as const).map(([k, l]) => <Field key={k} label={l}>{(x) => <Input type="number" min={0} {...x} value={t[k]} onChange={(e) => setT({ ...t, [k]: Number(e.target.value) })} />}</Field>)}
        </div>
        <Button onClick={() => save(t, "Thresholds saved - statuses recalculate")}>Save thresholds</Button>
      </CardBody></Card>
    </div>
  );
}

function Notifications() {
  const me = useMe();
  const p = me.preferences;
  const save = usePrefsSave();
  const { toast } = useToast();
  const [km, setKm] = React.useState((p.alertKmBefore as number[]).join(", "));
  const [days, setDays] = React.useState((p.alertDaysBefore as number[]).join(", "));
  const caps = React.useMemo(() => offlineCapabilities(), []);
  const parse = (s: string) => s.split(",").map((x) => parseInt(x.trim())).filter((x) => !isNaN(x) && x >= 0);
  const { data: push } = useQuery({ queryKey: ["push-config"], queryFn: () => api<{ serverSupport: boolean; vapidPublicKey: string | null }>("/api/notifications/push-config") });
  const enablePush = async () => {
    try {
      if (!caps.push || !caps.serviceWorker) throw new Error("This browser doesn't support web push. (On iPhone, install Family Finance Hub to the Home Screen first - iOS 16.4 or later.)");
      if (!push?.serverSupport || !push.vapidPublicKey) throw new Error("Web push isn't configured on this server (VAPID keys missing).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notification permission was not granted.");
      const reg = await navigator.serviceWorker.ready;
      const b64 = push.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/");
      const key = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api("/api/notifications/push-subscription", { method: "POST", body: sub.toJSON() });
      await save({ notifyPush: true }, "Push notifications enabled");
    } catch (e) {
      toast({ title: "Couldn't enable push", description: (e as Error).message, variant: "error" });
    }
  };
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Channels" /><CardBody className="space-y-4">
        <Switch label="In-app notifications" description="Shown in the bell menu and the Reminders page." checked={p.notifyInApp} onChange={(v) => save({ notifyInApp: v })} />
        <Switch label="Email" description="Sent to your verified address by the background job." checked={p.notifyEmail} onChange={(v) => save({ notifyEmail: v })} />
        <div>
          <Switch label="Web push" description="Delivered even when the app is closed, where your browser supports it." checked={p.notifyPush} onChange={(v) => (v ? enablePush() : save({ notifyPush: false }))} />
          <p className="mt-1 text-xs text-muted-foreground">Detected: service worker {caps.serviceWorker ? "✓" : "✗"} · push API {caps.push ? "✓" : "✗"} · server keys {push?.serverSupport ? "✓" : "✗ (not configured)"}. Push is optional; in-app and email always work.</p>
        </div>
      </CardBody></Card>
      <Card><CardHeader title="Maintenance reminder timing" description="For example: remind me 1,000 km and 500 km before an oil service is due, on the due date, and when overdue. Individual schedules can override this." /><CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Notify when this much distance remains" hint="Comma-separated, in kilometres (e.g. 1000, 500)">{(x) => <Input {...x} value={km} onChange={(e) => setKm(e.target.value)} />}</Field>
          <Field label="Notify when this many days remain" hint="Comma-separated (e.g. 30, 7)">{(x) => <Input {...x} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>
        </div>
        <Switch label="Notify when due" checked={p.alertOnDue} onChange={(v) => save({ alertOnDue: v })} />
        <Switch label="Notify when overdue" checked={p.alertOnOverdue} onChange={(v) => save({ alertOnOverdue: v })} />
        <Button onClick={() => save({ alertKmBefore: parse(km), alertDaysBefore: parse(days) }, "Reminder timing saved")}>Save timing</Button>
        <p className="text-xs text-muted-foreground">Each stage notifies once per due cycle - you are never sent duplicates, and a completed service re-arms the next cycle. Also covered: warranty expiry, registration, insurance, inspections, outstanding repairs and budget thresholds.</p>
      </CardBody></Card>
    </div>
  );
}

function Household() {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: hhs, isLoading } = useQuery({ queryKey: ["households"], queryFn: () => api<any[]>("/api/households") });
  const { data: vehicles } = useVehicles();
  const [inviting, setInviting] = React.useState<any>(null);
  const [link, setLink] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState("");
  if (isLoading) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      {hhs?.map((h) => (
        <Card key={h.id}>
          <CardHeader title={h.name} description={`You are ${h.myRole === "ADMIN" ? "an administrator" : "a member"} · ${h.vehicles.length} vehicle${h.vehicles.length === 1 ? "" : "s"}`} action={h.entitlements && <Badge tone="primary">{h.entitlements.label} plan{h.entitlements.enforced ? "" : " (all features unlocked)"}</Badge>} />
          <CardBody className="space-y-4">
            {h.myRole === "ADMIN" && <RenameHousehold h={h} />}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Members</h3>
              <ul className="divide-y divide-border">{h.members.map((m: any) => (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1"><p className="text-sm font-medium">{m.name}{m.userId === me.id && " (you)"}</p><p className="text-xs text-muted-foreground">{m.email ?? ""}{m.vehicleAccess.length ? ` · ${m.vehicleAccess.map((a: any) => `${vehicles?.find((v) => v.id === a.vehicleId)?.nickname ?? "vehicle"}: ${titleCase(a.level)}`).join(", ")}` : m.role === "ADMIN" ? " · full access" : " · no vehicles shared yet"}</p></div>
                  {h.myRole === "ADMIN" ? <Select aria-label={`Role for ${m.name}`} className="h-9 w-auto" value={m.role} onChange={async (e) => { try { await api(`/api/households/${h.id}/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }); toast({ title: "Role updated" }); void qc.invalidateQueries(); } catch (x) { toast({ title: "Couldn't change role", description: (x as Error).message, variant: "error" }); } }}><option value="ADMIN">Administrator</option><option value="MEMBER">Member</option></Select> : <Badge>{titleCase(m.role)}</Badge>}
                  {(h.myRole === "ADMIN" || m.userId === me.id) && <Button size="sm" variant="ghost" onClick={async () => { try { await api(`/api/households/${h.id}/members/${m.userId}`, { method: "DELETE" }); toast({ title: m.userId === me.id ? "You left the household" : "Member removed" }); void qc.invalidateQueries(); } catch (x) { toast({ title: "Couldn't remove", description: (x as Error).message, variant: "error" }); } }}>{m.userId === me.id ? "Leave" : "Remove"}</Button>}
                </li>
              ))}</ul>
            </div>
            {h.myRole === "ADMIN" && (
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Pending invitations</h3><Button size="sm" onClick={() => setInviting(h)}>Invite a family member</Button></div>
                {h.invites.length === 0 ? <p className="text-sm text-muted-foreground">No pending invitations.</p> : <ul className="divide-y divide-border">{h.invites.map((i: any) => <li key={i.id} className="flex items-center justify-between py-2 text-sm"><span>{i.email} · {titleCase(i.role)}</span><Button size="sm" variant="ghost" onClick={async () => { await api(`/api/invites/${i.id}`, { method: "DELETE" }); void qc.invalidateQueries(); }}>Revoke</Button></li>)}</ul>}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
      <Card><CardHeader title="Create another household" description="For example a separate business or fleet. Each household has its own vehicles, members and plan." /><CardBody className="flex gap-2"><Input aria-label="New household name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Household name" /><Button disabled={!newName.trim()} onClick={async () => { await api("/api/households", { method: "POST", body: { name: newName } }); setNewName(""); toast({ title: "Household created" }); void qc.invalidateQueries(); }}>Create</Button></CardBody></Card>
      {inviting && <InviteDialog h={inviting} vehicles={(vehicles ?? []).filter((v) => v.householdId === inviting.id)} onClose={() => setInviting(null)} onLink={(l) => setLink(l)} />}
      {link && <Modal open onClose={() => setLink(null)} title="Invitation created" description="An email was sent. If email isn't configured, share this link yourself." footer={<Button onClick={() => setLink(null)}>Done</Button>}><div className="flex items-center gap-2"><code className="block flex-1 break-all rounded-md bg-muted p-3 text-xs">{link}</code><Button size="icon" variant="outline" aria-label="Copy link" onClick={() => navigator.clipboard?.writeText(link)}><Copy className="h-4 w-4" /></Button></div></Modal>}
    </div>
  );
}
function RenameHousehold({ h }: { h: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = React.useState(h.name);
  return <div className="flex gap-2"><Input aria-label="Household name" value={name} onChange={(e) => setName(e.target.value)} /><Button variant="outline" disabled={!name.trim() || name === h.name} onClick={async () => { await api(`/api/households/${h.id}`, { method: "PATCH", body: { name } }); toast({ title: "Household renamed" }); void qc.invalidateQueries(); void qc.invalidateQueries({ queryKey: ["me"] }); }}>Rename</Button></div>;
}
function InviteDialog({ h, vehicles, onClose, onLink }: { h: any; vehicles: any[]; onClose: () => void; onLink: (l: string) => void }) {
  const qc = useQueryClient();
  const form = useZodForm(inviteSchema, { email: "", role: "MEMBER", vehicleAccess: [] });
  const [grants, setGrants] = React.useState<Record<string, { on: boolean; level: string; fin: boolean }>>({});
  const [err, setErr] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try {
      const vehicleAccess = Object.entries(grants).filter(([, g]) => g.on).map(([vehicleId, g]) => ({ vehicleId, level: g.level, canViewFinancials: g.fin }));
      const r = await api<any>(`/api/households/${h.id}/invites`, { method: "POST", body: { ...v, vehicleAccess } });
      void qc.invalidateQueries();
      onClose();
      onLink(r.inviteUrl);
    } catch (e) { setErr(applyApiErrors(form, e)); }
  });
  return (
    <Modal open onClose={onClose} title="Invite a family member" description="They'll get an email and must sign in with this address to accept." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="invite-form" loading={form.formState.isSubmitting}>Send invitation</Button></>}>
      <form id="invite-form" onSubmit={submit} className="space-y-4" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Email" error={form.formState.errors.email?.message as string} required>{(p) => <Input type="email" {...p} {...form.register("email")} />}</Field>
        <Field label="Household role" hint="Administrators manage members and see everything. Members only see vehicles you share.">{(p) => <Select {...p} {...form.register("role")}><option value="MEMBER">Member</option><option value="ADMIN">Administrator</option></Select>}</Field>
        <div><p className="mb-1 text-sm font-medium">Vehicle access</p>{vehicles.length === 0 ? <p className="text-sm text-muted-foreground">No vehicles yet.</p> : vehicles.map((v) => { const g = grants[v.id] ?? { on: false, level: "VIEWER", fin: false }; return (
          <div key={v.id} className="mb-2 flex flex-wrap items-center gap-3 rounded-lg border border-border p-2"><Checkbox label={v.nickname} checked={g.on} onChange={(e) => setGrants({ ...grants, [v.id]: { ...g, on: e.target.checked } })} className="min-w-[8rem] flex-1" /><Select aria-label={`Access level for ${v.nickname}`} className="h-9 w-auto" disabled={!g.on} value={g.level} onChange={(e) => setGrants({ ...grants, [v.id]: { ...g, level: e.target.value, fin: ["OWNER", "CO_OWNER"].includes(e.target.value) } })}>{["CO_OWNER", "MAINTENANCE_MANAGER", "VIEWER"].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}</Select><Checkbox label="Can see costs" disabled={!g.on || ["OWNER", "CO_OWNER"].includes(g.level)} checked={g.fin || ["OWNER", "CO_OWNER"].includes(g.level)} onChange={(e) => setGrants({ ...grants, [v.id]: { ...g, fin: e.target.checked } })} /></div>
        ); })}</div>
      </form>
    </Modal>
  );
}

function Integrations() {
  const { data, isLoading } = useQuery({ queryKey: ["integration-status"], queryFn: () => api<any>("/api/integrations/status") });
  if (isLoading || !data) return <Skeleton className="h-48" />;
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Optional integrations">Family Finance Hub works fully without any of these. Credentials are supplied as server environment variables - never entered in the browser or stored in the database.</Alert>
      <Card><CardBody><ul className="divide-y divide-border">{data.capabilities.map((c: any) => (
        <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 py-3"><div className="min-w-0 flex-1"><p className="font-medium">{c.label}</p><p className="text-sm text-muted-foreground">{c.detail}</p><p className="text-xs text-muted-foreground">Needs: {c.credentials}</p></div><Badge tone={c.enabled ? "success" : "neutral"}>{c.enabled ? "Active" : "Not configured"}</Badge></li>
      ))}</ul></CardBody></Card>
      <Card><CardHeader title="Vehicle diagnostics providers" description="Configure per vehicle from its Diagnostics tab." /><CardBody><ul className="divide-y divide-border">{data.diagnostics.map((d: any) => <li key={d.id} className="py-3"><p className="flex items-center gap-2 font-medium">{d.label}<Badge tone={d.available ? "success" : "neutral"}>{d.available ? "Available" : "Not available"}</Badge></p><p className="text-sm text-muted-foreground">{d.reason}</p></li>)}</ul></CardBody></Card>
    </div>
  );
}

function Privacy() {
  const me = useMe();
  const p = me.preferences;
  const save = usePrefsSave();
  const { toast } = useToast();
  const [del, setDel] = React.useState(false);
  const [pw, setPw] = React.useState("");
  const [err, setErr] = React.useState("");
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Sharing defaults" description="Pre-selected when you export a report to share with a mechanic, insurer or buyer. You can change them for each export." /><CardBody className="space-y-4">
        <Switch label="Hide VIN and plate" checked={p.shareHideVin} onChange={(v) => save({ shareHideVin: v })} />
        <Switch label="Hide costs" checked={p.shareHideCosts} onChange={(v) => save({ shareHideCosts: v })} />
        <Switch label="Hide service provider names" checked={p.shareHideProviders} onChange={(v) => save({ shareHideProviders: v })} />
      </CardBody></Card>
      <Card><CardHeader title="Export your data" description="A complete machine-readable copy of everything you can access: vehicles, odometer, services, repairs, parts, expenses, fuel and document metadata." /><CardBody><a href="/api/users/me/export"><Button variant="outline"><Download className="h-4 w-4" /> Download my data (JSON)</Button></a></CardBody></Card>
      <Card className="border-danger/40"><CardHeader title="Delete account" description="Permanently deletes your account. Households where you are the only member are deleted with all vehicles, records and files. In shared households, ownership passes to another member." /><CardBody><Button variant="danger" onClick={() => setDel(true)}><Trash2 className="h-4 w-4" /> Delete my account…</Button></CardBody></Card>
      <Modal open={del} onClose={() => setDel(false)} title="Delete your account?" description="This cannot be undone. Consider exporting your data first." footer={<><Button variant="outline" onClick={() => setDel(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await api("/api/users/me", { method: "DELETE", body: me.hasPassword ? { password: pw } : { email: pw } }); window.location.href = "/login?deleted=1"; } catch (e) { setErr((e as Error).message); } }}>Permanently delete</Button></>}>
        {err && <Alert tone="danger" className="mb-3">{err}</Alert>}
        <Field label={me.hasPassword ? "Confirm your password" : "Type your email to confirm"}>{(x) => <Input {...x} type={me.hasPassword ? "password" : "text"} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
      </Modal>
      <span className="hidden">{toast.length}</span>
    </div>
  );
}

function AppTab() {
  const caps = React.useMemo(() => offlineCapabilities(), []);
  const [installable, setInstallable] = React.useState(false);
  const [queue, setQueue] = React.useState(0);
  const { toast } = useToast();
  React.useEffect(() => {
    const check = () => setInstallable(!!(window as any).__avInstallPrompt);
    check();
    window.addEventListener("av:install-available", check);
    void listQueue().then((q) => setQueue(q.length));
    return () => window.removeEventListener("av:install-available", check);
  }, []);
  const ios = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="space-y-4">
      <Card><CardHeader title="Install Family Finance Hub" description="Add it to your home screen for a full-screen, app-like experience." /><CardBody className="space-y-3">
        {caps.standalone ? <Badge tone="success">Installed - running as an app</Badge> : installable ? <Button onClick={async () => { const e = (window as any).__avInstallPrompt; await e.prompt(); (window as any).__avInstallPrompt = null; setInstallable(false); }}>Install app</Button> : ios ? <p className="text-sm text-muted-foreground">On iPhone/iPad: tap the Share button, then <strong>Add to Home Screen</strong>.</p> : <p className="text-sm text-muted-foreground">Use your browser's menu → “Install app” / “Add to Home screen”. (The install prompt is only offered by some browsers.)</p>}
      </CardBody></Card>
      <Card><CardHeader title="Offline support on this device" description="Detected from your browser - features degrade gracefully when unsupported." /><CardBody>
        <ul className="space-y-1.5 text-sm">{([["Service worker (offline pages & data)", caps.serviceWorker], ["IndexedDB (offline drafts)", caps.indexedDB], ["Background sync (auto-sync when back online)", caps.backgroundSync], ["Push notifications", caps.push]] as const).map(([k, v]) => <li key={k} className="flex items-center justify-between"><span>{k}</span><Badge tone={v ? "success" : "neutral"}>{v ? "Supported" : "Not supported"}</Badge></li>)}</ul>
        <p className="mt-3 text-xs text-muted-foreground">Previously loaded vehicles and records stay readable offline. Services, fuel, expenses and mileage entered offline are kept as drafts and synced safely (duplicate-proof) when you reconnect. Where background sync isn't available, syncing happens the next time you open the app online.</p>
        <div className="mt-3 flex items-center gap-3"><span className="text-sm">{queue} draft(s) waiting</span><Button size="sm" variant="outline" onClick={async () => { const r = await flushQueue(); setQueue((await listQueue()).length); toast({ title: r.synced ? `Synced ${r.synced}` : "Nothing to sync" }); }}>Sync now</Button></div>
      </CardBody></Card>
    </div>
  );
}
export { householdSchema, label };
