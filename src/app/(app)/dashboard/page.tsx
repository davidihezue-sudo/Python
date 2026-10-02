"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowRight, Bell, Info } from "lucide-react";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useMe } from "@/components/shell/providers";
import { useFin, useFinQuery } from "@/components/finance/provider";
import { Add, Figure, MemberChip, Money, NeedsHousehold, PageHeader, ProgressBar, Section, StatusBadge, VisibilityBadge, ViewNote, ViewSwitch, humanize } from "@/components/finance/ui";
import { TransactionDetail } from "@/components/finance/tx-detail";
import { useTxDialog } from "@/components/finance/transaction-form";
import { PALETTE } from "@/components/ui/charts";

const RANGES: [string, string][] = [["current_month", "Current month"], ["previous_month", "Previous month"], ["last_3_months", "Last three months"], ["last_6_months", "Last six months"], ["last_12_months", "Last twelve months"], ["year_to_date", "Year to date"], ["custom", "Custom range"]];

export default function DashboardPage() {
  return <NeedsHousehold><Dashboard /></NeedsHousehold>;
}

function Dashboard() {
  const me = useMe();
  const router = useRouter();
  const { fmt, view, profile, hid } = useFin();
  const tx = useTxDialog();
  const [range, setRange] = React.useState("current_month");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => { if (profile && !profile.onboarded && !profile.isDemo) router.replace("/onboarding"); }, [profile, router]);
  const params = { view, range, ...(range === "custom" && from && to ? { from, to } : {}) };
  const { data: d, isLoading, error } = useFinQuery<any>("/dashboard", params, { enabled: range !== "custom" || (!!from && !!to) });
  const first = me.name.split(" ")[0];

  if (error) return <EmptyState title="The dashboard could not load" description={(error as Error).message} />;
  const catLink = (id: string | null) => `/transactions?view=${view}${id ? `&categoryIds=${id}` : ""}&from=${d?.range.from}&to=${d?.range.to}`;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={view === "household" ? profile?.name ?? "Household" : "My finances"} title={`Welcome back, ${first}`} description={d?.privacyNote} actions={<div className="flex flex-wrap items-center gap-2"><ViewSwitch className="lg:hidden" /><Select aria-label="Reporting period" value={range} onChange={(e) => setRange(e.target.value)} className="h-9 w-auto">{RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>{range === "custom" && <><Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" /><Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" /></>}</div>} />
      {isLoading || !d ? <div className="space-y-4"><div className="skeleton h-48 w-full" /><div className="skeleton h-64 w-full" /></div> : (
        <>
          {d.alerts.length > 0 && <Alerts alerts={d.alerts} />}
          {/* Position: the one number that matters most, in a quiet dark panel */}
          <section className="hero-card rounded-xl p-5 sm:p-7" aria-label="Financial position">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/55">{view === "household" ? "Household net worth" : "My net worth"}</p>
                <p className="display mt-1 text-5xl leading-none sm:text-6xl money">{fmt.money(d.overview.netWorth)}</p>
                <p className="mt-2 text-sm text-white/65">
                  {d.position.monthOverMonth ? <>{fmt.money(d.position.monthOverMonth.change, { sign: true })} since last month</> : "History builds as months pass"}
                  {d.position.yearOverYear ? <> · {Number(d.position.yearOverYear.change) < 0 ? `down ${fmt.money(String(Math.abs(Number(d.position.yearOverYear.change))))}` : `up ${fmt.money(d.position.yearOverYear.change)}`} over twelve months</> : null}
                </p>
              </div>
              <div className="h-20 w-full max-w-xs sm:w-72" aria-hidden>
                <ResponsiveContainer width="100%" height="100%"><AreaChart data={d.position.history.map((h: any) => ({ m: h.month, v: Number(h.netWorth) }))}><Area dataKey="v" stroke="rgb(var(--accent))" fill="rgb(var(--accent))" fillOpacity={0.18} strokeWidth={2} type="monotone" /></AreaChart></ResponsiveContainer>
              </div>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-white/15 pt-5 sm:grid-cols-4">
              {[["Total assets", d.overview.totalAssets], ["Total liabilities", d.overview.totalLiabilities], ["Available cash", d.overview.availableCash], ["Outstanding debt", d.overview.totalDebt]].map(([k, v]) => <div key={k}><dt className="text-[11px] uppercase tracking-[0.12em] text-white/50">{k}</dt><dd className="mt-0.5 text-xl money">{fmt.money(v as string)}</dd></div>)}
            </dl>
          </section>

          {/* Cash flow */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Section className="lg:col-span-2" title="Income and expenses" description={`${fmt.date(d.range.from)} to ${fmt.date(d.range.to)}. Compared with ${fmt.date(d.range.previous.from)} to ${fmt.date(d.range.previous.to)}.`}>
              <div className="h-60" role="img" aria-label="Monthly income and expenses chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.cashFlow.series.map((s: any) => ({ month: fmt.month(s.month), Income: Number(s.income), Expenses: Number(s.expenses) }))} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgb(var(--border))" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "rgb(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: "rgb(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmt.compact(v)} />
                    <Tooltip formatter={(v) => fmt.money(Number(v))} contentStyle={{ background: "rgb(var(--card))", border: "1px solid rgb(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Income" fill={PALETTE[0]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="Expenses" fill={PALETTE[1]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
            <Section title="Cash flow" description="Selected period">
              <div className="space-y-4">
                <Figure label="Income" value={d.overview.income} hint={d.cashFlow.comparison.income.changePct ? `${d.cashFlow.comparison.income.changePct}% vs previous period` : undefined} size="md" />
                <Figure label="Expenses" value={d.overview.expenses} hint={d.cashFlow.comparison.expenses.changePct ? `${d.cashFlow.comparison.expenses.changePct}% vs previous period` : undefined} size="md" />
                <div className="border-t border-border pt-3"><Figure label="Net cash flow" value={<Money value={d.overview.netCashFlow} delta size="lg" />} hint={d.overview.monthlySavingsRate ? `Savings rate ${fmt.pct(d.overview.monthlySavingsRate)}` : "No income recorded in this period"} /></div>
                {d.cashFlow.endOfMonthForecast && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Estimated cash at the end of this month: <strong className="money text-foreground">{fmt.money(d.cashFlow.endOfMonthForecast)}</strong>. {d.cashFlow.endOfMonthNote} <Link className="text-primary underline" href="/forecast">See the forecast</Link></p>}
              </div>
            </Section>
          </div>

          {/* Income and expenses by member */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Household income" description="Expected each month. Gross and net are never mixed." action={<Link href="/income" className="text-sm text-primary hover:underline">Manage</Link>}>
              <table className="w-full text-sm"><caption className="sr-only">Monthly income by member</caption>
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="pb-2 font-medium">Member</th><th className="pb-2 text-right font-medium">Gross</th><th className="pb-2 text-right font-medium">Net</th></tr></thead>
                <tbody>
                  {d.income.members.map((m: any, i: number) => <tr key={i} className="border-t border-border"><td className="py-2.5"><MemberChip member={m.member} /></td><td className="py-2.5 text-right money">{fmt.money(m.monthlyGross)}{m.grossIncomplete ? "*" : ""}</td><td className="py-2.5 text-right money">{fmt.money(m.monthlyNet)}</td></tr>)}
                  <tr className="border-t-2 border-foreground/20 font-medium"><td className="pt-3">Combined</td><td className="pt-3 text-right money">{fmt.money(d.income.combinedMonthlyGross)}</td><td className="pt-3 text-right money">{fmt.money(d.income.combinedMonthlyNet)}</td></tr>
                </tbody>
              </table>
              {d.income.members.length === 0 && <p className="py-4 text-sm text-muted-foreground">No income sources are visible yet. <Link href="/income" className="text-primary underline">Add income</Link>.</p>}
              {d.income.warnings.map((w: string) => <p key={w} className="mt-2 text-xs text-warning">{w}</p>)}
            </Section>
            <Section title="Household expenses" description={`${fmt.money(d.expenses.total)} in this period`} action={<Link href="/spending" className="text-sm text-primary hover:underline">Details</Link>}>
              <div className="mb-4">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Shared ${fmt.money(d.expenses.shared)}, personal ${fmt.money(d.expenses.personal)}`}>
                  <div className="bg-primary" style={{ width: `${Number(d.expenses.total) ? (Number(d.expenses.shared) / Number(d.expenses.total)) * 100 : 0}%` }} />
                  <div className="bg-accent" style={{ width: `${Number(d.expenses.total) ? (Number(d.expenses.personal) / Number(d.expenses.total)) * 100 : 0}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-muted-foreground"><span>Shared by the household: <span className="money text-foreground">{fmt.money(d.expenses.shared)}</span></span><span>Personal to members: <span className="money text-foreground">{fmt.money(d.expenses.personal)}</span></span></div>
              </div>
              <table className="w-full text-sm"><caption className="sr-only">Expenses by member</caption>
                <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="pb-2 font-medium">Member</th><th className="pb-2 text-right font-medium">Recorded</th><th className="pb-2 text-right font-medium">Paid</th></tr></thead>
                <tbody>{d.expenses.byMember.map((m: any, i: number) => <tr key={i} className="border-t border-border"><td className="py-2"><MemberChip member={m.member} /></td><td className="py-2 text-right money">{fmt.money(m.recorded)}</td><td className="py-2 text-right money">{fmt.money(m.paid)}</td></tr>)}</tbody>
              </table>
            </Section>
          </div>

          <Section title="Where the money went" description="Click a category to see the transactions behind it (only those you are allowed to see)." flush>
            {d.expenses.byCategory.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No expenses in this period.</p> : (
              <ul className="divide-y divide-border">
                {d.expenses.byCategory.map((c: any, i: number) => (
                  <li key={c.name}><Link href={catLink(c.categoryId)} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-5 py-2.5 hover:bg-muted/60">
                    <span className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} aria-hidden />{c.name}</span>
                    <span className="text-right text-sm money">{fmt.money(c.amount)} <span className="ml-1 text-xs text-muted-foreground">{c.share ? `${c.share}%` : ""}</span></span>
                    <span className="col-span-2"><ProgressBar value={Number(c.share ?? 0)} label={`${c.name} share`} className="h-1" /></span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Section>

          {/* Position as a balance sheet, and contributions */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Financial position" description="As of today" action={<Link href="/networth" className="text-sm text-primary hover:underline">Net worth</Link>}>
              <dl className="text-sm">
                {[["Cash", d.position.cash], ["Savings", d.position.savings], ["Investments", d.position.investments], ["Property, vehicles and other assets", d.position.otherAssets]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-border py-2"><dt>{k}</dt><dd className="money">{fmt.money(v as string)}</dd></div>)}
                <div className="flex justify-between border-b border-border py-2 font-medium"><dt>Total assets</dt><dd className="money">{fmt.money(d.overview.totalAssets)}</dd></div>
                <div className="flex justify-between border-b border-border py-2"><dt>Total liabilities</dt><dd className="money">{fmt.money(d.position.liabilities, { sign: false })}</dd></div>
                <div className="flex justify-between pt-3 text-base font-medium"><dt>Net worth</dt><dd className="money">{fmt.money(d.position.netWorth)}</dd></div>
              </dl>
            </Section>
            {d.contributions ? (
              <Section title="Member contributions" description="This month. Presented neutrally, as a picture of how shared costs are funded." action={<Link href="/household?tab=contributions" className="text-sm text-primary hover:underline">Details</Link>}>
                <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Contributions by member</caption>
                  <thead><tr className="text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="pb-2 font-medium">Member</th><th className="pb-2 text-right font-medium">Paid for shared</th><th className="pb-2 text-right font-medium">Bills</th><th className="pb-2 text-right font-medium">Saved</th><th className="pb-2 text-right font-medium">Goals</th></tr></thead>
                  <tbody>{d.contributions.members.map((m: any, i: number) => <tr key={i} className="border-t border-border"><td className="py-2"><MemberChip member={m.member} /></td><td className="py-2 text-right money">{fmt.money(m.paidForSharedExpenses)}</td><td className="py-2 text-right money">{fmt.money(m.sharedBillsPaid)}</td><td className="py-2 text-right money">{fmt.money(m.savingsContributions)}</td><td className="py-2 text-right money">{fmt.money(m.goalContributions)}</td></tr>)}</tbody>
                </table></div>
                <p className="mt-3 text-xs text-muted-foreground">Arrangement: {d.contributions.arrangement.label}.</p>
                {d.contributions.suggestedSettlements.map((s: any, i: number) => <p key={i} className="mt-1 text-xs text-muted-foreground">To even things out under this arrangement, {s.from?.name} could pay {s.to?.name} {fmt.money(s.amount)}.</p>)}
              </Section>
            ) : (
              <Section title="Savings and goals" description="Your own progress" action={<Link href="/goals" className="text-sm text-primary hover:underline">Goals</Link>}><GoalList goals={d.goals} /></Section>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="Financial health" description="Each measure is explained. There is no single score."><dl className="divide-y divide-border">
              {d.health.map((h: any) => (
                <div key={h.key} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3"><dt className="text-sm font-medium">{h.label}</dt><dd className="text-base money">{h.value === null || h.value === undefined ? "n/a" : h.unit === "%" || h.unit === "% used" ? fmt.pct(h.value) : h.unit === "months" ? `${fmt.num(h.value, 1)} months` : h.key === "cashFlow" ? fmt.money(h.value, { sign: true }) : `${h.value}`}</dd></div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{h.detail}</p>
                  <details className="mt-1"><summary className="cursor-pointer text-xs text-primary">What this means</summary><p className="mt-1 text-xs text-muted-foreground">{h.meaning}</p></details>
                </div>
              ))}
            </dl></Section>
            {d.contributions ? <Section title="Goals" description="Progress toward shared goals" action={<Link href="/goals" className="text-sm text-primary hover:underline">All goals</Link>}><GoalList goals={d.goals} /></Section> : <Section title="Upcoming" description="Next 30 days"><Upcoming items={d.upcoming} /></Section>}
          </div>
          {d.contributions && <Section title="Upcoming obligations" description="The next 30 days" action={<Link href="/calendar" className="text-sm text-primary hover:underline">Calendar</Link>}><Upcoming items={d.upcoming} /></Section>}

          <VehiclesCard />

          <Section title="Recent transactions" description="Select one to see who entered it, who paid, and how it is allocated." action={<Add label="Add" onClick={() => tx.open()} />} flush>
            {d.recent.length === 0 ? <div className="p-5"><EmptyState title="No transactions yet" description="Add your first transaction or import a CSV file from your bank." action={<Link href="/import" className="rounded-md border border-border px-3 py-2 text-sm">Import a CSV</Link>} /></div> : (
              <ul className="divide-y divide-border">
                {d.recent.map((t: any) => (
                  <li key={t.id}><button className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 px-5 py-3 text-left hover:bg-muted/60" onClick={() => setOpen(t.id)}>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">{fmt.date(t.date)}</span>
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{t.description}</span><span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span>{t.categoryName ?? humanize(t.type)}</span><span>{t.accountName}</span><MemberChip member={t.owner} /></span></span>
                    <Money value={t.amount} delta={t.type !== "TRANSFER"} className="text-sm" />
                  </button></li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
      {open && <TransactionDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Alerts({ alerts }: { alerts: any[] }) {
  return (
    <section aria-label="Alerts" className="rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {alerts.slice(0, 4).map((a) => (
          <li key={a.id}><Link href={a.actionUrl} className="flex items-start gap-3 px-4 py-2.5 text-sm hover:bg-muted/60">
            {a.severity === "CRITICAL" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-label="Critical" /> : a.severity === "WARNING" ? <Bell className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Warning" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-label="Information" />}
            <span><span className="font-medium">{a.title}</span> <span className="text-muted-foreground">{a.body}</span></span>
            <ArrowRight className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link></li>
        ))}
      </ul>
    </section>
  );
}
function GoalList({ goals }: { goals: any[] }) {
  const { fmt } = useFin();
  if (!goals.length) return <p className="text-sm text-muted-foreground">No goals yet. <Link href="/goals" className="text-primary underline">Create one</Link>.</p>;
  return <ul className="space-y-4">{goals.map((g) => <li key={g.id}><div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium">{g.name}</span><StatusBadge status={g.progressStatus} /></div><ProgressBar value={Number(g.percentComplete)} label={`${g.name} progress`} className="my-1.5" /><p className="text-xs text-muted-foreground"><span className="money">{fmt.money(g.current)}</span> of <span className="money">{fmt.money(g.target)}</span>{g.targetDate ? ` by ${fmt.date(g.targetDate)}` : ""}</p></li>)}</ul>;
}
function Upcoming({ items }: { items: any[] }) {
  const { fmt } = useFin();
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing is due in the next 30 days.</p>;
  return (
    <ol className="divide-y divide-border">
      {items.map((o) => (
        <li key={o.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2.5 text-sm">
          <span className="text-xs text-muted-foreground">{fmt.date(o.date)}</span>
          <span className="min-w-0 truncate">{o.title} <span className="text-xs text-muted-foreground">{humanize(o.kind)}</span></span>
          <span className="flex items-center gap-2">{o.status && o.status !== "UPCOMING" && <StatusBadge status={o.status} />}<span className="money">{o.amount ? fmt.money(o.amount) : ""}</span></span>
        </li>
      ))}
    </ol>
  );
}

function VehiclesCard() {
  const { fmt, view, profile } = useFin();
  const year = (profile?.today ?? new Date().toISOString()).slice(0, 4);
  const { data } = useFinQuery<any>("/vehicles/overview", { view: view === "my" ? "my" : "household", from: `${year}-01-01`, to: profile?.today });
  if (!data || data.vehicles.length === 0) return null;
  return (
    <Section title="Vehicles" description={`Running costs since 1 January and what each needs next`} action={<Link href="/vehicle-costs" className="text-sm text-primary hover:underline">Running costs</Link>}>
      <ul className="divide-y divide-border">
        {data.vehicles.map((v: any) => (
          <li key={v.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
            <span className="font-medium">{v.name}</span>
            <span className="text-muted-foreground">{v.nextService ? `${v.nextService.name}: ${v.nextService.summary}` : "No maintenance due date yet"}{v.overdueCount > 0 ? ` (${v.overdueCount} overdue)` : ""}</span>
            <span className="money">{v.costs ? fmt.money(v.costs.total) : "Hidden"}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
