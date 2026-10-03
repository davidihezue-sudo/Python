"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Badge, Button, Checkbox, Field, Input, Select, Switch } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, Figure, MemberAvatar, MemberChip, Money, NeedsHousehold, Notice, PageHeader, Section, VIS_HELP, humanize, useMembers, type Col } from "@/components/finance/ui";
import { useRouter } from "next/navigation";

const TABS = [["members", "Members and access"], ["sharing", "My sharing"], ["contributions", "Contributions"], ["comparison", "Comparison"], ["categories", "Categories"], ["alerts", "Alerts"], ["currency", "Currency and region"], ["data", "Start fresh and data"]] as const;
export default function HouseholdPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const sp = useSearchParams();
  const [tab, setTab] = React.useState(sp.get("tab") ?? "members");
  const { profile } = useFin();
  return (
    <div>
      <PageHeader eyebrow={profile?.name ?? "Household"} title="Household" description="Independent tracking, shared household intelligence. Everyone records their own finances, and the household view combines what each member chooses to share." />
      <Tabs label="Household sections" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l }))} />
      <div className="pt-5">
        {tab === "members" && <Members />}
        {tab === "sharing" && <Sharing />}
        {tab === "contributions" && <Contributions />}
        {tab === "comparison" && <Comparison />}
        {tab === "categories" && <Categories />}
        {tab === "alerts" && <AlertSettings />}
        {tab === "currency" && <Region />}
        {tab === "data" && <DataTab />}
      </div>
    </div>
  );
}

