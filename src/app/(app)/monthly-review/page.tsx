"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Button, Checkbox, Select } from "@/components/ui/primitives";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Figure, NeedsHousehold, PageHeader, Section } from "@/components/finance/ui";

export default function ReviewPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view: global } = useFin();
  const sp = useSearchParams();
  const [view, setView] = React.useState<"my" | "household">(global === "household" ? "household" : "my");
  const [month, setMonth] = React.useState(sp.get("month") ?? "");
  const params = { view, ...(month ? { month } : {}) };
  const { data: r, isLoading } = useFinQuery<any>("/monthly-review", params);
  const { data: st } = useFinQuery<any>("/monthly-review/settings");
  const [note, setNote] = React.useState<string | null>(null);
  const send = useFinMutation<any, any>("POST", `/monthly-review/email?view=${view}${month ? `&month=${month}` : ""}`, { onSuccess: (x) => setNote(x.note) });
  const toggle = useFinMutation<any, any>("PUT", "/monthly-review/settings", { success: "Saved" });
  const months = React.useMemo(() => { const out: string[] = []; const d = new Date(); for (let i = 1; i <= 12; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); out.push(x.toISOString().slice(0, 7)); } return out; }, []);
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Tools" title="Monthly money review" description="A short look back at last month: how you did, what to watch and what is coming up." actions={<div className="flex flex-wrap gap-2"><Select aria-label="Whose" value={view} onChange={(e) => setView(e.target.value as any)} className="h-10 w-auto"><option value="my">My records</option><option value="household">Shared with the household</option></Select><Select aria-label="Month" value={month || r?.month || ""} onChange={(e) => setMonth(e.target.value)} className="h-10 w-auto">{(r?.month && !months.includes(r.month) ? [r.month, ...months] : months).map((m) => <option key={m}>{m}</option>)}</Select><Button variant="outline" loading={send.isPending} onClick={() => send.mutate({})}>Email it to me</Button></div>} />
      {note && <Alert tone="info">{note}</Alert>}
      {isLoading || !r ? <div className="skeleton h-64 w-full" /> : (
        <>
          <section className="hero-card rounded-xl p-6" aria-label="Summary"><h2 className="mb-2 text-sm uppercase tracking-widest text-white/60">{r.label}</h2><ul className="space-y-2 text-lg">{r.highlights.map((h: string) => <li key={h}>{h}</li>)}</ul></section>
          <section className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-4" aria-label="Totals">
            <Figure label="Income" value={<span className="text-2xl money">{fmt.money(r.totals.income)}</span>} />
            <Figure label="Spending" value={<span className="text-2xl money">{fmt.money(r.totals.expenses)}</span>} hint={`Month before: ${fmt.money(r.previous.totals.expenses)}`} />
            <Figure label="Net" value={<span className="text-2xl money">{fmt.money(r.totals.netCashFlow)}</span>} />
            <Figure label="Goals" value={<span className="text-2xl">{r.goals.onTrack} of {r.goals.active}</span>} hint="on track" />
          </section>
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <Section title="Where it went"><ul className="divide-y divide-border text-sm">{r.topCategories.map((c: any) => <li key={c.name} className="flex justify-between py-1.5"><span>{c.name}</span><span className="money">{fmt.money(c.amount)}</span></li>)}</ul></Section>
            <Section title="Biggest purchases"><ul className="divide-y divide-border text-sm">{r.biggestExpenses.map((b: any, i: number) => <li key={i} className="flex justify-between gap-3 py-1.5"><span className="truncate">{b.description} <span className="text-xs text-muted-foreground">{fmt.date(b.date)}</span></span><span className="money">{fmt.money(b.amount)}</span></li>)}</ul></Section>
            {r.budgetsTight.length > 0 && <Section title="Budgets to watch"><ul className="divide-y divide-border text-sm">{r.budgetsTight.map((t: any, i: number) => <li key={i} className="flex justify-between py-1.5"><span>{t.category}</span><span className={t.over ? "text-danger" : ""}>{t.percentUsed}%</span></li>)}</ul></Section>}
            <Section title="Coming up"><ul className="divide-y divide-border text-sm">{r.upcoming.length ? r.upcoming.map((u: any, i: number) => <li key={i} className="flex justify-between gap-3 py-1.5"><span>{u.title} <span className="text-xs text-muted-foreground">{fmt.date(u.date)}</span></span><span className="money">{fmt.money(String(Math.abs(Number(u.amount))))}</span></li>) : <li className="py-1.5 text-muted-foreground">Nothing due in the next month.</li>}</ul></Section>
          </div>
          <Section title="Get it by email each month" description="Off unless you turn it on. It is sent on the first days of the month to your own address and covers only records you own."><Checkbox checked={!!st?.monthlyReview} onChange={(e) => toggle.mutate({ monthlyReview: e.target.checked })} label="Email me my monthly review" />{st?.lastSent && <p className="mt-2 text-xs text-muted-foreground">Last sent for {st.lastSent}.</p>}</Section>
        </>
      )}
    </div>
  );
}
