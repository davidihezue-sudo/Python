"use client";
import * as React from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/dialog";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, MemberChip, Money, NeedsHousehold, PageHeader, Section, ViewNote, humanize, type Col } from "@/components/finance/ui";
import { TransactionList } from "@/components/finance/transaction-list";
import { useTxDialog } from "@/components/finance/transaction-form";
import { Donut, Lines, StackedBars, ChartCard } from "@/components/ui/charts";
import { EmptyState } from "@/components/ui/empty";

export default function SpendingPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const [tab, setTab] = React.useState("list");
  return (
    <div>
      <PageHeader eyebrow="Spending" title="Expenses" description="Record expenses once. Choose who paid and who they are for, and every report counts them correctly." />
      <Tabs label="Expense sections" value={tab} onChange={setTab} tabs={[{ key: "list", label: "Expenses" }, { key: "expected", label: "Expected" }, { key: "recurring", label: "Recurring" }, { key: "analysis", label: "Analysis" }]} />
      <div className="pt-5">
        <TabPanel id="list" active={tab === "list"}><TransactionList lockedTypes="EXPENSE,REFUND,REIMBURSEMENT" initial={{ status: "POSTED" }} exportEntity="expenses" /></TabPanel>
        <TabPanel id="expected" active={tab === "expected"}><p className="mb-3 text-sm text-muted-foreground">Expected expenses are plans. They never change balances or actuals until they are posted.</p><TransactionList lockedTypes="EXPENSE" initial={{ status: "PLANNED" }} exportEntity="expenses" /></TabPanel>
        <TabPanel id="recurring" active={tab === "recurring"}><Recurring /></TabPanel>
        <TabPanel id="analysis" active={tab === "analysis"}>{tab === "analysis" && <Analysis />}</TabPanel>
      </div>
    </div>
  );
}

function Analysis() {
  const { fmt, view } = useFin();
  const [scope, setScope] = React.useState<string>(view);
  const { data } = useFinQuery<any>("/analytics", { scope: scope === "my" ? "my" : "household" });
  const { data: members } = useFinQuery<any>("/members");
  if (!data) return <div className="skeleton h-64 w-full" />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><label className="text-sm">Show <select className="ml-1 h-9 rounded-md border border-input bg-card px-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Scope"><option value="my">My spending</option><option value="household">Household spending</option></select></label><span className="text-xs text-muted-foreground">{fmt.date(data.from)} to {fmt.date(data.to)}</span></div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Spending by month" unit={fmt.currency} data={data.series} columns={[{ key: "month", label: "Month" }, { key: "expenses", label: "Expenses" }]}>
          <StackedBars data={data.series.map((s: any) => ({ month: fmt.month(s.month), Expenses: Number(s.expenses) }))} xKey="month" series={[{ key: "Expenses", label: "Expenses" }]} fmt={(v) => fmt.money(v)} />
        </ChartCard>
        <ChartCard title="By category" unit={fmt.currency} data={data.byCategory} columns={[{ key: "name", label: "Category" }, { key: "amount", label: "Amount" }]}>
          <Donut data={data.byCategory.slice(0, 8).map((c: any) => ({ name: c.name, value: Number(c.amount) }))} nameKey="name" valueKey="value" fmt={(v) => fmt.money(v)} />
        </ChartCard>
      </div>
      <Section title="Spending patterns" description="Compared with the previous period of the same length">
        <dl className="grid gap-4 sm:grid-cols-3">
          {(["income", "expenses", "net"] as const).map((k) => <div key={k}><dt className="text-xs uppercase tracking-wide text-muted-foreground">{humanize(k)}</dt><dd className="mt-1 text-xl money">{fmt.money(data.comparison[k].current)}</dd><p className="text-xs text-muted-foreground">Previous {fmt.money(data.comparison[k].previous)} ({data.comparison[k].changePct ? `${data.comparison[k].changePct}%` : "n/a"})</p></div>)}
        </dl>
      </Section>
    </div>
  );
}