function Members() {
  const { hid, isAdmin, profile } = useFin();
  const { members, invites } = useMembers();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [invite, setInvite] = React.useState(false);
  const [edit, setEdit] = React.useState<any | null>(null);
  const [link, setLink] = React.useState("");
  const upd = useFinMutation<any, any>("PATCH", (b) => `/members/${b.id}`, { success: "Saved" });
  const doInvite = async (v: any) => { const r = await api<any>(`/api/households/${hid}/invites`, { method: "POST", body: { email: v.email, role: v.role, vehicleAccess: [] } }); setLink(r.inviteUrl); void qcInvalidate(); };
  const qc = useQC();
  const qcInvalidate = () => qc.invalidateQueries({ queryKey: ["fin", hid] });
  return (
    <div className="space-y-6">
      <Notice>Roles control what a member can change. They never widen what a member can see: a record marked Personal is visible only to its owner, including to household administrators.</Notice>
      <Notice title="How each person uses it">Everyone signs in with their own account and keeps their own books: their accounts, income and spending go in under My finances. For each record they choose Personal (only them), Household (everyone, included in household totals) or Selected people. The Household view then combines only what has been shared, so nobody has to merge anything by hand.</Notice>
      <Section title="Members" description="Each person has their own login and enters their own records." action={isAdmin ? <Button onClick={() => { setLink(""); setInvite(true); }}>Invite a member</Button> : undefined} flush>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-3"><MemberAvatar member={m} size={36} /><div className="min-w-0"><p className="truncate font-medium">{m.name}{m.isMe ? " (you)" : ""}</p><p className="truncate text-xs text-muted-foreground">{m.email ?? ""}{m.responsibilities ? ` · ${m.responsibilities}` : ""}</p></div></div>
              <div className="flex items-center gap-2"><Badge tone={m.role === "ADMIN" ? "primary" : "neutral"}>{m.role === "ADMIN" ? "Administrator" : m.role === "READ_ONLY" ? "Read-only" : "Member"}</Badge>{(isAdmin || m.isMe) && <Button size="sm" variant="outline" onClick={() => setEdit(m)}>Edit</Button>}</div>
            </li>
          ))}
        </ul>
      </Section>
      {invites.length > 0 && <Section title="Pending invitations" flush><ul className="divide-y divide-border">{invites.map((i) => <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span>{i.email} <span className="text-muted-foreground">as {humanize(i.role)}, expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>{isAdmin && <span className="flex gap-1"><Button size="sm" variant="outline" onClick={async () => { const r = await api<any>(`/api/households/${hid}/invites`, { method: "POST", body: { email: i.email, role: i.role, vehicleAccess: [] } }); setLink(r.inviteUrl); void qcInvalidate(); }}>Get a new link</Button><Button size="sm" variant="ghost" onClick={async () => { await api(`/api/invites/${i.id}`, { method: "DELETE" }); void qcInvalidate(); toast({ title: "Invitation revoked" }); }}>Revoke</Button></span>}</li>)}</ul></Section>}
      <FormModal open={invite} onClose={() => setInvite(false)} title="Invite someone to the household" description="They get their own login. If email is not configured, copy the link and send it yourself." fields={[{ name: "email", label: "Email address", required: true }, { name: "role", label: "Role", kind: "select", options: [["MEMBER", "Member: can record and edit"], ["READ_ONLY", "Read-only: can view what is shared"], ["ADMIN", "Administrator: can also manage members"]] }]} initial={{ email: "", role: "MEMBER" }} submitLabel="Create invitation" onSubmit={doInvite} />
      <Modal open={!!link} onClose={() => setLink("")} title="Invitation ready" size="sm" footer={<><Button variant="outline" onClick={() => setLink("")}>Done</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(link); toast({ title: "Link copied" }); } catch { toast({ title: "Select the link and copy it", variant: "info" }); } }}>Copy link</Button></>}>
        <div className="space-y-3 text-sm"><p>Send this link to the person you invited. If email is set up on this server they also received an email.</p><code className="block break-all rounded-md border border-border bg-muted p-3 text-xs">{link}</code><p className="text-muted-foreground">They must register or sign in with the same email address the invitation was sent to. The link works once and expires in 7 days.</p></div>
      </Modal>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name ?? ""}`} fields={[...(isAdmin ? [{ name: "role", label: "Role", kind: "select" as const, options: [["ADMIN", "Administrator"], ["MEMBER", "Member"], ["READ_ONLY", "Read-only"]] as [string, string][] }] : []), { name: "responsibilities", label: "Financial responsibilities", placeholder: "e.g. Utilities and insurance" }]} initial={{ role: edit?.role, responsibilities: edit?.responsibilities ?? "" }} onSubmit={(v) => upd.mutateAsync({ id: edit.id, ...(isAdmin ? { role: v.role } : {}), responsibilities: v.responsibilities || null })} />
    </div>
  );
}
import { useQueryClient } from "@tanstack/react-query";
const useQC = () => useQueryClient();

function Sharing() {
  const { members } = useMembers();
  const me = members.find((m) => m.isMe);
  const d = me?.sharingDefaults ?? {};
  const save = useFinMutation<any, any>("PUT", "/sharing", { success: "Sharing defaults saved" });
  const rows: [string, string, string][] = [["income", "Income", "Your income sources"], ["accounts", "Accounts", "Accounts you create"], ["transactions", "Transactions", "Expenses and other transactions you enter"], ["savings", "Savings and goals", "Savings accounts and goals you create"], ["debts", "Debts", "Debts you add"], ["other", "Everything else", "Bills, subscriptions, insurance, assets"]];
  return (
    <div className="space-y-5">
      <Section title="Quick choices" description="Pick a starting point. You can still change any single record when you enter it.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => save.mutate({ income: "HOUSEHOLD", accounts: "HOUSEHOLD", transactions: "HOUSEHOLD", savings: "HOUSEHOLD", debts: "HOUSEHOLD", other: "HOUSEHOLD" })}>Share everything with the household</Button>
          <Button variant="outline" onClick={() => save.mutate({ income: "PERSONAL", accounts: "PERSONAL", transactions: "PERSONAL", savings: "PERSONAL", debts: "PERSONAL", other: "PERSONAL" })}>Keep everything personal</Button>
          <Button variant="ghost" onClick={() => save.mutate({})}>Keep my current choices</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Personal means only you can see it. Not even the household administrator can. Household totals only ever include what is shared.</p>
      </Section>
      <Notice>These are the defaults for new records you create. You can change any individual record when you create or edit it. Only you can change your defaults, and nobody else can see records you keep personal.</Notice>
      <Section title="What I share by default" flush>
        <ul className="divide-y divide-border">{rows.map(([k, l, h]) => (
          <li key={k} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div><p className="font-medium">{l}</p><p className="text-xs text-muted-foreground">{h}</p></div>
            <Select aria-label={`${l} default sharing`} className="w-full sm:w-72" value={d[k] ?? "HOUSEHOLD"} onChange={(e) => save.mutate({ [k]: e.target.value })}><option value="HOUSEHOLD">Shared with the household</option><option value="PERSONAL">Personal (only me)</option></Select>
          </li>
        ))}</ul>
      </Section>
      <Section title="What each level means"><dl className="space-y-3 text-sm">{(["HOUSEHOLD", "SELECTED", "PERSONAL"] as const).map((k) => <div key={k}><dt className="font-medium">{k === "HOUSEHOLD" ? "Shared with the household" : k === "PERSONAL" ? "Personal" : "Shared with selected members"}</dt><dd className="text-muted-foreground">{VIS_HELP[k]}</dd></div>)}</dl></Section>
    </div>
  );
}

function monthRange() { const t = new Date(); const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 2, 1)).toISOString().slice(0, 10); return [from, t.toISOString().slice(0, 10)]; }
function Contributions() {
  const { fmt, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [[from, to], setR] = React.useState(monthRange());
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [settle, setSettle] = React.useState<any | null | boolean>(null);
  const { data, isLoading } = useFinQuery<any>("/contributions", { from, to });
  const { data: rules } = useFinQuery<any[]>("/contributions/rules");
  const createR = useFinMutation<any, any>("POST", "/contributions/rules", { success: "Arrangement saved" });
  const updR = useFinMutation<any, any>("PUT", (b) => `/contributions/rules/${b.id}`, { success: "Arrangement saved" });
  const delR = useFinMutation<any, any>("DELETE", (b) => `/contributions/rules/${b.id}`, { success: "Removed" });
  const createS = useFinMutation<any, any>("POST", "/settlements", { success: "Settlement recorded. It is not counted as an expense." });
  const delS = useFinMutation<any, any>("DELETE", (b) => `/settlements/${b.id}`, { success: "Settlement removed" });
  const [pv, setPv] = React.useState<any>(null);
  const ruleFields = (v: any) => [
    { name: "name", label: "Name", required: true },
    { name: "arrangement", label: "Arrangement", kind: "select" as const, options: [["INDEPENDENT", "A. Independent: each pays their own"], ["SHARED_EQUAL", "B. Shared: split equally"], ["INCOME_BASED", "C. Income based: in proportion to net income"], ["FIXED", "D. Fixed monthly contribution"], ["CUSTOM", "E. Custom percentages"]] as [string, string][] },
    { name: "effectiveFrom", label: "Effective from", kind: "date" as const, half: true },
    { name: "percentOfNet", label: "Target % of net income (optional)", kind: "number" as const, half: true, show: (x: any) => x.arrangement === "INCOME_BASED" },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3"><Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setR([e.target.value, to])} className="h-9" />}</Field><Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setR([from, e.target.value])} className="h-9" />}</Field></div>
      <Notice>Paid is who made the payment. Allocated is who the cost belongs to. An expense is counted once in household totals however it is shared. Only records shared with the household are included, so everyone sees the same figures.</Notice>
      {isLoading || !data ? <div className="skeleton h-48 w-full" /> : (
        <>
          <Section title="How shared costs are funded" description={data.arrangement.label} flush>
            <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Member contributions</caption>
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Member</th><th className="px-4 py-2.5 text-right font-medium">Net income / mo</th><th className="px-4 py-2.5 text-right font-medium">Paid in total</th><th className="px-4 py-2.5 text-right font-medium">Paid for shared costs</th><th className="px-4 py-2.5 text-right font-medium">To joint accounts</th><th className="px-4 py-2.5 text-right font-medium">Allocated to them</th><th className="px-4 py-2.5 text-right font-medium">Share of shared costs</th><th className="px-4 py-2.5 text-right font-medium">Position</th></tr></thead>
              <tbody>{data.members.map((m: any, i: number) => <tr key={i} className="border-b border-border/70 last:border-0"><td className="px-4 py-3"><MemberChip member={m.member} /></td><td className="px-4 py-3 text-right money">{fmt.money(m.monthlyNetIncome)}</td><td className="px-4 py-3 text-right money">{fmt.money(m.paidTotal)}</td><td className="px-4 py-3 text-right money">{fmt.money(m.paidForSharedExpenses)}</td><td className="px-4 py-3 text-right money">{fmt.money(m.transfersToJointAccounts)}</td><td className="px-4 py-3 text-right money">{fmt.money(m.allocatedPersonal)}</td><td className="px-4 py-3 text-right money">{fmt.money(m.shareOfSharedExpenses)}</td><td className="px-4 py-3 text-right"><Money value={m.netPosition} delta /></td></tr>)}</tbody></table></div>
            <div className="grid gap-4 border-t border-border p-5 sm:grid-cols-3"><Figure label="Shared household costs" value={data.pool} size="md" /><Figure label="Allocated to individuals" value={data.personalTotal} size="md" /><Figure label="Paid from joint accounts" value={data.paidFromJointAccounts} size="md" /></div>
            <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground"><p>Position: a positive figure means the household owes that member; negative means they owe the household. {data.explanation}</p>{data.notes.map((n: string) => <p key={n} className="mt-1">{n}</p>)}</div>
          </Section>
          {data.suggestedSettlements.length > 0 && <Section title="To even things out" description="One way to settle up under this arrangement. You decide whether to.">{data.suggestedSettlements.map((s: any, i: number) => <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"><span>{s.from?.name} pays {s.to?.name} <strong className="money">{fmt.money(s.amount)}</strong></span>{canWrite && <Button size="sm" variant="outline" onClick={() => setSettle({ fromMemberId: s.from.id, toMemberId: s.to.id, amount: s.amount })}>Record settlement</Button>}</div>)}</Section>}
          <Section title="Settlements between members" description="Reimbursements are not expenses. They only move each person's position." action={canWrite ? <Button size="sm" onClick={() => setSettle(true)}>Record a settlement</Button> : undefined}>
            {data.settlements.length === 0 ? <p className="text-sm text-muted-foreground">None in this period.</p> : <ul className="divide-y divide-border">{data.settlements.map((s: any) => <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span>{fmt.date(s.date)} · {s.from?.name} paid {s.to?.name}{s.note ? <span className="text-muted-foreground"> · {s.note}</span> : null}</span><span className="flex items-center gap-2"><span className="money">{fmt.money(s.amount)}</span>{s.canDelete && <Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: "Remove this settlement?", confirmLabel: "Remove", tone: "danger" })) delS.mutate({ id: s.id }); }}>Remove</Button>}</span></li>)}</ul>}
          </Section>
        </>
      )}
      <Section title="Contribution arrangement" description="Pick how your household shares costs. You are not forced into one model." action={canWrite ? <Button size="sm" onClick={() => setEdit("new")}>New arrangement</Button> : undefined}>
        <ul className="divide-y divide-border">{(rules ?? []).map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"><span><span className="font-medium">{r.name}</span> {r.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}<span className="block text-xs text-muted-foreground">{r.label}. From {fmt.date(r.effectiveFrom)}.</span></span>{canWrite && <span className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setPv(r)}>Preview</Button><Button size="sm" variant="outline" onClick={() => setEdit(r)}>Edit</Button><Button size="sm" variant="ghost" onClick={async () => { if (await confirm({ title: "Remove this arrangement?", confirmLabel: "Remove", tone: "danger" })) delR.mutate({ id: r.id }); }}>Remove</Button></span>}</li>)}{!rules?.length && <li className="py-2 text-sm text-muted-foreground">No arrangement set. Each member bears the shared costs they paid (independent).</li>}</ul>
      </Section>
      <RuleModal edit={edit} onClose={() => setEdit(null)} members={members} onSave={(body: any) => (edit === "new" ? createR.mutateAsync(body) : updR.mutateAsync({ id: edit.id, ...body }))} />
      <SettleModal open={!!settle} preset={typeof settle === "object" ? settle : null} members={members} onClose={() => setSettle(null)} onSave={(b: any) => createS.mutateAsync(b)} />
      {pv && <PreviewModal rule={pv} from={from} to={to} onClose={() => setPv(null)} />}
    </div>
  );
}
function RuleModal({ edit, onClose, members, onSave }: any) {
  const [v, setV] = React.useState<any>({});
  const [err, setErr] = React.useState("");
  React.useEffect(() => { if (edit) { const s = edit === "new" ? {} : edit.settings ?? {}; setV(edit === "new" ? { name: "Our arrangement", arrangement: "SHARED_EQUAL", effectiveFrom: new Date().toISOString().slice(0, 10), active: true, participants: members.map((m: any) => m.id), fixed: {}, shares: {}, percentOfNet: "" } : { name: edit.name, arrangement: edit.arrangement, effectiveFrom: edit.effectiveFrom, active: edit.active, participants: s.participants?.length ? s.participants : members.map((m: any) => m.id), fixed: s.fixedMonthly ?? {}, shares: s.customShares ?? {}, percentOfNet: s.percentOfNet ?? "" }); setErr(""); } }, [edit]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr(""); try { await onSave({ name: v.name, arrangement: v.arrangement, effectiveFrom: v.effectiveFrom, active: !!v.active, participants: v.participants, percentOfNet: v.percentOfNet === "" ? null : Number(v.percentOfNet), fixedMonthly: v.arrangement === "FIXED" ? v.fixed : undefined, customShares: v.arrangement === "CUSTOM" ? v.shares : undefined }); onClose(); } catch (x) { setErr((x as Error).message); } };
  return (
    <Modal open={!!edit} onClose={onClose} title={edit === "new" ? "New contribution arrangement" : "Edit arrangement"} size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="rule-form">Save</Button></>}>
      <form id="rule-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="danger">{err}</Alert></div>}
        <Field label="Name" className="sm:col-span-2">{(p) => <Input {...p} value={v.name ?? ""} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
        <Field label="Arrangement" className="sm:col-span-2">{(p) => <Select {...p} value={v.arrangement} onChange={(e) => setV({ ...v, arrangement: e.target.value })}><option value="INDEPENDENT">A. Independent: each member pays their own expenses</option><option value="SHARED_EQUAL">B. Shared: shared costs split equally</option><option value="INCOME_BASED">C. Income based: split in proportion to net income</option><option value="FIXED">D. Fixed: a set amount each month</option><option value="CUSTOM">E. Custom: your own percentages</option></Select>}</Field>
        <Field label="Effective from">{(p) => <Input {...p} type="date" value={v.effectiveFrom ?? ""} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} />}</Field>
        {v.arrangement === "INCOME_BASED" && <Field label="Target % of net income (optional)" hint="Shown as each member's target contribution.">{(p) => <Input {...p} type="number" value={v.percentOfNet ?? ""} onChange={(e) => setV({ ...v, percentOfNet: e.target.value })} />}</Field>}
        <fieldset className="sm:col-span-2 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">Who takes part</legend><div className="space-y-2">{members.map((m: any) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 text-sm"><Checkbox label={m.name} checked={(v.participants ?? []).includes(m.id)} onChange={(e) => setV({ ...v, participants: e.target.checked ? [...(v.participants ?? []), m.id] : (v.participants ?? []).filter((x: string) => x !== m.id) })} />
            {v.arrangement === "FIXED" && <Input aria-label={`Monthly amount for ${m.name}`} inputMode="decimal" placeholder="Monthly amount" value={v.fixed?.[m.id] ?? ""} onChange={(e) => setV({ ...v, fixed: { ...v.fixed, [m.id]: e.target.value } })} className="money h-9 w-36 text-right" />}
            {v.arrangement === "CUSTOM" && <><Input aria-label={`Percent for ${m.name}`} inputMode="decimal" placeholder="%" value={v.shares?.[m.id] ?? ""} onChange={(e) => setV({ ...v, shares: { ...v.shares, [m.id]: e.target.value } })} className="h-9 w-24 text-right" /><span className="text-xs text-muted-foreground">%</span></>}</div>))}
          {v.arrangement === "CUSTOM" && <p className="text-xs text-muted-foreground">Percentages must add up to 100. Now: {Object.values(v.shares ?? {}).reduce((a: number, x: any) => a + Number(x || 0), 0)}%.</p>}</div></fieldset>
        <div className="sm:col-span-2"><Checkbox label="This arrangement is active" checked={!!v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /></div>
      </form>
    </Modal>
  );
}
function SettleModal({ open, preset, members, onClose, onSave }: any) {
  const [v, setV] = React.useState<any>({});
  const [err, setErr] = React.useState("");
  const me = members.find((m: any) => m.isMe);
  React.useEffect(() => { if (open) { setV({ fromMemberId: preset?.fromMemberId ?? me?.id ?? "", toMemberId: preset?.toMemberId ?? members.find((m: any) => !m.isMe)?.id ?? "", amount: preset?.amount ?? "", date: new Date().toISOString().slice(0, 10), note: "", fromAccountId: "", toAccountId: "" }); setErr(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => { e.preventDefault(); try { await onSave({ ...v, fromAccountId: v.fromAccountId || null, toAccountId: v.toAccountId || null, note: v.note || null }); onClose(); } catch (x) { setErr((x as Error).message); } };
  return (
    <Modal open={open} onClose={onClose} title="Record a settlement" description="A reimbursement between members. It is never counted as an expense or income." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="settle-form">Record</Button></>}>
      <form id="settle-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {err && <div className="sm:col-span-2"><Alert tone="danger">{err}</Alert></div>}
        <Field label="Paid by">{(p) => <Select {...p} value={v.fromMemberId} onChange={(e) => setV({ ...v, fromMemberId: e.target.value })}>{members.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="Paid to">{(p) => <Select {...p} value={v.toMemberId} onChange={(e) => setV({ ...v, toMemberId: e.target.value })}>{members.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>}</Field>
        <Field label="Amount" required>{(p) => <Input {...p} inputMode="decimal" value={v.amount ?? ""} onChange={(e) => setV({ ...v, amount: e.target.value })} className="money text-right" />}</Field>
        <Field label="Date">{(p) => <Input {...p} type="date" value={v.date ?? ""} onChange={(e) => setV({ ...v, date: e.target.value })} />}</Field>
        <Field label="Note" className="sm:col-span-2">{(p) => <Input {...p} value={v.note ?? ""} onChange={(e) => setV({ ...v, note: e.target.value })} />}</Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">To keep account balances reconciled, you can also pick the account of yours that the money left or arrived in. Skip this if the money moved outside the app.</p>
      </form>
    </Modal>
  );
}
function PreviewModal({ rule, from, to, onClose }: any) {
  const { fmt, hid } = useFin();
  const [d, setD] = React.useState<any>(null);
  React.useEffect(() => { void api(`/api/finance/${hid}/contributions/preview`, { method: "POST", body: { from, to, rule: { arrangement: rule.arrangement, participants: (rule.settings?.participants ?? []), percentOfNet: rule.settings?.percentOfNet ?? null, fixedMonthly: rule.settings?.fixedMonthly, customShares: rule.settings?.customShares } } }).then(setD); }, [hid]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open onClose={onClose} title={`Preview: ${rule.name}`} description="How this period would look under this arrangement. Nothing is saved." size="lg">
      {!d ? <div className="skeleton h-32 w-full" /> : <table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs text-muted-foreground"><th className="py-2">Member</th><th className="py-2 text-right">Share of shared costs</th><th className="py-2 text-right">Paid for shared</th><th className="py-2 text-right">Position</th></tr></thead><tbody>{d.members.map((m: any, i: number) => <tr key={i} className="border-b border-border/70"><td className="py-2"><MemberChip member={m.member} /></td><td className="py-2 text-right money">{fmt.money(m.shareOfSharedExpenses)}</td><td className="py-2 text-right money">{fmt.money(m.paidForSharedExpenses)}</td><td className="py-2 text-right"><Money value={m.netPosition} delta /></td></tr>)}</tbody></table>}
    </Modal>
  );
}

function Comparison() {
  const { fmt } = useFin();
  const [[from, to], setR] = React.useState(monthRange());
  const { data } = useFinQuery<any>("/comparison", { from, to });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3"><Field label="From">{(p) => <Input {...p} type="date" value={from} onChange={(e) => setR([e.target.value, to])} className="h-9" />}</Field><Field label="To">{(p) => <Input {...p} type="date" value={to} onChange={(e) => setR([from, e.target.value])} className="h-9" />}</Field></div>
      {data?.notes.map((n: string) => <p key={n} className="text-sm text-muted-foreground">{n}</p>)}
      {!data ? <div className="skeleton h-48 w-full" /> : (
        <Section title="Contributions side by side" description="A neutral picture of how the household is funded. It is not a ranking." flush>
          <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Member comparison</caption>
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Measure</th>{data.members.map((m: any) => <th key={m.member?.id} className="px-4 py-2.5 text-right font-medium"><span className="inline-flex items-center gap-1.5"><MemberChip member={m.member} /></span></th>)}</tr></thead>
            <tbody>{[["Monthly gross income", "monthlyGrossIncome"], ["Monthly net income", "monthlyNetIncome"], ["Share of household net income", "incomeShare", "pct"], ["Income received in period", "incomeReceived"], ["Expenses recorded", "expensesRecorded"], ["Personal spending (allocated to them)", "personalSpending"], ["Household expenses paid", "householdExpensesPaid"], ["Shared bills paid", "sharedBillsPaid"], ["Moved to joint accounts", "transfersToJointAccounts"], ["Savings contributions", "savingsContributions"], ["Debt payments", "debtPayments"], ["Goal contributions", "goalContributions"]].map(([l, k, t]) => <tr key={k} className="border-b border-border/70 last:border-0"><td className="px-4 py-2.5 text-muted-foreground">{l}</td>{data.members.map((m: any) => <td key={m.member?.id} className="px-4 py-2.5 text-right money">{t === "pct" ? (m[k] ? `${m[k]}%` : "n/a") : fmt.money(m[k])}</td>)}</tr>)}</tbody></table></div>
        </Section>
      )}
      {data?.sharedGoals.length > 0 && <Section title="Contributions toward shared goals" flush><ul className="divide-y divide-border">{data.sharedGoals.map((g: any) => <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span className="font-medium">{g.name} <span className="font-normal text-muted-foreground">{fmt.money(g.current)} of {fmt.money(g.target)}</span></span><span className="flex flex-wrap gap-3">{g.byMember.map((b: any, i: number) => <span key={i} className="flex items-center gap-1.5"><MemberChip member={b.member} /> <span className="money">{fmt.money(b.total)}</span></span>)}</span></li>)}</ul></Section>}
    </div>
  );
}

function Categories() {
  const { categories } = useCategoriesList();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const create = useFinMutation<any, any>("POST", "/categories", { success: "Category added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/categories/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/categories/${b.id}`, { success: "Deleted" });
  const roots = categories.filter((c: any) => !c.parentId);
  return (
    <Section title="Categories and subcategories" description="Add your own. Categories marked essential feed the emergency fund planner." action={<Add label="Add category" onClick={() => setEdit("new")} />} flush>
      {["EXPENSE", "INCOME"].map((kind) => (
        <div key={kind}><p className="border-b border-border bg-muted/50 px-5 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{kind === "EXPENSE" ? "Expense categories" : "Income categories"}</p>
          <ul>{roots.filter((r: any) => r.kind === kind).map((r: any) => (
            <li key={r.id} className="border-b border-border last:border-0">
              <div className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: r.color ?? "#74796F" }} aria-hidden /><span className={r.archived ? "text-muted-foreground line-through" : "font-medium"}>{r.name}</span>{r.isEssential && <Badge>Essential</Badge>}<span className="text-xs text-muted-foreground">{r.uses} uses</span></span><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button></div>
              {categories.filter((c: any) => c.parentId === r.id).map((c: any) => <div key={c.id} className="flex items-center justify-between gap-2 px-5 py-1.5 pl-12 text-sm text-muted-foreground"><span className={c.archived ? "line-through" : ""}>{c.name} <span className="text-xs">{c.uses} uses</span></span><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button></div>)}
            </li>
          ))}</ul></div>
      ))}
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add a category" : `Edit ${edit?.name ?? ""}`} fields={[{ name: "name", label: "Name", required: true }, { name: "kind", label: "Kind", kind: "select", options: [["EXPENSE", "Expense"], ["INCOME", "Income"]], half: true, show: () => edit === "new" }, { name: "parentId", label: "Parent (optional)", kind: "select", half: true, show: () => edit === "new", options: [["", "Top level"], ...(roots.map((r: any) => [r.id, r.name]) as [string, string][])] }, { name: "isEssential", label: "", kind: "checkbox", hint: "Essential spending (housing, food, utilities, health)" }, { name: "archived", label: "", kind: "checkbox", hint: "Archived (hidden from new entries, history kept)", show: () => edit !== "new" }]} initial={edit && edit !== "new" ? { name: edit.name, isEssential: edit.isEssential, archived: edit.archived } : { kind: "EXPENSE", parentId: "", isEssential: false }}
        footerExtra={edit && edit !== "new" && !edit.isSystem && edit.uses === 0 ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Delete this category?", confirmLabel: "Delete", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Delete</Button> : undefined}
        onSubmit={(v) => (edit === "new" ? create.mutateAsync({ name: v.name, kind: v.kind, parentId: v.parentId || null, isEssential: !!v.isEssential }) : upd.mutateAsync({ id: edit.id, name: edit.isSystem ? undefined : v.name, isEssential: !!v.isEssential, archived: !!v.archived }))} />
    </Section>
  );
}
function useCategoriesList() { const q = useFinQuery<any[]>("/categories"); return { categories: q.data ?? [] }; }

