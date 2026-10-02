"use client";
// Finance UI kit: money display, headers, tables, forms and visibility controls. Meaning is never carried by colour alone:
// positive and negative amounts carry a sign and an arrow, and statuses carry words.
import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Eye, Globe2, Lock, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/client/utils";
import { ApiError } from "@/lib/client/api";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinQuery, type FinView, type MemberRef, type Member } from "./provider";

// ───── money
export function Money({ value, signed, delta, className, currency, size }: { value: string | number | null | undefined; signed?: boolean; delta?: boolean; className?: string; currency?: string; size?: "xl" | "lg" | "md" }) {
  const { fmt } = useFin();
  const n = value === null || value === undefined || value === "" ? NaN : Number(value);
  const neg = n < 0, pos = n > 0;
  const text = fmt.money(value, { sign: signed || delta, currency });
  return (
    <span className={cn("money inline-flex items-center gap-1 whitespace-nowrap", size === "xl" && "text-3xl font-medium sm:text-4xl", size === "lg" && "text-2xl font-medium", delta && pos && "text-success", delta && neg && "text-danger", className)}>
      {delta && pos && <ArrowUpRight className="h-[0.85em] w-[0.85em] shrink-0" aria-label="increase" />}
      {delta && neg && <ArrowDownRight className="h-[0.85em] w-[0.85em] shrink-0" aria-label="decrease" />}
      {text}
    </span>
  );
}

export const humanize = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");

// ───── page structure
export function PageHeader({ title, description, actions, eyebrow, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6">
      {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-accent">{eyebrow}</p>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display text-3xl leading-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
export function Section({ title, description, action, children, className, flush }: { title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <Card className={className}>
      {(title || action) && <CardHeader title={title} description={description} action={action} />}
      {flush ? <div className="pb-1">{children}</div> : <CardBody>{children}</CardBody>}
    </Card>
  );
}
export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children: React.ReactNode }) {
  return <Alert tone={tone as never} title={title}>{children}</Alert>;
}

/** A quiet label and figure pair used in summary rows. */
export function Figure({ label, value, hint, delta, size = "lg", className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; delta?: boolean; size?: "lg" | "md"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <div className={cn("mt-1 truncate", size === "lg" ? "text-2xl font-medium" : "text-lg font-medium")}>{typeof value === "string" || typeof value === "number" ? <Money value={value} delta={delta} /> : value}</div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, tone, label, className }: { value: number; tone?: "ok" | "warn" | "over"; label?: string; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width]", tone === "over" ? "bg-danger" : tone === "warn" ? "bg-warning" : "bg-primary")} style={{ width: `${v}%` }} />
    </div>
  );
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral" | "primary"> = { PAID: "success", PARTIAL: "warning", OVERDUE: "danger", UNPAID: "warning", UPCOMING: "info", ON_TRACK: "success", BEHIND: "danger", COMPLETED: "success", NO_PLAN: "neutral", ACTIVE: "success", PAUSED: "neutral", CANCELLED: "neutral", over: "danger", approaching: "warning", ok: "success", unfunded: "neutral", POSTED: "neutral", PLANNED: "info", RECONCILED: "success", CLEARED: "info", UNRECONCILED: "neutral" };
const STATUS_LABEL: Record<string, string> = { ON_TRACK: "On track", NO_PLAN: "No plan set", over: "Over budget", approaching: "Near limit", ok: "Within budget", unfunded: "No budget", UNPAID: "Due soon", PLANNED: "Expected" };
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? humanize(status)}</Badge>;

