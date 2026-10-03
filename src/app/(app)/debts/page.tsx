"use client";
import * as React from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { ChartCard, Lines } from "@/components/ui/charts";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, ProgressBar, Section, ViewNote, VisibilityBadge, humanize, type Col, type FieldDef } from "@/components/finance/ui";

const TYPES: [string, string][] = [["CREDIT_CARD", "Credit card"], ["PERSONAL_LOAN", "Personal loan"], ["LINE_OF_CREDIT", "Line of credit"], ["VEHICLE_LOAN", "Vehicle loan"], ["STUDENT_LOAN", "Student loan"], ["MORTGAGE", "Mortgage"], ["OTHER", "Other liability"]];
export default function DebtsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite } = useFin();
  const [tab, setTab] = React.useState("debts");
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [sel, setSel] = React.useState<any | null>(null);
  const { data, isLoading } = useFinQuery<any>("/debts", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/debts", { success: "Debt added" });
  const fields: FieldDef[] = [
    { name: "lender", label: "Lender", required: true, half: true },
    { name: "name", label: "Name (optional)", half: true, placeholder: "e.g. Visa, Car loan" },
    { name: "type", label: "Debt type", kind: "select", options: TYPES, half: true },
    { name: "originalAmount", label: "Original amount", kind: "money", required: true, half: true },
    { name: "outstandingBalance", label: "Outstanding balance now", kind: "money", required: true, half: true },
    { name: "interestRate", label: "Interest rate (% a year)", kind: "number", half: true },
    { name: "creditLimit", label: "Credit limit", kind: "money", half: true, show: (v) => v.type === "CREDIT_CARD" || v.type === "LINE_OF_CREDIT" },
    { name: "minimumPayment", label: "Minimum payment", kind: "money", half: true },
    { name: "regularPayment", label: "Regular payment", kind: "money", half: true },
    { name: "frequency", label: "Payment frequency", kind: "frequency", half: true },
    { name: "nextDueDate", label: "Next due date", kind: "date", half: true },
    { name: "startDate", label: "Start date", kind: "date", half: true },
    { name: "termMonths", label: "Term (months)", kind: "number", half: true },
    { name: "maturityDate", label: "Maturity date", kind: "date", half: true },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const cols: Col<any>[] = [
    { key: "n", header: "Debt", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{humanize(r.type)} · {r.lender}</span></span> },
    { key: "o", header: "Owner", cell: (r) => <MemberChip member={r.owner} fallback="Joint" /> },
    { key: "r", header: "Rate", hideOnMobile: true, align: "right", cell: (r) => fmt.pct(r.interestRate, 2) },
    { key: "p", header: "Payment", hideOnMobile: true, align: "right", cell: (r) => <span className="flex flex-col items-end"><Money value={r.regularPayment} /><span className="text-[11px] text-muted-foreground">{humanize(r.frequency)}</span></span> },
    { key: "pr", header: "Repaid", cell: (r) => <div className="w-24"><ProgressBar value={Number(r.repaidPercent ?? 0)} label={`${r.name} repaid`} /><span className="text-[11px] text-muted-foreground">{r.repaidPercent ? `${r.repaidPercent}%` : "0%"}</span></div> },
    { key: "d", header: "Payoff", hideOnMobile: true, cell: (r) => (r.projection?.paidOff ? fmt.date(r.projection.payoffDate) : r.projection ? <span className="text-warning">Not on track</span> : "n/a") },
    { key: "b", header: "Owed", align: "right", cell: (r) => <Money value={r.outstanding} currency={r.currency} /> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Debt" title="Debt" description="Outstanding balances come from each debt's ledger account. Repayments split into principal and interest automatically." actions={<Add label="Add debt" onClick={() => setEdit("new")} />} />
      <ViewNote />
      {data && <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-4" aria-label="Debt totals"><Figure label="Total debt" value={data.totals.totalDebt} /><Figure label="Monthly payments" value={data.totals.monthlyPayments} /><Figure label="Interest paid" value={data.totals.interestPaid} size="md" hint="Recorded payments" /><Figure label="Principal repaid" value={data.totals.principalPaid} size="md" hint="Recorded payments" /></section>}
      {(data?.items ?? []).filter((d: any) => Number(d.outstanding) <= 0 && Number(d.repaidPercent ?? 0) >= 100).map((d: any) => (
        <div key={d.id} role="status" className="mb-3 rounded-xl border border-success/40 bg-success/10 p-4 text-sm"><p className="font-semibold text-success">Paid off: {d.name}</p><p className="text-muted-foreground">You cleared this debt{Number(d.interestPaid) > 0 ? ` and paid ${fmt.money(d.interestPaid)} in interest along the way` : ""}. Redirect its old payment to savings or the next debt.</p></div>
      ))}
      <Tabs label="Debt sections" value={tab} onChange={setTab} tabs={[{ key: "debts", label: "Debts" }, { key: "strategy", label: "Repayment strategies" }]} />
      <div className="pt-5">
        <TabPanel id="debts" active={tab === "debts"}><Section flush><DataTable cols={cols} rows={data?.items.filter((d: any) => d.active)} loading={isLoading} caption="Debts" onRow={setSel} empty={<EmptyState title="No debts recorded" description="Add credit cards, loans, lines of credit and your mortgage to see balances, interest and a payoff date." action={canWrite ? <Button onClick={() => setEdit("new")}>Add a debt</Button> : undefined} />} /></Section></TabPanel>
        <TabPanel id="strategy" active={tab === "strategy"}>{tab === "strategy" && <Strategies />}</TabPanel>
      </div>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title="Add a debt" fields={fields} visibility size="lg" initial={{ type: "CREDIT_CARD", interestRate: "0", frequency: "MONTHLY", minimumPayment: "0.00", regularPayment: "0.00" }} onSubmit={(v) => create.mutateAsync({ lender: v.lender, name: v.name || undefined, type: v.type, originalAmount: v.originalAmount, outstandingBalance: v.outstandingBalance, interestRate: String(v.interestRate || 0), creditLimit: v.creditLimit || null, minimumPayment: v.minimumPayment || "0.00", regularPayment: v.regularPayment || v.minimumPayment || "0.00", frequency: v.frequency, nextDueDate: v.nextDueDate || null, startDate: v.startDate || null, termMonths: v.termMonths ? Number(v.termMonths) : null, maturityDate: v.maturityDate || null, notes: v.notes || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined })} />
      {sel && <DebtModal debtId={sel.id} onClose={() => setSel(null)} />}
    </div>
  );
}

function DebtModal({ debtId, onClose }: { debtId: string; onClose: () => void }) {
  const { fmt } = useFin();
  const confirm = useConfirm();
  const { data: d } = useFinQuery<any>(`/debts/${debtId}`);
  const [extra, setExtra] = React.useState("0");
  const { data: sched } = useFinQuery<any>(`/debts/${debtId}/schedule`, { extra }, { enabled: !!d });
  const [payOpen, setPayOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const pay = useFinMutation<any, any>("POST", `/debts/${debtId}/payments`, { success: "Payment recorded" });
  const delPay = useFinMutation<any, any>("DELETE", (b) => `/debts/${debtId}/payments/${b.id}`, { success: "Payment removed" });
  const upd = useFinMutation<any, any>("PATCH", `/debts/${debtId}`, { success: "Saved" });
  if (!d) return <Modal open onClose={onClose} title="Debt"><div className="skeleton h-40 w-full" /></Modal>;
  return (
    <>
      <Modal open={!payOpen && !editOpen} onClose={onClose} title={d.name} description={`${humanize(d.type)} · ${d.lender}`} size="lg" footer={d.canEdit ? <><Button variant="outline" onClick={() => setEditOpen(true)}>Edit terms</Button><Button onClick={() => setPayOpen(true)}>Record payment</Button></> : undefined}>
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-4"><Figure label="Owed" value={d.outstanding} /><Figure label="Rate" value={<span className="text-2xl money">{fmt.pct(d.interestRate, 2)}</span>} /><Figure label="Interest paid" value={d.interestPaid} size="md" /><Figure label="Principal repaid" value={d.principalPaid} size="md" /></div>
          <ProgressBar value={Number(d.repaidPercent ?? 0)} label="Repaid" />
          <section className="rounded-lg border border-border p-4">
            <h3 className="text-sm font-medium">Payoff projection</h3>
            {sched?.current && <p className="mt-1 text-sm text-muted-foreground">{sched.current.paidOff ? <>At {fmt.money(d.regularPayment)} {humanize(d.frequency).toLowerCase()}, this is paid off around <strong className="text-foreground">{fmt.date(sched.current.payoffDate)}</strong> after {sched.current.periods} payments, with {fmt.money(sched.current.totalInterest)} of interest.</> : <span className="text-warning">{sched.current.reason ?? "No projection is available."}</span>}</p>}
            <div className="mt-3 flex flex-wrap items-end gap-3"><Field label="Add an extra amount per payment" className="w-56">{(p) => <Input {...p} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^0-9.]/g, ""))} className="money text-right" />}</Field>
              {sched?.withExtra && <p className="pb-2 text-sm">Paid off <strong>{fmt.date(sched.withExtra.payoffDate)}</strong>, {sched.withExtra.periodsSaved} payments sooner, saving <strong className="money">{fmt.money(sched.withExtra.interestSaved)}</strong> in interest.</p>}</div>
          </section>
          <div><h3 className="mb-1 text-sm font-medium">Payments</h3>
            {d.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded yet.</p> : <ul className="divide-y divide-border rounded-lg border border-border">{d.payments.map((p: any) => <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><span>{fmt.date(p.date)}{p.by ? <span className="text-muted-foreground"> · {p.by}</span> : null}</span><span className="flex items-center gap-3"><span className="text-xs text-muted-foreground">principal {fmt.money(p.principal)}, interest {fmt.money(p.interest)}</span><span className="money">{fmt.money(p.total)}</span>{d.canEdit && <Button size="sm" variant="ghost" aria-label="Remove payment" onClick={async () => { if (await confirm({ title: "Remove this payment?", description: "The balance goes back up and the related ledger entries are removed.", confirmLabel: "Remove", tone: "danger" })) delPay.mutate({ id: p.id }); }}>Remove</Button>}</span></li>)}</ul>}
          </div>
        </div>
      </Modal>
      <FormModal open={payOpen} onClose={() => setPayOpen(false)} title="Record a payment" description="Principal reduces the balance. Interest is recorded as an expense. Leave principal and interest blank to split automatically." fields={[{ name: "date", label: "Date", kind: "date", required: true, half: true }, { name: "total", label: "Total paid", kind: "money", required: true, half: true }, { name: "fromAccountId", label: "Paid from", kind: "account", required: true }, { name: "interest", label: "Interest part (optional)", kind: "money", half: true }, { name: "principal", label: "Principal part (optional)", kind: "money", half: true }, { name: "note", label: "Note", kind: "textarea" }]} initial={{ date: new Date().toISOString().slice(0, 10), total: d.regularPayment, fromAccountId: "" }} onSubmit={(v) => pay.mutateAsync({ date: v.date, total: v.total, fromAccountId: v.fromAccountId, interest: v.interest || undefined, principal: v.principal || undefined, note: v.note || null })} />
      <FormModal open={editOpen} onClose={() => setEditOpen(false)} title="Edit terms" fields={[{ name: "interestRate", label: "Interest rate (% a year)", kind: "number", half: true }, { name: "minimumPayment", label: "Minimum payment", kind: "money", half: true }, { name: "regularPayment", label: "Regular payment", kind: "money", half: true }, { name: "frequency", label: "Frequency", kind: "frequency", half: true }, { name: "nextDueDate", label: "Next due date", kind: "date", half: true }, { name: "active", label: "", kind: "checkbox", hint: "This debt is still active" }]} initial={{ interestRate: d.interestRate, minimumPayment: d.minimumPayment, regularPayment: d.regularPayment, frequency: d.frequency, nextDueDate: d.nextDueDate ?? "", active: d.active }} onSubmit={(v) => upd.mutateAsync({ interestRate: String(v.interestRate), minimumPayment: v.minimumPayment, regularPayment: v.regularPayment, frequency: v.frequency, nextDueDate: v.nextDueDate || null, active: !!v.active })} />
    </>
  );
}