const recurringFields = (members: any[]) => [
  { name: "description", label: "Description", required: true },
  { name: "type", label: "Type", kind: "select" as const, options: [["EXPENSE", "Expense"], ["INCOME", "Income"], ["TRANSFER", "Transfer"]] as [string, string][], half: true },
  { name: "amount", label: "Amount", kind: "money" as const, required: true, half: true },
  { name: "accountId", label: "Account", kind: "account" as const, required: true, half: true },
  { name: "toAccountId", label: "Transfer to", kind: "account" as const, show: (v: any) => v.type === "TRANSFER", half: true },
  { name: "categoryId", label: "Category", kind: "category" as const, show: (v: any) => v.type !== "TRANSFER", half: true },
  { name: "frequency", label: "How often", kind: "frequency" as const, half: true },
  { name: "startDate", label: "First date", kind: "date" as const, required: true, half: true },
  { name: "endDate", label: "Ends (optional)", kind: "date" as const, half: true },
  { name: "autoPost", label: "", kind: "checkbox" as const, hint: "Post automatically when due (otherwise it only appears in forecasts and the calendar)" },
];
function Recurring() {
  const { fmt, view } = useFin();
  const confirm = useConfirm();
  const [edit, setEdit] = React.useState<any | null | "new">(null);
  const { data } = useFinQuery<any[]>("/recurring", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/recurring", { success: "Saved" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/recurring/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/recurring/${b.id}`, { success: "Removed" });
  const post = useFinMutation<any, any>("POST", (b) => `/recurring/${b.id}/post`, { success: "Posted due occurrences" });
  const cols: Col<any>[] = [
    { key: "d", header: "Description", primary: true, cell: (r) => <span className="font-medium">{r.description}</span> },
    { key: "t", header: "Type", cell: (r) => humanize(r.type) },
    { key: "f", header: "Frequency", cell: (r) => humanize(r.frequency) },
    { key: "n", header: "Next", cell: (r) => fmt.date(r.nextDate) },
    { key: "o", header: "Owner", hideOnMobile: true, cell: (r) => <MemberChip member={r.owner} /> },
    { key: "a", header: "Amount", align: "right", cell: (r) => <Money value={r.type === "EXPENSE" ? `-${r.amount}` : r.amount} /> },
    { key: "x", header: "", align: "right", cell: (r) => <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>{r.canEdit && <><Button size="sm" variant="ghost" aria-label="Post due occurrences" onClick={() => post.mutate({ id: r.id })}>Post due</Button><Button size="sm" variant="ghost" aria-label={r.active ? "Pause" : "Resume"} onClick={() => upd.mutate({ id: r.id, active: !r.active })}>{r.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button><Button size="sm" variant="ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: "Remove this recurring item?", confirmLabel: "Remove", tone: "danger" })) del.mutate({ id: r.id }); }}><Trash2 className="h-4 w-4" /></Button></>}</span> },
  ];
  return (
    <Section title="Recurring items" description="Rent, subscriptions and regular transfers that repeat on a schedule." action={<Add label="Add recurring item" onClick={() => setEdit("new")} />} flush>
      <DataTable cols={cols} rows={data} caption="Recurring items" onRow={(r) => r.canEdit && setEdit(r)} empty={<EmptyState title="No recurring items" description="Add something that repeats so the forecast and calendar know about it." />} />
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "New recurring item" : "Edit recurring item"} fields={recurringFields([])} visibility initial={edit && edit !== "new" ? { ...edit } : { type: "EXPENSE", frequency: "MONTHLY", startDate: new Date().toISOString().slice(0, 10), autoPost: false }} onSubmit={async (v) => { const body = { description: v.description, type: v.type, amount: v.amount, accountId: v.accountId, toAccountId: v.type === "TRANSFER" ? v.toAccountId : null, categoryId: v.categoryId || null, frequency: v.frequency, startDate: v.startDate, endDate: v.endDate || null, autoPost: !!v.autoPost, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
    </Section>
  );
}