// ───── people and sharing
export function MemberAvatar({ member, size = 24 }: { member: MemberRef | { name: string; color?: string | null } | null | undefined; size?: number }) {
  if (!member) return <span className="inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground" style={{ width: size, height: size }} title="Household"><Users className="h-3 w-3" aria-hidden /></span>;
  const initials = member.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white" style={{ width: size, height: size, background: member.color ?? "#185040", fontSize: size * 0.42 }} aria-hidden title={member.name}>{initials}</span>;
}
export function MemberChip({ member, fallback = "Household" }: { member: MemberRef | null | undefined; fallback?: string }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm"><MemberAvatar member={member} size={20} />{member?.name ?? fallback}</span>;
}
export function VisibilityBadge({ visibility, count }: { visibility: string; count?: number }) {
  if (visibility === "PERSONAL") return <Badge tone="neutral" title="Visible only to the owner"><Lock className="h-3 w-3" aria-hidden /> Personal</Badge>;
  if (visibility === "SELECTED") return <Badge tone="info" title="Visible to selected members"><Eye className="h-3 w-3" aria-hidden /> Shared with {count ?? "some"}</Badge>;
  return <Badge tone="primary" title="Included in the household view"><Globe2 className="h-3 w-3" aria-hidden /> Household</Badge>;
}
export const VIS_HELP = { PERSONAL: "Only you can see it. Not even household administrators can.", HOUSEHOLD: "Visible to every member and included in household totals.", SELECTED: "Visible only to you and the members you choose." } as const;

export function useMembers() {
  const q = useFinQuery<{ members: Member[]; invites: any[] }>("/members");
  return { members: q.data?.members ?? [], invites: q.data?.invites ?? [], ...q };
}

/** Visibility choice with a plain explanation of who will see the record. */
export function VisibilityField({ value, shared, onChange, lockedHousehold }: { value: string; shared: string[]; onChange: (v: { visibility: string; sharedWithMemberIds: string[] }) => void; lockedHousehold?: boolean }) {
  const { members } = useMembers();
  const others = members.filter((m) => !m.isMe);
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Who can see this</legend>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Who can see this">
        {(["HOUSEHOLD", "PERSONAL", "SELECTED"] as const).map((v) => (
          <label key={v} className={cn("flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm", value === v ? "border-primary bg-primary/5" : "border-border hover:bg-muted", lockedHousehold && v !== "HOUSEHOLD" && "pointer-events-none opacity-50")}>
            <input type="radio" name="visibility" className="mt-0.5 accent-[rgb(var(--primary))]" checked={value === v} onChange={() => onChange({ visibility: v, sharedWithMemberIds: v === "SELECTED" ? shared : [] })} />
            <span><span className="block font-medium">{v === "HOUSEHOLD" ? "Household" : v === "PERSONAL" ? "Only me" : "Selected members"}</span><span className="block text-xs text-muted-foreground">{VIS_HELP[v]}</span></span>
          </label>
        ))}
      </div>
      {value === "SELECTED" && (
        <div className="mt-3 flex flex-wrap gap-3" role="group" aria-label="Members who can see this">
          {others.length ? others.map((m) => (
            <Checkbox key={m.id} label={m.name} checked={shared.includes(m.id)} onChange={(e) => onChange({ visibility: "SELECTED", sharedWithMemberIds: e.target.checked ? [...shared, m.id] : shared.filter((x) => x !== m.id) })} />
          )) : <p className="text-sm text-muted-foreground">Invite another member first.</p>}
        </div>
      )}
    </fieldset>
  );
}

