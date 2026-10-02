"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { NeedsHousehold, Notice, PageHeader, Section } from "@/components/finance/ui";

export function FinanceReports() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { hid, fmt, profile } = useFin();
  const types = useFinQuery<any[]>("/reports");
  const [type, setType] = React.useState("cash-flow");
  const [view, setView] = React.useState<"my" | "household">("household");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [year, setYear] = React.useState(String((profile?.today ?? new Date().toISOString()).slice(0, 4)));
  const t = types.data?.find((x) => x.type === type);
  const params: Record<string, string> = { type, view };
  if (type === "annual-summary") params.year = year; else { if (from) params.from = from; if (to) params.to = to; }
  const { data, isLoading, error } = useFinQuery<any>("/reports/run", { ...params, format: "json" }, { enabled: !!types.data });
  const link = (f: string) => `/api/finance/${hid}/reports/run?${new URLSearchParams({ ...params, format: f }).toString()}`;
  const cell = (c: any, v: any) => (v === null || v === undefined || v === "" ? "n/a" : c.format === "money" ? fmt.money(v) : c.format === "percent" ? fmt.pct(v) : String(v));
  return (
    <div>
      <PageHeader eyebrow="Reports" title="Reports and exports" description="Every report respects your privacy settings. Download as PDF, Excel or CSV." />
      <Section>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Report" className="lg:col-span-2">{(p) => <Select id={p.id} value={type} onChange={(e) => setType(e.target.value)}>{(types.data ?? []).map((r) => <option key={r.type} value={r.type}>{r.label}</option>)}</Select>}</Field>
          <Field label="Scope">{(p) => <Select id={p.id} value={view} onChange={(e) => setView(e.target.value as any)}><option value="household">Household Finances</option><option value="my">My Finances</option></Select>}</Field>
          {type === "annual-summary" ? <Field label="Year">{(p) => <Input id={p.id} type="number" value={year} onChange={(e) => setYear(e.target.value)} />}</Field> : (
            <div className="grid grid-cols-2 gap-2"><Field label="From">{(p) => <Input id={p.id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field><Field label="To">{(p) => <Input id={p.id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field></div>
          )}
        </div>
        {t && <p className="mt-3 text-sm text-muted-foreground">{t.description}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {[["pdf", "PDF"], ["xlsx", "Excel"], ["csv", "CSV"]].map(([f, l]) => <a key={f} href={link(f)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" aria-hidden />{l}</a>)}
        </div>
      </Section>
      <div className="mt-5">
        {error && <Notice tone="danger">{(error as Error).message}</Notice>}
        {isLoading && <div className="skeleton h-40 w-full" aria-hidden />}
        {data && (
          <Section title={data.title} description={data.subtitle} flush>
            {data.summary.length > 0 && <div className="grid grid-cols-2 gap-4 px-5 pb-4 sm:grid-cols-4">{data.summary.map((s: any) => <div key={s.label}><p className="text-xs text-muted-foreground">{s.label}</p><p className="money text-lg">{fmt.money(s.value)}</p></div>)}</div>}
            <div className="overflow-x-auto px-1">
              <table className="w-full min-w-[560px] text-sm"><caption className="sr-only">{data.title}</caption>
                <thead><tr className="border-b border-border text-left text-xs text-muted-foreground">{data.columns.map((c: any) => <th key={c.key} scope="col" className={`px-4 py-2 font-medium ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>)}</tr></thead>
                <tbody>{data.rows.slice(0, 200).map((r: any, i: number) => <tr key={i} className="border-b border-border/60 last:border-0">{data.columns.map((c: any) => <td key={c.key} className={`px-4 py-2 ${c.align === "right" ? "money text-right" : ""}`}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
              </table>
              {data.rows.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">No data for this period.</p>}
              {data.rows.length > 200 && <p className="px-4 py-3 text-xs text-muted-foreground">Showing 200 of {data.rows.length} rows. Download the full report above.</p>}
            </div>
            <ul className="space-y-1 px-5 py-4 text-xs text-muted-foreground">{data.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
          </Section>
        )}
      </div>
    </div>
  );
}