function AlertSettings() {
  const { data: s } = useFinQuery<any>("/alert-settings");
  const save = useFinMutation<any, any>("PUT", "/alert-settings", { success: "Alert settings saved" });
  const refresh = useFinMutation<any, any>("POST", "/alerts/refresh", { success: "Notifications refreshed" });
  if (!s) return <div className="skeleton h-48 w-full" />;
  const toggles: [string, string, string][] = [["billsDue", "Upcoming bills", "Bills due within the reminder window"], ["overdue", "Overdue payments", "Bills past their due date"], ["budget", "Budget limits", "Categories approaching or over their limit"], ["unusual", "Unusual spending", "Transactions far above normal, and a month running hot"], ["lowBalance", "Low balances", "Accounts below your threshold"], ["savings", "Savings and goals", "Milestones and goals falling behind"], ["debtDue", "Debt payments", "Debt payments coming due"], ["insurance", "Insurance renewals", "Policies about to renew"], ["subscriptions", "Subscription renewals", "Subscriptions about to charge"]];
  return (
    <div className="space-y-5">
      <Section title="What to alert me about" flush><ul className="divide-y divide-border">{toggles.map(([k, l, h]) => <li key={k} className="px-5 py-3"><Switch checked={!!s[k]} onChange={(v) => save.mutate({ [k]: v })} label={l} description={h} /></li>)}</ul></Section>
      <Section title="Thresholds and delivery">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reminder lead time (days)">{(p) => <Input {...p} type="number" min={0} max={60} defaultValue={s.leadDays} onBlur={(e) => save.mutate({ leadDays: Number(e.target.value) })} />}</Field>
          <Field label="Budget warning (percent used)">{(p) => <Input {...p} type="number" min={10} max={100} defaultValue={s.budgetThresholdPct} onBlur={(e) => save.mutate({ budgetThresholdPct: Number(e.target.value) })} />}</Field>
          <Field label="Low balance below">{(p) => <Input {...p} inputMode="decimal" defaultValue={s.lowBalanceThreshold} onBlur={(e) => save.mutate({ lowBalanceThreshold: e.target.value })} className="money text-right" />}</Field>
          <Field label="Unusual spending multiplier" hint="Alert when a transaction is this many times the usual amount">{(p) => <Input {...p} inputMode="decimal" defaultValue={s.unusualMultiplier} onBlur={(e) => save.mutate({ unusualMultiplier: e.target.value })} className="money text-right" />}</Field>
          <Field label="How often">{(p) => <Select {...p} value={s.frequency} onChange={(e) => save.mutate({ frequency: e.target.value })}><option value="IMMEDIATE">As they happen</option><option value="DAILY">Daily summary</option><option value="WEEKLY">Weekly summary</option></Select>}</Field>
        </div>
        <div className="mt-4 space-y-3"><Switch checked={!!s.inApp} onChange={(v) => save.mutate({ inApp: v })} label="In-app notifications" /><Switch checked={!!s.email} onChange={(v) => save.mutate({ email: v })} label="Email notifications" description="Only delivered if email is configured for this installation." /></div>
        <Button className="mt-4" variant="outline" onClick={() => refresh.mutate({})}>Check for alerts now</Button>
      </Section>
    </div>
  );
}