// ───── selects bound to household data
export function useAccounts(view: FinView | "all" = "all") {
  const q = useFinQuery<{ items: any[]; totals: any }>("/accounts", { view });
  return { accounts: q.data?.items ?? [], totals: q.data?.totals, ...q };
}
export function useVehicleOptions() {
  return useFinQuery<{ id: string; name: string }[]>("/vehicles/options");
}
export function VehicleSelect({ value, onChange, id, includeNone = "No vehicle" }: { value: string; onChange: (v: string) => void; id?: string; includeNone?: string }) {
  const { data } = useVehicleOptions();
  return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}><option value="">{includeNone}</option>{(data ?? []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>;
}
export function useCategories() {
  const q = useFinQuery<any[]>("/categories");
  return { categories: q.data ?? [], ...q };
}
export const AccountSelect = React.forwardRef<HTMLSelectElement, { value: string; onChange: (v: string) => void; filter?: (a: any) => boolean; includeNone?: string; id?: string }>(function AccountSelect({ value, onChange, filter, includeNone, ...p }, ref) {
  const { accounts } = useAccounts();
  const list = accounts.filter((a) => a.status === "ACTIVE" && (filter ? filter(a) : true));
  return (
    <Select ref={ref} {...p} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeNone !== undefined && <option value="">{includeNone}</option>}
      {!includeNone && !value && <option value="">Choose an account</option>}
      {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.joint ? " (joint)" : a.mine ? "" : ` (${a.owner?.name ?? ""})`}</option>)}
    </Select>
  );
});
export function CategorySelect({ value, onChange, kind = "EXPENSE", id, includeNone = "Uncategorised" }: { value: string; onChange: (v: string) => void; kind?: "EXPENSE" | "INCOME"; id?: string; includeNone?: string | null }) {
  const { categories } = useCategories();
  const roots = categories.filter((c) => c.kind === kind && !c.parentId && !c.archived);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeNone !== null && <option value="">{includeNone}</option>}
      {roots.map((r) => {
        const kids = categories.filter((c) => c.parentId === r.id && !c.archived);
        return kids.length ? <optgroup key={r.id} label={r.name}><option value={r.id}>{r.name} (general)</option>{kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</optgroup> : <option key={r.id} value={r.id}>{r.name}</option>;
      })}
    </Select>
  );
}
export function MemberSelect({ value, onChange, includeNone, id }: { value: string; onChange: (v: string) => void; includeNone?: string; id?: string }) {
  const { members } = useMembers();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeNone !== undefined && <option value="">{includeNone}</option>}
      {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isMe ? " (you)" : ""}</option>)}
    </Select>
  );
}
export const FREQ_OPTIONS: [string, string][] = [["WEEKLY", "Weekly"], ["BIWEEKLY", "Biweekly (every 2 weeks)"], ["SEMI_MONTHLY", "Semi-monthly (twice a month)"], ["MONTHLY", "Monthly"], ["QUARTERLY", "Quarterly"], ["SEMI_ANNUALLY", "Twice a year"], ["ANNUALLY", "Annually"], ["IRREGULAR", "Irregular"], ["ONE_TIME", "One time"]];

