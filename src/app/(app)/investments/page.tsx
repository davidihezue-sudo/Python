"use client";
import * as React from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { ChartCard, Donut, Lines } from "@/components/ui/charts";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { DataTable, FormModal, Figure, Money, NeedsHousehold, Notice, PageHeader, Section, ViewNote, humanize, type Col } from "@/components/finance/ui";
import Link from "next/link";

export default function InvestmentsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt } = useFin();
  const [sel, setSel] = React.useState<any | null>(null);
  const { data, isLoading } = useFinQuery<any>("/investments", { view: "all" });
  const cols: Col<any>[] = [
    { key: "n", header: "Account", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.name}</span><span className="text-xs text-muted-foreground">{humanize(r.kind)}{r.institution ? ` · ${r.institution}` : ""}{r.owner ? ` · ${r.owner}` : ""}</span></span> },
    { key: "c", header: "Contributions", hideOnMobile: true, align: "right", cell: (r) => <Money value={r.contributions} /> },
    { key: "w", header: "Withdrawals", hideOnMobile: true, align: "right", cell: (r) => <Money value={r.withdrawals} /> },
    { key: "ch", header: "Change in value", align: "right", cell: (r) => <Money value={r.changeInValue} delta /> },
    { key: "v", header: "Market value", align: "right", cell: (r) => <span className="flex flex-col items-end"><Money value={r.currentValue} /><span className="text-[11px] text-muted-foreground">{r.valuedOn ? `valued ${fmt.date(r.valuedOn)}` : "not valued"}</span></span> },
  ];
  return (
    <div>
      <PageHeader eyebrow="Wealth" title="Investments and retirement" description="Track registered and other accounts by recording contributions and manual valuations." actions={<Link href="/accounts" className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted">Add an investment account</Link>} />
      <ViewNote />
      <div className="mb-5"><Notice>Values are entered by you. This app does not fetch live market prices and does not project investment returns. Each value shows the date it was last updated.</Notice></div>
      {data && <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-4" aria-label="Investment totals"><Figure label="Total value" value={data.totals.totalValue} /><Figure label="Contributions" value={data.totals.contributions} size="md" /><Figure label="Withdrawals" value={data.totals.withdrawals} size="md" /><Figure label="Change in value" value={<Money value={data.totals.changeInValue} delta size="lg" />} hint="Value minus net contributions" /></section>}
      <Section flush><DataTable cols={cols} rows={data?.items} loading={isLoading} caption="Investment accounts" onRow={setSel} empty={<EmptyState title="No investment accounts" description="Add an account of type Investment on the Accounts page (TFSA, RRSP, FHSA, RESP, non-registered and more)." />} /></Section>
      {data && data.history.length > 1 && <div className="mt-6 grid gap-6 lg:grid-cols-2"><ChartCard title="Value over time" unit={fmt.currency} data={data.history} columns={[{ key: "date", label: "Date" }, { key: "value", label: "Value" }]}><Lines area data={data.history.map((h: any) => ({ d: h.date, Value: Number(h.value) }))} xKey="d" series={[{ key: "Value", label: "Total value" }]} fmt={(v) => fmt.money(v)} xFmt={(v) => fmt.date(v)} /></ChartCard>{data.allocation.length > 0 && <ChartCard title="Allocation" unit={fmt.currency} data={data.allocation} columns={[{ key: "assetClass", label: "Class" }, { key: "value", label: "Value" }]}><Donut data={data.allocation.map((a: any) => ({ name: a.assetClass, value: Number(a.value) }))} nameKey="name" valueKey="value" fmt={(v) => fmt.money(v)} /></ChartCard>}</div>}
      {sel && <InvModal inv={sel} onClose={() => setSel(null)} />}
    </div>
  );
}
function InvModal({ inv, onClose }: { inv: any; onClose: () => void }) {
  const { fmt } = useFin();
  const [mode, setMode] = React.useState<null | "entry" | "value">(null);
  const entry = useFinMutation<any, any>("POST", `/investments/${inv.id}/entries`, { success: "Recorded" });
  const val = useFinMutation<any, any>("POST", `/investments/${inv.id}/valuations`, { success: "Valuation saved" });
  const delE = useFinMutation<any, any>("DELETE", (b) => `/investments/${inv.id}/entries/${b.id}`, { success: "Entry removed" });
  return (
    <>
      <Modal open={!mode} onClose={onClose} title={inv.name} description={`${humanize(inv.kind)}${inv.investmentType ? ` · ${inv.investmentType}` : ""}`} size="lg" footer={<><Button variant="outline" onClick={() => setMode("entry")}>Record contribution or withdrawal</Button><Button onClick={() => setMode("value")}>Update value</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4"><Figure label="Market value" value={inv.currentValue} hint={inv.valuationNote} /><Figure label="Contributions" value={inv.contributions} size="md" /><Figure label="Investment income" value={inv.investmentIncome} size="md" /><Figure label="Fees" value={inv.fees} size="md" /></div>
          <div><h3 className="mb-1 text-sm font-medium">Valuation history</h3><ul className="divide-y divide-border rounded-lg border border-border">{inv.valuations.slice(0, 12).map((v: any) => <li key={v.id} className="flex justify-between px-3 py-2 text-sm"><span>{fmt.date(v.date)} <span className="text-xs text-muted-foreground">{v.source}</span></span><span className="money">{fmt.money(v.value)}</span></li>)}</ul></div>
          <div><h3 className="mb-1 text-sm font-medium">Recent entries</h3><ul className="divide-y divide-border rounded-lg border border-border">{inv.entries.slice(0, 12).map((e: any) => <li key={e.id} className="flex items-center justify-between px-3 py-2 text-sm"><span>{fmt.date(e.date)} · {humanize(e.kind)}{e.note ? <span className="text-muted-foreground"> · {e.note}</span> : null}</span><span className="flex items-center gap-2"><span className="money">{fmt.money(e.amount)}</span><Button size="sm" variant="ghost" aria-label="Remove entry" onClick={() => delE.mutate({ id: e.id })}>Remove</Button></span></li>)}{inv.entries.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No entries yet.</li>}</ul></div>
        </div>
      </Modal>
      <FormModal open={mode === "entry"} onClose={() => setMode(null)} title="Record an entry" description="Contributions and withdrawals can move money from or to another account as a transfer." fields={[{ name: "kind", label: "Type", kind: "select", options: [["CONTRIBUTION", "Contribution"], ["WITHDRAWAL", "Withdrawal"], ["INCOME", "Investment income"], ["FEE", "Fee"]], half: true }, { name: "amount", label: "Amount", kind: "money", required: true, half: true }, { name: "date", label: "Date", kind: "date", required: true, half: true }, { name: "fromAccountId", label: "Other account (optional)", kind: "account", includeNone: "Do not move money in the ledger", half: true, show: (v) => v.kind === "CONTRIBUTION" || v.kind === "WITHDRAWAL" }, { name: "note", label: "Note", kind: "textarea" }]} initial={{ kind: "CONTRIBUTION", date: new Date().toISOString().slice(0, 10), fromAccountId: "" }} onSubmit={(v) => entry.mutateAsync({ kind: v.kind, amount: v.amount, date: v.date, fromAccountId: v.fromAccountId || null, note: v.note || null })} />
      <FormModal open={mode === "value"} onClose={() => setMode(null)} title="Update market value" description="Enter the value from your latest statement. The date is shown wherever this value appears." fields={[{ name: "marketValue", label: "Market value", kind: "money", required: true, half: true }, { name: "date", label: "As of", kind: "date", required: true, half: true }, { name: "source", label: "Source", placeholder: "e.g. statement, app balance" }]} initial={{ date: new Date().toISOString().slice(0, 10), marketValue: inv.currentValue ?? "", source: "manual" }} onSubmit={(v) => val.mutateAsync({ date: v.date, marketValue: v.marketValue, source: v.source || "manual" })} />
    </>
  );
}
