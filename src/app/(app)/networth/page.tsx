"use client";
import * as React from "react";
import { Alert, Button } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { ChartCard, Lines, StackedBars } from "@/components/ui/charts";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, Figure, Money, NeedsHousehold, Notice, PageHeader, Section, ViewNote, ViewSwitch, VisibilityBadge, humanize, type FieldDef } from "@/components/finance/ui";

const GROUP_LABEL: Record<string, string> = { cash: "Cash and chequing", savings: "Savings", investments: "Investments", property: "Property", vehicles: "Vehicles", other_assets: "Other assets", credit_cards: "Credit cards", lines_of_credit: "Lines of credit", mortgages: "Mortgages", loans: "Loans", other_liabilities: "Other liabilities" };
export default function NetWorthPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view } = useFin();
  const confirm = useConfirm();
  const [months, setMonths] = React.useState(12);
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [val, setVal] = React.useState<any | null>(null);
  const { data: n } = useFinQuery<any>("/networth", { view, months });
  const { data: assets } = useFinQuery<any>("/assets", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/assets", { success: "Asset added" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/assets/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/assets/${b.id}`, { success: "Removed" });
  const addVal = useFinMutation<any, any>("POST", (b) => `/assets/${b.id}/valuations`, { success: "Valuation saved" });
  const fields: FieldDef[] = [
    { name: "name", label: "Name", required: true },
    { name: "kind", label: "Kind", kind: "select", options: [["PROPERTY", "Property"], ["VEHICLE", "Vehicle"], ["VALUABLE", "Valuable item"], ["OTHER", "Other"]], half: true },
    { name: "currentValue", label: "Current value", kind: "money", required: true, half: true },
    { name: "valuationDate", label: "Valuation date", kind: "date", half: true },
    { name: "valuationSource", label: "Valuation source", half: true, placeholder: "e.g. appraisal, online estimate" },
    { name: "address", label: "Address or description", show: (v) => v.kind === "PROPERTY" },
    { name: "purchasePrice", label: "Purchase price", kind: "money", half: true, show: (v) => v.kind === "PROPERTY" },
    { name: "purchaseDate", label: "Purchase date", kind: "date", half: true, show: (v) => v.kind === "PROPERTY" },
    { name: "annualPropertyTax", label: "Annual property tax", kind: "money", half: true, show: (v) => v.kind === "PROPERTY" },
    { name: "notes", label: "Notes", kind: "textarea" },
  ];
  const assetsLines = n?.groups.filter((g: any) => g.side === "asset") ?? [];
  const liabLines = n?.groups.filter((g: any) => g.side === "liability") ?? [];
  return (
    <div>
      <PageHeader eyebrow="Wealth" title="Net worth" description="Net worth is total assets minus total liabilities. Every account and asset is counted once." actions={<><ViewSwitch className="lg:hidden" /><Add label="Add asset" onClick={() => setEdit("new")} /></>} />
      <ViewNote />
      {n && (
        <>
          <section className="hero-card mb-6 rounded-xl p-5 sm:p-7" aria-label="Net worth">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">{view === "household" ? "Household" : "Personal"} net worth as of {fmt.date(n.asOf)}</p>
            <p className="display mt-1 text-5xl money sm:text-6xl">{fmt.money(n.netWorth)}</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 sm:grid-cols-4">
              {[["Assets", fmt.money(n.assets)], ["Liabilities", fmt.money(n.liabilities)], ["Month over month", n.monthOverMonth ? `${fmt.money(n.monthOverMonth.change, { sign: true })}${n.monthOverMonth.percent ? ` (${n.monthOverMonth.percent}%)` : ""}` : "n/a"], ["Year over year", n.yearOverYear ? `${fmt.money(n.yearOverYear.change, { sign: true })}${n.yearOverYear.percent ? ` (${n.yearOverYear.percent}%)` : ""}` : "n/a"]].map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">{k}</dt><dd className="mt-0.5 text-lg money">{v}</dd></div>)}
            </dl>
          </section>
          {n.unconverted.length > 0 && <div className="mb-4"><Alert tone="warning">No exchange rate is set for {n.unconverted.join(", ")}, so they are left out. Add a rate under Household settings.</Alert></div>}
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <ChartCard title="Net worth history" unit={fmt.currency} data={n.history} columns={[{ key: "month", label: "Month" }, { key: "netWorth", label: "Net worth" }]} action={<select aria-label="History length" className="h-8 rounded-md border border-input bg-card px-2 text-xs" value={months} onChange={(e) => setMonths(Number(e.target.value))}>{[6, 12, 24, 36].map((m) => <option key={m} value={m}>{m} months</option>)}</select>}>
              <Lines area data={n.history.map((h: any) => ({ m: fmt.month(h.month), "Net worth": Number(h.netWorth) }))} xKey="m" series={[{ key: "Net worth", label: "Net worth" }]} fmt={(v) => fmt.money(v)} />
            </ChartCard>
            <ChartCard title="Assets and liabilities" unit={fmt.currency} data={n.history} columns={[{ key: "month", label: "Month" }, { key: "assets", label: "Assets" }, { key: "liabilities", label: "Liabilities" }]}>
              <Lines data={n.history.map((h: any) => ({ m: fmt.month(h.month), Assets: Number(h.assets), Liabilities: Number(h.liabilities) }))} xKey="m" series={[{ key: "Assets", label: "Assets" }, { key: "Liabilities", label: "Liabilities" }]} fmt={(v) => fmt.money(v)} />
            </ChartCard>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {[["Assets", "asset", assetsLines], ["Liabilities", "liability", liabLines]].map(([title, side, groups]: any) => (
              <Section key={title} title={title} flush>
                {groups.length === 0 ? <p className="p-5 text-sm text-muted-foreground">None recorded.</p> : groups.map((g: any) => (
                  <details key={g.group} className="border-b border-border last:border-0" open>
                    <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium"><span>{GROUP_LABEL[g.group] ?? humanize(g.group)}</span><span className="money">{fmt.money(g.value)}</span></summary>
                    <ul className="pb-2">{n.lines.filter((l: any) => l.group === g.group && l.side === side).map((l: any) => <li key={l.id} className="flex items-center justify-between px-5 py-1.5 pl-8 text-sm text-muted-foreground"><span>{l.name}{l.valuedOn ? <span className="ml-1 text-xs">(valued {fmt.date(l.valuedOn)})</span> : null}</span><span className="money">{fmt.money(l.value, { currency: l.currency })}</span></li>)}</ul>
                  </details>
                ))}
              </Section>
            ))}
          </div>
          <ul className="mt-4 list-disc pl-5 text-xs text-muted-foreground">{n.notes.map((x: string) => <li key={x}>{x}</li>)}</ul>
        </>
      )}
      <Section className="mt-8" title="Property, vehicles and other assets" description="Update valuations manually. Each valuation keeps its date and source." flush>
        {assets?.items.length === 0 ? <div className="p-5"><EmptyState title="No assets recorded" description="Add your home, vehicles and other valuable items." action={<Button onClick={() => setEdit("new")}>Add an asset</Button>} /></div> : (
          <ul className="divide-y divide-border">{assets?.items.map((a: any) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><div className="min-w-0"><p className="font-medium">{a.name}{a.soldOn ? " (sold)" : ""}</p><p className="text-xs text-muted-foreground">{humanize(a.kind)} · valued {fmt.date(a.valuationDate)}{a.valuationSource ? ` · ${a.valuationSource}` : ""}</p></div><div className="flex items-center gap-3"><VisibilityBadge visibility={a.visibility} /><span className="money">{fmt.money(a.currentValue, { currency: a.currency })}</span>{a.canEdit && <><Button size="sm" variant="outline" onClick={() => setVal(a)}>Update value</Button><Button size="sm" variant="ghost" onClick={() => setEdit(a)}>Edit</Button></>}</div></li>)}</ul>
        )}
      </Section>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add an asset" : `Edit ${edit?.name ?? ""}`} fields={fields} visibility size="lg" initial={edit && edit !== "new" ? { ...edit, ...(edit.details ?? {}) } : { kind: "PROPERTY", valuationDate: new Date().toISOString().slice(0, 10) }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this asset?", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const details: any = { address: v.address || undefined, purchasePrice: v.purchasePrice || undefined, purchaseDate: v.purchaseDate || undefined, annualPropertyTax: v.annualPropertyTax || undefined }; const body: any = { name: v.name, kind: v.kind, details, notes: v.notes || null, valuationSource: v.valuationSource || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync({ ...body, currentValue: v.currentValue, valuationDate: v.valuationDate || undefined }) : upd.mutateAsync({ id: edit.id, ...body }); }} />
      <FormModal open={!!val} onClose={() => setVal(null)} title={`Update value: ${val?.name ?? ""}`} fields={[{ name: "value", label: "New value", kind: "money", required: true, half: true }, { name: "date", label: "Valuation date", kind: "date", required: true, half: true }, { name: "source", label: "Source", placeholder: "e.g. appraisal, listing, guide" }]} initial={{ value: val?.currentValue ?? "", date: new Date().toISOString().slice(0, 10), source: "" }} onSubmit={(v) => addVal.mutateAsync({ id: val.id, value: v.value, date: v.date, source: v.source || null })} />
    </div>
  );
}
