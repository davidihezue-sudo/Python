"use client";
import * as React from "react";
import Link from "next/link";
import { Alert, Button } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FREQ_OPTIONS, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, Section, StatusBadge, ViewNote, VisibilityBadge, humanize, useMembers, type Col, type FieldDef } from "@/components/finance/ui";

const KINDS: [string, string][] = [["ELECTRICITY", "Electricity"], ["NATURAL_GAS", "Natural gas"], ["WATER", "Water"], ["INTERNET", "Internet"], ["PHONE", "Phone"], ["MORTGAGE", "Mortgage"], ["RENT", "Rent"], ["INSURANCE", "Insurance premium"], ["LOAN", "Loan payment"], ["CREDIT_CARD", "Credit card payment"], ["SUBSCRIPTION", "Subscription"], ["PROPERTY_TAX", "Property tax"], ["OTHER", "Other"]];
export default function BillsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [pay, setPay] = React.useState<any | null>(null);
  const [filter, setFilter] = React.useState("ALL");
  const { data, isLoading } = useFinQuery<any[]>("/bills", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/bills", { success: "Bill added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/bills/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/bills/${b.id}`, { success: "Bill removed" });
  const payM = useFinMutation<any, any>("POST", (b) => `/bills/${b.id}/pay`, { success: "Payment recorded and posted to the ledger" });
  const rows = (data ?? []).filter((b) => b.active && (filter === "ALL" || b.currentStatus === filter));
  const counts = (s: string) => (data ?? []).filter((b) => b.active && b.currentStatus === s).length;
  const fields: FieldDef[] = [
    { name: "name", label: "Bill name", required: true },
    { name: "kind", label: "Type", kind: "select", options: KINDS, half: true },
    { name: "provider", label: "Provider", half: true },
    { name: "amount", label: "Amount", kind: "money", required: true, half: true },
    { name: "recurring", label: "", kind: "checkbox", hint: "This bill repeats (rent, utilities, phone, loan payments). Leave it off for a one-time bill." },
    { name: "frequency", label: "Repeats", kind: "select", options: FREQ_OPTIONS.filter(([k]) => k !== "ONE_TIME"), half: true, show: (v) => !!v.recurring },
    { name: "endDate", label: "Stops on (optional)", kind: "date", half: true, show: (v) => !!v.recurring },
    { name: "dueDate", label: "Next due date", kind: "date", required: true, half: true },
    { name: "accountId", label: "Pay from", kind: "account", includeNone: "Choose when paying", half: true },
    { name: "categoryId", label: "Category", kind: "category", half: true },
    { name: "responsibleMemberId", label: "Responsible member", kind: "member", includeNone: "Nobody in particular", half: true },
    { name: "autopay", label: "", kind: "checkbox", hint: "Paid automatically by the provider" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "n", header: "Bill", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{r.provider ?? humanize(r.kind)} · {humanize(r.frequency)}</span></span> },
    { key: "d", header: "Due", cell: (r) => fmt.date(r.currentDue) },
    { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.currentStatus} /> },
    { key: "w", header: "Responsible", hideOnMobile: true, cell: (r) => (r.responsibleMember ? r.responsibleMember : <span className="text-muted-foreground">n/a</span>) },
    { key: "v", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "a", header: "Amount", align: "right", cell: (r) => <span className="flex flex-col items-end"><span className="money">{fmt.money(r.amount)}</span>{Number(r.paidThisOccurrence) > 0 && r.currentStatus !== "PAID" && <span className="text-[11px] text-muted-foreground">{fmt.money(r.remaining)} left</span>}</span> },
    { key: "x", header: "", align: "right", cell: (r) => canWrite && r.currentStatus !== "PAID" ? <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setPay(r); }}>Pay</Button> : null },
  ];
  return (
    <div>
      <PageHeader eyebrow="Bills" title="Bills and payments" description="Track what is due, record payments and see everything on the calendar. Paying a bill creates one expense, attributed to whoever paid." actions={<><Add label="Add bill" onClick={() => setEdit("new")} /><Link href="/calendar" className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted">Calendar</Link></>} />
      <ViewNote />
      <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-4" aria-label="Bill summary">
        <Figure label="Overdue" value={<span className={`text-2xl ${counts("OVERDUE") ? "text-danger" : ""}`}>{counts("OVERDUE")}</span>} /><Figure label="Due soon" value={<span className="text-2xl">{counts("UNPAID") + counts("PARTIAL")}</span>} /><Figure label="Upcoming" value={<span className="text-2xl">{counts("UPCOMING")}</span>} /><Figure label="Paid this cycle" value={<span className="text-2xl">{counts("PAID")}</span>} />
      </section>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">{["ALL", "OVERDUE", "UNPAID", "PARTIAL", "UPCOMING", "PAID"].map((s) => <button key={s} onClick={() => setFilter(s)} aria-pressed={filter === s} className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === s ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{s === "ALL" ? "All" : s === "UNPAID" ? "Due soon" : humanize(s)}</button>)}</div>
      <Section flush><DataTable cols={cols} rows={rows} loading={isLoading} caption="Bills" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="No bills" description="Add utilities, insurance and other regular payments to see reminders and a payment calendar." action={canWrite ? <Button onClick={() => setEdit("new")}>Add a bill</Button> : undefined} />} /></Section>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add a bill" : `Edit ${edit?.name ?? ""}`} fields={fields} visibility initial={edit && edit !== "new" ? { ...edit, recurring: edit.frequency !== "ONE_TIME", frequency: edit.frequency === "ONE_TIME" ? "MONTHLY" : edit.frequency, endDate: edit.endDate ?? "", accountId: edit.accountId ?? "", categoryId: edit.categoryId ?? "", responsibleMemberId: edit.responsibleMemberId ?? "" } : { kind: "OTHER", recurring: true, frequency: "MONTHLY", endDate: "", reminderDays: [3] }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this bill?", description: "Past payments stay in your ledger.", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { name: v.name, kind: v.kind, provider: v.provider || null, amount: v.amount, frequency: v.recurring ? v.frequency : "ONE_TIME", endDate: v.recurring ? v.endDate || null : null, dueDate: v.dueDate, accountId: v.accountId || null, categoryId: v.categoryId || null, responsibleMemberId: v.responsibleMemberId || null, autopay: !!v.autopay, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
      <FormModal open={!!pay} onClose={() => setPay(null)} title={`Pay ${pay?.name ?? ""}`} description={pay ? `Due ${fmt.date(pay.currentDue)}. ${fmt.money(pay.remaining)} remaining.` : undefined} fields={[{ name: "amount", label: "Amount paid", kind: "money", required: true, half: true, hint: "Pay part now and the rest later: the bill shows as partially paid." }, { name: "paidOn", label: "Paid on", kind: "date", required: true, half: true }, { name: "accountId", label: "Paid from", kind: "account", required: true }, { name: "payerMemberId", label: "Who paid", kind: "member", includeNone: "The household (joint account)", hint: "Defaults to you. This is who is credited with paying a shared bill." }, ...(pay?.frequency === "ONE_TIME" ? [{ name: "makeRecurring", label: "", kind: "checkbox" as const, hint: "Make this a recurring bill from now on" }, { name: "repeatFrequency", label: "Repeats", kind: "select" as const, options: FREQ_OPTIONS.filter(([k]) => k !== "ONE_TIME"), show: (v: any) => !!v.makeRecurring }] : [])]} initial={{ amount: pay?.remaining ?? "", paidOn: new Date().toISOString().slice(0, 10), accountId: pay?.accountId ?? "", payerMemberId: members.find((m) => m.isMe)?.id ?? "", makeRecurring: false, repeatFrequency: "MONTHLY" }} submitLabel="Record payment" onSubmit={async (v) => { await payM.mutateAsync({ id: pay.id, dueDate: pay.currentDue, amount: v.amount, paidOn: v.paidOn, accountId: v.accountId, payerMemberId: v.payerMemberId || null }); if (pay.frequency === "ONE_TIME" && v.makeRecurring) await upd.mutateAsync({ id: pay.id, frequency: v.repeatFrequency }); }} />
    </div>
  );
}