function Strategies() {
  const { fmt, view } = useFin();
  const [extra, setExtra] = React.useState("200");
  const { data, isLoading } = useFinQuery<any>("/debts/strategies", { extra: extra || "0", view: "all" });
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-end gap-3"><Field label="Extra you could pay each month" className="w-60">{(p) => <Input {...p} inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value.replace(/[^0-9.]/g, ""))} className="money text-right" />}</Field><p className="pb-2 text-sm text-muted-foreground">Minimum payments are always made. The extra goes to one debt at a time.</p></div>
      {isLoading || !data ? <div className="skeleton h-48 w-full" /> : data.debts.length === 0 ? <EmptyState title="No debts to plan" description="Add debts with balances and minimum payments to compare repayment strategies." /> : (
        <>
          <Section title="Comparison" description={data.note} flush>
            <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Repayment strategy comparison</caption>
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Strategy</th><th className="px-4 py-2.5 font-medium">Debt-free</th><th className="px-4 py-2.5 text-right font-medium">Months</th><th className="px-4 py-2.5 text-right font-medium">Total interest</th><th className="px-4 py-2.5 font-medium">Payoff order</th></tr></thead>
              <tbody>{[{ ...data.minimumsOnly, strategy: "MINIMUMS" }, ...data.strategies].map((s: any) => <tr key={s.strategy} className="border-b border-border/70 last:border-0"><td className="px-4 py-3 font-medium">{s.strategy === "MINIMUMS" ? "Minimum payments only" : s.strategy === "AVALANCHE" ? `Avalanche (highest rate first)` : s.strategy === "SNOWBALL" ? "Snowball (smallest balance first)" : "Custom order"}</td><td className="px-4 py-3">{s.completed ? fmt.date(s.debtFreeDate) : <span className="text-warning">Not within 50 years</span>}</td><td className="px-4 py-3 text-right money">{s.months}</td><td className="px-4 py-3 text-right money">{fmt.money(s.totalInterest)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{s.payoffOrder.map((p: any) => p.name).join(" then ")}</td></tr>)}</tbody>
            </table></div>
          </Section>
          <ChartCard title="Total balance over time" unit={fmt.currency} data={data.strategies[0].timeline} columns={[{ key: "month", label: "Month" }, { key: "totalBalance", label: "Balance" }]}>
            <Lines area={false} data={mergeTimelines(data)} xKey="month" series={[{ key: "Minimums", label: "Minimum payments" }, { key: "Avalanche", label: "Avalanche" }, { key: "Snowball", label: "Snowball" }]} fmt={(v) => fmt.money(v)} xFmt={(v) => `M${v}`} />
          </ChartCard>
        </>
      )}
    </div>
  );
}
function mergeTimelines(d: any) {
  const by = new Map<number, any>();
  const add = (label: string, tl: any[]) => tl.forEach((t) => by.set(t.month, { ...(by.get(t.month) ?? { month: t.month }), [label]: Number(t.totalBalance) }));
  add("Minimums", d.minimumsOnly.timeline);
  for (const s of d.strategies) add(s.strategy === "AVALANCHE" ? "Avalanche" : s.strategy === "SNOWBALL" ? "Snowball" : "Custom", s.timeline);
  return [...by.values()].sort((a, b) => a.month - b.month);
}

