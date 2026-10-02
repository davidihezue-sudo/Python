"use client";
import * as React from "react";
import { Alert, Badge, Button } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, Section, StatusBadge, ViewNote, VisibilityBadge, humanize, useMembers, type Col, type FieldDef } from "@/components/finance/ui";
import { TransactionList } from "@/components/finance/transaction-list";
import { Tabs, TabPanel } from "@/components/ui/tabs";

const KINDS: [string, string][] = [["EMPLOYMENT", "Employment salary"], ["PART_TIME", "Part-time employment"], ["SELF_EMPLOYMENT", "Self-employment"], ["BUSINESS", "Business income"], ["CONTRACT", "Contract income"], ["FREELANCE", "Freelance income"], ["RENTAL", "Rental income"], ["INVESTMENT", "Investment income"], ["GOVERNMENT_BENEFIT", "Government benefit"], ["OTHER", "Other income"]];
export default function IncomePage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState("sources");
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [pay, setPay] = React.useState<any | null>(null);
  const [change, setChange] = React.useState<any | null>(null);
  const { data: summary } = useFinQuery<any>("/income/summary", { view });
  const { data, isLoading } = useFinQuery<any[]>("/income", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/income", { success: "Income source added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/income/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/income/${b.id}`, { success: "Removed" });
  const payM = useFinMutation<any, any>("POST", (b) => `/income/${b.id}/payments`, { success: "Payment recorded" });
  const chM = useFinMutation<any, any>("POST", (b) => `/income/${b.id}/changes`, { success: "Change recorded" });
  const fields: FieldDef[] = [
    { name: "name", label: "Name", required: true, placeholder: "e.g. Salary" },
    { name: "kind", label: "Income type", kind: "select", options: KINDS, half: true },
    { name: "employer", label: "Employer or source", half: true },
    { name: "grossAmount", label: "Gross per payment", kind: "money", required: true, half: true, hint: "Before tax and deductions" },
    { name: "netAmount", label: "Net per payment", kind: "money", required: true, half: true, hint: "What reaches your account" },
    { name: "taxDeduction", label: "Tax deducted", kind: "money", half: true },
    { name: "pensionDeduction", label: "Pension deduction", kind: "money", half: true },
    { name: "otherDeduction", label: "Other deductions", kind: "money", half: true },
    { name: "frequency", label: "How often", kind: "frequency", half: true, hint: "Biweekly (26 pays a year) and semi-monthly (24) are different." },
    { name: "nextPayDate", label: "Next expected pay date", kind: "date", half: true },
    { name: "accountId", label: "Deposited into", kind: "account", includeNone: "Choose later", half: true },
    { name: "assignToMemberId", label: "Whose income", kind: "member", show: () => members.length > 1, includeNone: "Mine (default)", half: true },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "n", header: "Source", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}{!r.activeToday ? " (not active)" : ""}</span><span className="text-xs text-muted-foreground">{humanize(r.kind)}{r.employer ? ` · ${r.employer}` : ""}</span></span> },
    { key: "o", header: "Member", cell: (r) => <MemberChip member={r.owner} /> },
    { key: "f", header: "Frequency", cell: (r) => humanize(r.frequency) },
    { key: "np", header: "Next pay", hideOnMobile: true, cell: (r) => fmt.date(r.nextPayDate) },
    { key: "v", header: "Sharing", hideOnMobile: true, cell: (r) => <VisibilityBadge visibility={r.visibility} /> },
    { key: "g", header: "Monthly gross", align: "right", cell: (r) => <Money value={r.monthlyGross} /> },
    { key: "m", header: "Monthly net", align: "right", cell: (r) => <Money value={r.monthlyNet} /> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Income" title="Income" description="Record each income source with gross and net amounts. Monthly figures are derived from how often you are paid." actions={<Add label="Add income" onClick={() => setEdit("new")} />} />
      <ViewNote />
      {summary && (
        <section className="mb-6 rounded-xl border border-border bg-card p-5" aria-label="Income summary">
          <div className="grid gap-6 sm:grid-cols-4">
            <Figure label="Combined gross per month" value={summary.combinedMonthlyGross} hint="Before tax" />
            <Figure label="Combined net per month" value={summary.combinedMonthlyNet} hint="Used for cash flow" />
            <Figure label="Net per year" value={summary.combinedAnnualNet} size="md" />
            <Figure label="Sources" value={<span className="text-2xl">{summary.sourceCount}</span>} hint="Active today" />
          </div>
          <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {summary.members.map((m: any, i: number) => <div key={i} className="flex items-center justify-between gap-3 text-sm"><MemberChip member={m.member} /><span className="text-right"><span className="block money">{fmt.money(m.monthlyNet)} net</span><span className="block text-xs text-muted-foreground money">{fmt.money(m.monthlyGross)} gross{m.share ? ` · ${m.share}% of net` : ""}</span></span></div>)}
          </div>
          {summary.warnings.map((w: string) => <p key={w} className="mt-2 text-xs text-warning">{w}</p>)}
        </section>
      )}
      <Tabs label="Income sections" value={tab} onChange={setTab} tabs={[{ key: "sources", label: "Sources" }, { key: "received", label: "Payments received" }, { key: "changes", label: "Changes" }]} />
      <div className="pt-5">
        <TabPanel id="sources" active={tab === "sources"}>
          <Section flush><DataTable cols={cols} rows={data} loading={isLoading} caption="Income sources" onRow={(r) => setEdit(r)} empty={<EmptyState title="No income recorded yet" description="Add your salary or other income. Each member records their own, and the household totals combine what is shared." action={canWrite ? <Button onClick={() => setEdit("new")}>Add income</Button> : undefined} />} /></Section>
        </TabPanel>
        <TabPanel id="received" active={tab === "received"}>{tab === "received" && <TransactionList lockedTypes="INCOME" showAdd exportEntity="income" initial={{ view: "all" }} />}</TabPanel>
        <TabPanel id="changes" active={tab === "changes"}>
          <Section title="Income history" description="Raises, cuts, job changes and interruptions are kept as a history.">
            {(data ?? []).flatMap((s) => s.changes.map((c: any) => ({ ...c, source: s }))).sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1)).map((c: any) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2.5 text-sm last:border-0"><span><span className="font-medium">{humanize(c.kind)}</span> · {c.source.name} <span className="text-muted-foreground">on {fmt.date(c.effectiveDate)}</span>{c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}</span><span className="money text-muted-foreground">{c.netBefore ? `${fmt.money(c.netBefore)} to ${c.netAfter ? fmt.money(c.netAfter) : "n/a"} net` : ""}</span></div>
            ))}
            {!(data ?? []).some((s) => s.changes.length) && <p className="text-sm text-muted-foreground">No changes recorded. Open an income source to record a change.</p>}
          </Section>
        </TabPanel>
      </div>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add income" : `Edit ${edit?.name ?? ""}`} fields={edit === "new" ? fields : fields.filter((f) => f.name !== "assignToMemberId")} visibility size="lg"
        initial={edit && edit !== "new" ? { ...edit, accountId: edit.accountId ?? "" } : { kind: "EMPLOYMENT", frequency: "BIWEEKLY", taxDeduction: "0.00", pensionDeduction: "0.00", otherDeduction: "0.00" }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <><Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this income source?", description: "Past payments stay in your ledger.", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button><Button variant="outline" onClick={() => { setPay(edit); setEdit(null); }}>Record payment</Button><Button variant="outline" onClick={() => { setChange(edit); setEdit(null); }}>Record change</Button></> : undefined}
        onSubmit={(v) => { const body = { name: v.name, kind: v.kind, employer: v.employer || null, grossAmount: v.grossAmount, netAmount: v.netAmount, taxDeduction: v.taxDeduction || "0.00", pensionDeduction: v.pensionDeduction || "0.00", otherDeduction: v.otherDeduction || "0.00", frequency: v.frequency, nextPayDate: v.nextPayDate || null, accountId: v.accountId || null, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync({ ...body, assignToMemberId: v.assignToMemberId || undefined }) : upd.mutateAsync({ id: edit.id, ...body }); }} />
      <FormModal open={!!pay} onClose={() => setPay(null)} title={`Record a payment: ${pay?.name ?? ""}`} description="Creates an income transaction in the deposit account." fields={[{ name: "date", label: "Date received", kind: "date", required: true, half: true }, { name: "amount", label: "Net amount", kind: "money", half: true }, { name: "accountId", label: "Deposited into", kind: "account", required: true }, { name: "notes", label: "Notes", kind: "textarea" }]} initial={{ date: new Date().toISOString().slice(0, 10), amount: pay?.netAmount ?? "", accountId: pay?.accountId ?? "" }} onSubmit={(v) => payM.mutateAsync({ id: pay.id, date: v.date, amount: v.amount || undefined, accountId: v.accountId, notes: v.notes || null })} />
      <FormModal open={!!change} onClose={() => setChange(null)} title={`Record a change: ${change?.name ?? ""}`} description="Keeps a history. Changes effective today or earlier update the source." fields={[{ name: "kind", label: "What changed", kind: "select", options: [["SALARY_INCREASE", "Salary increase"], ["SALARY_DECREASE", "Salary decrease"], ["JOB_CHANGE", "Job change"], ["INTERRUPTION", "Temporary interruption"], ["RESUMPTION", "Income resumes"], ["OTHER", "Other"]] }, { name: "effectiveDate", label: "Effective date", kind: "date", required: true, half: true }, { name: "pausedUntil", label: "Interruption ends", kind: "date", half: true, show: (v) => v.kind === "INTERRUPTION" }, { name: "grossAfter", label: "New gross per payment", kind: "money", half: true, show: (v) => !["INTERRUPTION", "RESUMPTION"].includes(v.kind) }, { name: "netAfter", label: "New net per payment", kind: "money", half: true, show: (v) => !["INTERRUPTION", "RESUMPTION"].includes(v.kind) }, { name: "note", label: "Note", kind: "textarea" }]} initial={{ kind: "SALARY_INCREASE", effectiveDate: new Date().toISOString().slice(0, 10) }} onSubmit={(v) => chM.mutateAsync({ id: change.id, kind: v.kind, effectiveDate: v.effectiveDate, grossAfter: v.grossAfter || undefined, netAfter: v.netAfter || undefined, pausedUntil: v.pausedUntil || null, note: v.note || null })} />
    </div>
  );
}