function Region() {
  const { profile, isAdmin, hid } = useFin();
  const { data: fx } = useFinQuery<any[]>("/fx");
  const upd = useFinMutation<any, any>("PATCH", "/profile", { success: "Saved" });
  const addFx = useFinMutation<any, any>("POST", "/fx", { success: "Rate saved" });
  const delFx = useFinMutation<any, any>("DELETE", (b) => `/fx/${b.id}`, { success: "Rate removed" });
  const [fxOpen, setFxOpen] = React.useState(false);
  if (!profile) return null;
  return (
    <div className="space-y-5">
      {!isAdmin && <Notice>Only administrators can change household settings.</Notice>}
      <FormInline profile={profile} disabled={!isAdmin} onSave={(v: any) => upd.mutateAsync(v)} />
      <Section title="Exchange rates" description="Used when accounts or income use a currency other than the household currency. Currencies are never combined without a rate." action={<Button size="sm" onClick={() => setFxOpen(true)}>Add a rate</Button>} flush>
        <ul className="divide-y divide-border">{(fx ?? []).map((r) => <li key={r.id} className="flex items-center justify-between px-5 py-2.5 text-sm"><span>1 {r.base} = <span className="money">{r.rate}</span> {r.quote} <span className="text-xs text-muted-foreground">as of {r.asOf} ({r.source})</span></span><Button size="sm" variant="ghost" onClick={() => delFx.mutate({ id: r.id })}>Remove</Button></li>)}{!fx?.length && <li className="px-5 py-3 text-sm text-muted-foreground">No rates recorded.</li>}</ul>
      </Section>
      <FormModal open={fxOpen} onClose={() => setFxOpen(false)} title="Add an exchange rate" fields={[{ name: "base", label: "From currency", half: true, placeholder: "USD" }, { name: "quote", label: "To currency", half: true, placeholder: profile.currency }, { name: "rate", label: "Rate", kind: "number", half: true }, { name: "asOf", label: "As of", kind: "date", half: true }, { name: "source", label: "Source", placeholder: "e.g. bank rate" }]} initial={{ quote: profile.currency, asOf: new Date().toISOString().slice(0, 10), source: "manual" }} onSubmit={(v) => addFx.mutateAsync({ base: String(v.base).toUpperCase(), quote: String(v.quote).toUpperCase(), rate: String(v.rate), asOf: v.asOf, source: v.source || "manual" })} />
    </div>
  );
}
function FormInline({ profile, disabled, onSave }: any) {
  const [v, setV] = React.useState<any>({ name: profile.name, countryCode: profile.countryCode, region: profile.region ?? "", city: profile.city ?? "", currency: profile.currency, fiscalYearStartMonth: profile.fiscalYearStartMonth, dateFormat: profile.dateFormat, numberLocale: profile.numberLocale, budgetPeriod: profile.budgetPeriod });
  const [err, setErr] = React.useState("");
  const { toast } = useToast();
  const save = async () => { setErr(""); try { await onSave({ ...v, region: v.region || null, city: v.city || null, fiscalYearStartMonth: Number(v.fiscalYearStartMonth) }); } catch (e) { setErr((e as Error).message); } };
  const set = (k: string, x: any) => setV((s: any) => ({ ...s, [k]: x }));
  return (
    <Section title="Household profile and formats">
      {err && <Alert tone="danger">{err}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Household name">{(p) => <Input {...p} disabled={disabled} value={v.name} onChange={(e) => set("name", e.target.value)} />}</Field>
        <Field label="Default currency" hint="Three letter code, for example CAD or USD">{(p) => <Input {...p} disabled={disabled} value={v.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} />}</Field>
        <Field label="Country (two letter code)">{(p) => <Input {...p} disabled={disabled} value={v.countryCode} onChange={(e) => set("countryCode", e.target.value.toUpperCase().slice(0, 2))} />}</Field>
        <Field label="Province or state" hint="Used to pick tax rules, for example AB, ON, BC">{(p) => <Input {...p} disabled={disabled} value={v.region} onChange={(e) => set("region", e.target.value.toUpperCase())} />}</Field>
        <Field label="City">{(p) => <Input {...p} disabled={disabled} value={v.city} onChange={(e) => set("city", e.target.value)} />}</Field>
        <Field label="Financial year starts in">{(p) => <Select {...p} disabled={disabled} value={v.fiscalYearStartMonth} onChange={(e) => set("fiscalYearStartMonth", e.target.value)}>{["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>}</Field>
        <Field label="Date format">{(p) => <Select {...p} disabled={disabled} value={v.dateFormat} onChange={(e) => set("dateFormat", e.target.value)}><option value="YYYY-MM-DD">2026-03-31</option><option value="DD/MM/YYYY">31/03/2026</option><option value="MM/DD/YYYY">03/31/2026</option><option value="D MMM YYYY">31 Mar 2026</option></Select>}</Field>
        <Field label="Number format">{(p) => <Select {...p} disabled={disabled} value={v.numberLocale} onChange={(e) => set("numberLocale", e.target.value)}><option value="en-CA">1,234.56 (English, Canada)</option><option value="en-US">1,234.56 (English, US)</option><option value="fr-CA">1 234,56 (French, Canada)</option><option value="de-DE">1.234,56 (German)</option><option value="en-GB">1,234.56 (English, UK)</option></Select>}</Field>
        <Field label="Default budget period">{(p) => <Select {...p} disabled={disabled} value={v.budgetPeriod} onChange={(e) => set("budgetPeriod", e.target.value)}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="ANNUAL">Annual</option></Select>}</Field>
      </div>
      {!disabled && <Button className="mt-4" onClick={save}>Save</Button>}
      <p className="mt-3 text-xs text-muted-foreground">Changing the default currency does not convert existing amounts. Accounts keep the currency they were created in.</p>
    </Section>
  );
}

/** Asks the person to type a phrase before a destructive action runs. */
function TypedConfirm({ open, onClose, title, description, phrase, label, onConfirm }: { open: boolean; onClose: () => void; title: string; description: React.ReactNode; phrase: string; label: string; onConfirm: () => Promise<void> }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  React.useEffect(() => { if (open) { setText(""); setErr(""); } }, [open]);
  const go = async () => { setBusy(true); setErr(""); try { await onConfirm(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="danger" onClick={go} loading={busy} disabled={text.trim() !== phrase}>{label}</Button></>}>
      <div className="space-y-3 text-sm">
        <div className="text-muted-foreground">{description}</div>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label={`Type ${phrase} to confirm`}>{(p) => <Input id={p.id} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />}</Field>
      </div>
    </Modal>
  );
}

function DataTab() {
  const { hid, profile, isAdmin, households, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clearing, setClearing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const others = households.filter((h) => h.id !== hid && !h.isDemo);
  const afterRemoval = async () => { await qc.invalidateQueries(); router.replace(others.length ? "/dashboard" : "/onboarding?new=1"); };
  const loadDemo = async () => { try { await api<any>("/api/finance/demo", { method: "POST" }); await qc.invalidateQueries({ queryKey: ["fin"] }); toast({ title: "Demo household created", description: "Switch households from the menu at the top." }); router.refresh(); } catch (e) { toast({ title: "Could not create the demo", description: (e as Error).message, variant: "error" }); } };
  const removeDemo = async () => {
    if (!(await confirm({ title: "Remove the demonstration data?", description: "The demo household, its demo vehicle and everything in it are deleted, then you can set up your own household. Real households are not affected.", confirmLabel: "Remove demo", tone: "danger" }))) return;
    try { await api(`/api/finance/${hid}/demo`, { method: "DELETE" }); toast({ title: "Demo removed. Let's set up yours." }); await afterRemoval(); } catch (e) { toast({ title: "Could not remove the demo", description: (e as Error).message, variant: "error" }); }
  };
  return (
    <div className="space-y-5">
      {profile?.isDemo ? (
        <Section title="You are viewing demonstration data" description="Everything here is invented so you can explore. When you are ready, remove it and enter your own.">
          {isAdmin ? <Button variant="danger" onClick={removeDemo}>Remove demo data and start fresh</Button> : <p className="text-sm text-muted-foreground">Only the household administrator can remove the demo.</p>}
        </Section>
      ) : (
        <>
          {canWrite && (
            <Section title="Clear my records" description="Starts your own books again. This removes everything you own in this household: your accounts, transactions, income, bills, debts, goals, assets, tax records, budgets and calendar events.">
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground"><li>Joint accounts, other members' records, categories and household settings stay exactly as they are.</li><li>Transfers between your account and a joint account are removed on both sides, so balances stay correct.</li><li>Vehicles and service records are not touched.</li><li>It cannot be undone. Download your data first if you might want it.</li></ul>
              <Button variant="danger" onClick={() => setClearing(true)}>Clear my records</Button>
            </Section>
          )}
          {isAdmin && (
            <Section title="Delete this household" description="Removes the household with its vehicles, finance records and settings. This is only possible when you are the only member, so nobody else's records can be lost.">
              {members.length > 1 ? <p className="text-sm text-muted-foreground">Other people still belong to this household. Ask them to leave first, or use Clear my records above to remove only what you own.</p> : <Button variant="danger" onClick={() => setDeleting(true)}>Delete this household</Button>}
            </Section>
          )}
        </>
      )}
      <Section title="Your data" description="Export everything you are allowed to see in this household as a machine-readable file."><a className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted" href={`/api/finance/${hid}/export-all`}>Download my data (JSON)</a><p className="mt-2 text-xs text-muted-foreground">Account deletion and password settings are in Settings, Privacy and data.</p></Section>
      {!households.some((h) => h.isDemo) && (
        <Section title="Demonstration data" description="Illustrative household data so you can explore every screen. It is clearly labelled, kept in its own household and removable in one click.">
          <Button variant="outline" onClick={loadDemo}>Load the demo household</Button>
        </Section>
      )}
      <TypedConfirm open={clearing} onClose={() => setClearing(false)} title="Clear all of my records?" phrase="CLEAR" label="Clear my records" description="Everything you own in this household is permanently deleted. Other members and joint accounts are not affected."
        onConfirm={async () => { await api(`/api/finance/${hid}/clear-my-records`, { method: "POST", body: { confirm: "CLEAR" } }); toast({ title: "Your records were cleared" }); await qc.invalidateQueries(); router.push("/dashboard"); }} />
      <TypedConfirm open={deleting} onClose={() => setDeleting(false)} title="Delete this household?" phrase={profile?.name ?? ""} label="Delete household" description="The household, its vehicles and all of its records are permanently deleted for everyone in it."
        onConfirm={async () => { await api(`/api/finance/${hid}/delete-household`, { method: "POST", body: { confirm: profile?.name } }); toast({ title: "Household deleted" }); await afterRemoval(); }} />
    </div>
  );
}