// ───── forms
export type FieldDef = {
  name: string; label: string; kind?: "text" | "money" | "number" | "date" | "select" | "textarea" | "checkbox" | "account" | "category" | "member" | "frequency" | "vehicle";
  options?: [string, string][]; hint?: string; required?: boolean; show?: (v: any) => boolean; categoryKind?: "EXPENSE" | "INCOME"; half?: boolean; placeholder?: string; accountFilter?: (a: any) => boolean; includeNone?: string; step?: string; disabled?: boolean;
};
export function ControlFor({ f, v, set, id, extra }: { f: FieldDef; v: any; set: (x: any) => void; id: string; extra: Record<string, any> }) {
  const kind = f.kind ?? "text";
  if (kind === "select") return <Select id={id} {...extra} value={v ?? ""} disabled={f.disabled} onChange={(e) => set(e.target.value)}>{(f.options ?? []).map(([a, b]) => <option key={a} value={a}>{b}</option>)}</Select>;
  if (kind === "frequency") return <Select id={id} {...extra} value={v ?? "MONTHLY"} onChange={(e) => set(e.target.value)}>{FREQ_OPTIONS.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</Select>;
  if (kind === "account") return <AccountSelect id={id} value={v ?? ""} onChange={set} filter={f.accountFilter} includeNone={f.includeNone} />;
  if (kind === "category") return <CategorySelect id={id} value={v ?? ""} onChange={set} kind={f.categoryKind} />;
  if (kind === "vehicle") return <VehicleSelect id={id} value={v ?? ""} onChange={set} includeNone={f.includeNone} />;
  if (kind === "member") return <MemberSelect id={id} value={v ?? ""} onChange={set} includeNone={f.includeNone} />;
  if (kind === "textarea") return <Textarea id={id} {...extra} value={v ?? ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
  if (kind === "checkbox") return <Checkbox id={id} checked={!!v} onChange={(e) => set(e.target.checked)} label={f.hint ?? f.label} />;
  if (kind === "date") return <Input id={id} {...extra} type="date" value={v ?? ""} onChange={(e) => set(e.target.value)} />;
  if (kind === "money") return <Input id={id} {...extra} inputMode="decimal" autoComplete="off" value={v ?? ""} placeholder={f.placeholder ?? "0.00"} onChange={(e) => set(e.target.value)} className="money text-right" />;
  if (kind === "number") return <Input id={id} {...extra} type="number" step={f.step ?? "any"} value={v ?? ""} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
  return <Input id={id} {...extra} value={v ?? ""} disabled={f.disabled} onChange={(e) => set(e.target.value)} placeholder={f.placeholder} />;
}

/** Declarative form in a modal. Server validation errors are mapped back onto the fields. */
export function FormModal({ open, onClose, title, description, fields, initial, onSubmit, submitLabel = "Save", visibility, size = "md", children, footerExtra, danger }: {
  open: boolean; onClose: () => void; title: string; description?: string; fields: FieldDef[]; initial: Record<string, any>; onSubmit: (values: Record<string, any>) => Promise<unknown>; submitLabel?: string; visibility?: boolean | "joint-aware"; size?: "sm" | "md" | "lg"; children?: (api: { values: Record<string, any>; set: (k: string, v: any) => void; errors: Record<string, string[]> }) => React.ReactNode; footerExtra?: React.ReactNode; danger?: boolean;
}) {
  const [values, setValues] = React.useState<Record<string, any>>(initial);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [general, setGeneral] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (open) { setValues(initial); setErrors({}); setGeneral(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: any) => setValues((s) => ({ ...s, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({}); setGeneral("");
    try { await onSubmit(values); onClose(); } catch (x) {
      if (x instanceof ApiError) { setErrors(x.fieldErrors); setGeneral(Object.keys(x.fieldErrors).length ? "Please check the highlighted fields." : x.message); } else setGeneral((x as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size={size} footer={<>{footerExtra}<Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form="ffh-form" loading={busy} variant={danger ? "danger" : "primary"}>{submitLabel}</Button></>}>
      <form id="ffh-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {general && <div className="sm:col-span-2"><Alert tone="danger">{general}</Alert></div>}
        {fields.filter((f) => !f.show || f.show(values)).map((f) => (
          <Field key={f.name} label={f.kind === "checkbox" ? "" : f.label} hint={f.kind === "checkbox" ? undefined : f.hint} error={errors[f.name]} required={f.required} className={cn(!f.half && "sm:col-span-2")}>
            {(p) => <ControlFor f={f} v={values[f.name]} set={(x) => set(f.name, x)} id={p.id} extra={{ "aria-describedby": p["aria-describedby"], "aria-invalid": p["aria-invalid"] }} />}
          </Field>
        ))}
        {children && <div className="sm:col-span-2">{children({ values, set, errors })}</div>}
        {visibility && <div className="sm:col-span-2"><VisibilityField value={values.visibility ?? "HOUSEHOLD"} shared={values.sharedWithMemberIds ?? []} onChange={(v) => setValues((s) => ({ ...s, ...v }))} lockedHousehold={visibility === "joint-aware" && values.joint} /></div>}
      </form>
    </Modal>
  );
}

// ───── tables
export interface Col<T> { key: string; header: string; cell: (r: T) => React.ReactNode; align?: "right"; className?: string; hideOnMobile?: boolean; primary?: boolean }
/** Table on larger screens, stacked cards on phones, so it is designed for the small screen rather than shrunk. */
export function DataTable<T extends { id?: string }>({ cols, rows, empty, onRow, caption, loading, rowKey }: { cols: Col<T>[]; rows: T[] | undefined; empty?: React.ReactNode; onRow?: (r: T) => void; caption: string; loading?: boolean; rowKey?: (r: T) => string }) {
  if (loading || !rows) return <div className="space-y-2 p-4" aria-busy>{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10 w-full" />)}</div>;
  if (!rows.length) return <div className="p-4">{empty ?? <EmptyState title="Nothing here yet" />}</div>;
  const key = (r: T, i: number) => (rowKey ? rowKey(r) : r.id ?? String(i));
  const primary = cols.find((c) => c.primary) ?? cols[0];
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">{cols.map((c) => <th key={c.key} scope="col" className={cn("px-4 py-2.5 font-medium", c.align === "right" && "text-right", c.className)}>{c.header}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={key(r, i)} onClick={onRow ? () => onRow(r) : undefined} onKeyDown={onRow ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRow(r)) : undefined} tabIndex={onRow ? 0 : undefined} className={cn("border-b border-border/70 last:border-0", onRow && "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60")}>
                {cols.map((c) => <td key={c.key} className={cn("px-4 py-3 align-middle", c.align === "right" && "text-right", c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((r, i) => (
          <li key={key(r, i)}>
            <button type="button" disabled={!onRow} onClick={onRow ? () => onRow(r) : undefined} className="block w-full px-4 py-3 text-left disabled:cursor-default">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0 font-medium">{primary.cell(r)}</div></div>
              <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {cols.filter((c) => c !== primary && !c.hideOnMobile).map((c) => <div key={c.key} className={cn("min-w-0", c.align === "right" && "text-right")}><dt className="text-muted-foreground">{c.header}</dt><dd className="truncate text-sm text-foreground">{c.cell(r)}</dd></div>)}
              </dl>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ViewSwitch({ className }: { className?: string }) {
  const { view, setView } = useFin();
  return (
    <div role="radiogroup" aria-label="Financial view" className={cn("inline-flex rounded-md border border-border bg-card p-0.5 text-sm", className)}>
      {([["my", "My finances"], ["household", "Household"]] as const).map(([k, l]) => (
        <button key={k} role="radio" aria-checked={view === k} onClick={() => setView(k)} className={cn("rounded px-3 py-1.5 font-medium transition-colors", view === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>{l}</button>
      ))}
    </div>
  );
}
export function ViewNote() {
  const { view } = useFin();
  return <p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">{view === "my" ? <Lock className="h-3 w-3" aria-hidden /> : <Users className="h-3 w-3" aria-hidden />}{view === "my" ? "Showing records you own, shared or personal." : "Showing records members have shared with the household. Personal records stay private."}</p>;
}
export function NeedsHousehold({ children }: { children: React.ReactNode }) {
  const { hid, loading, households } = useFin();
  if (loading) return <div className="space-y-3"><div className="skeleton h-10 w-64" /><div className="skeleton h-40 w-full" /></div>;
  if (!hid || !households.length) return <EmptyState title="Set up your household" description="Create a household to start tracking finances." action={<Link href="/onboarding" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Start setup</Link>} />;
  return <>{children}</>;
}
export function Add({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon?: LucideIcon }) {
  const { canWrite } = useFin();
  if (!canWrite) return null;
  return <Button onClick={onClick}>{Icon ? <Icon className="h-4 w-4" aria-hidden /> : <span aria-hidden>+</span>}{label}</Button>;
}
export function ReadOnlyNote() {
  const { canWrite } = useFin();
  return canWrite ? null : <Notice tone="info">You have read-only access to this household. You can view what is shared with you but cannot make changes.</Notice>;
}
export { Link };
