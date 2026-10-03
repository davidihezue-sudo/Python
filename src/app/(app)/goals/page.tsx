"use client";
import * as React from "react";
import { Alert, Button, Field, Input, Select } from "@/components/ui/primitives";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, Figure, MemberChip, Money, NeedsHousehold, PageHeader, ProgressBar, Section, StatusBadge, ViewNote, VisibilityBadge, humanize, useMembers, type FieldDef } from "@/components/finance/ui";

const KINDS: [string, string][] = [["EMERGENCY_FUND", "Emergency fund"], ["HOME_DOWN_PAYMENT", "Home down payment"], ["VEHICLE", "Vehicle purchase"], ["VACATION", "Vacation"], ["EDUCATION", "Education"], ["MAJOR_PURCHASE", "Major household purchase"], ["GENERAL_SAVINGS", "General savings"], ["DEBT_PAYOFF", "Pay off debt"], ["INVESTMENT_CONTRIBUTION", "Increase investing"], ["NET_WORTH", "Reach a net worth"], ["CUSTOM", "Custom"]];
export default function GoalsPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, view, canWrite } = useFin();
  const { members } = useMembers();
  const confirm = useConfirm();
  const [tab, setTab] = React.useState("goals");
  const [edit, setEdit] = React.useState<any | "new" | null>(null);
  const [contrib, setContrib] = React.useState<any | null>(null);
  const [filter, setFilter] = React.useState("ACTIVE");
  const { data, isLoading } = useFinQuery<any>("/goals", { view: "all" });
  const { data: debts } = useFinQuery<any>("/debts", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/goals", { success: "Goal created" });
  const upd = useFinMutation<any, any>("PATCH", (b) => `/goals/${b.id}`, { success: "Saved" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/goals/${b.id}`, { success: "Goal removed" });
  const add = useFinMutation<any, any>("POST", (b) => `/goals/${b.id}/contributions`, { success: "Contribution recorded" });
  const delC = useFinMutation<any, any>("DELETE", (b) => `/goals/${b.gid}/contributions/${b.id}`, { success: "Contribution removed" });
  const fields: FieldDef[] = [
    { name: "name", label: "Goal name", required: true },
    { name: "kind", label: "Kind of goal", kind: "select", options: KINDS, half: true },
    { name: "tracking", label: "How progress is measured", kind: "select", half: true, options: [["CONTRIBUTIONS", "Contributions I record"], ["ACCOUNT_BALANCE", "Balance of an account"], ["DEBT_BALANCE", "Debt repaid"], ["NET_WORTH", "Net worth"]] },
    { name: "targetAmount", label: "Target amount", kind: "money", required: true, half: true },
    { name: "startingAmount", label: "Already saved", kind: "money", half: true, show: (v) => v.tracking === "CONTRIBUTIONS" },
    { name: "targetDate", label: "Target date", kind: "date", half: true },
    { name: "monthlyContribution", label: "Monthly contribution", kind: "money", half: true, hint: "See how the completion date changes as you adjust this." },
    { name: "accountId", label: "Savings account", kind: "account", includeNone: "Not linked", half: true, show: (v) => v.tracking !== "DEBT_BALANCE" && v.tracking !== "NET_WORTH" },
    { name: "debtId", label: "Debt", kind: "select", half: true, show: (v) => v.tracking === "DEBT_BALANCE", options: [["", "Choose a debt"], ...((debts?.items ?? []).map((d: any) => [d.id, d.name]) as [string, string][])] },
    { name: "priority", label: "Priority", kind: "select", half: true, options: [["1", "High"], ["2", "Normal"], ["3", "Low"]] },
    { name: "description", label: "Description", kind: "textarea" },
  ];
  const items = (data?.items ?? []).filter((g: any) => filter === "ALL" || g.status === filter);
  return (
    <div>
      <PageHeader eyebrow="Goals" title="Savings and goals" description="Set a target, record contributions, and see immediately whether you are on track and when you will get there." actions={<Add label="New goal" onClick={() => setEdit("new")} />} />
      <ViewNote />
      <Tabs label="Goal sections" value={tab} onChange={setTab} tabs={[{ key: "goals", label: "Goals" }, { key: "emergency", label: "Emergency fund planner" }]} />
      <div className="pt-5">
        <TabPanel id="goals" active={tab === "goals"}>
          {data && <section className="mb-5 grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-5" aria-label="Goal summary"><Figure label="On track" value={<span className="text-2xl">{data.summary.onTrack}</span>} /><Figure label="Behind" value={<span className={`text-2xl ${data.summary.behind ? "text-danger" : ""}`}>{data.summary.behind}</span>} /><Figure label="Completed" value={<span className="text-2xl">{data.summary.completed}</span>} /><Figure label="Saved so far" value={data.summary.totalCurrent} size="md" /><Figure label="Planned each month" value={data.summary.monthlyPlanned} size="md" /></section>}
          <div className="mb-3 flex gap-1.5" role="group" aria-label="Filter goals">{[["ACTIVE", "Active"], ["COMPLETED", "Completed"], ["PAUSED", "Paused"], ["ALL", "All"]].map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === k ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>{l}</button>)}</div>
          {isLoading ? <div className="skeleton h-48 w-full" /> : items.length === 0 ? <EmptyState title="No goals here yet" description="Create a goal such as an emergency fund, a home down payment or a vacation." action={canWrite ? <Button onClick={() => setEdit("new")}>Create a goal</Button> : undefined} /> : (
            <ul className="grid gap-5 lg:grid-cols-2">
              {items.map((g: any) => (
                <li key={g.id}><article className="rounded-xl border border-border bg-card p-4 sm:p-5">
                  <header className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="text-lg font-medium">{g.name}</h2><p className="text-xs text-muted-foreground">{humanize(g.kind)}{g.targetDate ? ` · target ${fmt.date(g.targetDate)}` : ""}</p></div><div className="flex items-center gap-1.5"><StatusBadge status={g.progressStatus} /><VisibilityBadge visibility={g.visibility} count={g.sharedWithMemberIds?.length} /></div></header>
                  <div className="mt-4 flex items-baseline justify-between"><span className="text-2xl money">{fmt.money(g.current)}</span><span className="text-sm text-muted-foreground">of <span className="money">{fmt.money(g.target)}</span> · {fmt.pct(g.percentComplete, 0)}</span></div>
                  <ProgressBar className="mt-2 h-2.5" value={Number(g.percentComplete)} tone={g.progressStatus === "BEHIND" ? "over" : "ok"} label={`${g.name} progress`} />
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><dt className="text-xs text-muted-foreground">Remaining</dt><dd className="money">{fmt.money(g.remaining)}</dd></div><div><dt className="text-xs text-muted-foreground">Monthly plan</dt><dd className="money">{fmt.money(g.monthlyContribution)}</dd></div><div><dt className="text-xs text-muted-foreground">Needed monthly</dt><dd className="money">{g.requiredMonthly ? fmt.money(g.requiredMonthly) : "n/a"}</dd></div></dl>
                  <p className="mt-3 text-sm text-muted-foreground">{g.progressStatus === "COMPLETED" ? "Target reached." : g.estimatedCompletion ? <>At the current plan you reach this around <strong className="text-foreground">{fmt.date(g.estimatedCompletion)}</strong>.{g.shortfallMonthly ? ` About ${fmt.money(g.shortfallMonthly)} more each month would meet the target date.` : ""}</> : "Set a monthly contribution to see an estimated completion date."}</p>
                  {g.trackingNote && <p className="mt-1 text-xs text-muted-foreground">{g.trackingNote}</p>}
                  {g.contributionsByMember.length > 0 && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">{g.contributionsByMember.map((c: any, i: number) => <span key={i} className="flex items-center gap-1.5"><MemberChip member={c.member} /> <span className="money">{fmt.money(c.total)}</span></span>)}</div>}
                  <footer className="mt-4 flex flex-wrap gap-2">{g.canEdit && g.tracking === "CONTRIBUTIONS" && g.status === "ACTIVE" && <Button size="sm" onClick={() => setContrib(g)}>Add contribution</Button>}{g.canEdit && <Button size="sm" variant="outline" onClick={() => setEdit(g)}>Edit</Button>}{g.canEdit && g.status === "ACTIVE" && g.progressStatus !== "COMPLETED" && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: g.id, status: "PAUSED" })}>Pause</Button>}{g.canEdit && g.status === "PAUSED" && <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: g.id, status: "ACTIVE" })}>Resume</Button>}</footer>
                </article></li>
              ))}
            </ul>
          )}
        </TabPanel>
        <TabPanel id="emergency" active={tab === "emergency"}>{tab === "emergency" && <Emergency />}</TabPanel>
      </div>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "New goal" : `Edit ${edit?.name ?? ""}`} fields={fields} visibility size="lg" initial={edit && edit !== "new" ? { ...edit, targetAmount: edit.target, targetDate: edit.targetDate ?? "", accountId: edit.accountId ?? "", debtId: edit.debtId ?? "", priority: String(edit.priority) } : { kind: "GENERAL_SAVINGS", tracking: "CONTRIBUTIONS", startingAmount: "0.00", monthlyContribution: "0.00", priority: "2" }}
        footerExtra={edit && edit !== "new" && edit.canEdit ? <Button variant="ghost" className="mr-auto text-danger" onClick={async () => { if (await confirm({ title: "Remove this goal?", confirmLabel: "Remove", tone: "danger" })) { del.mutate({ id: edit.id }); setEdit(null); } }}>Remove</Button> : undefined}
        onSubmit={(v) => { const body = { name: v.name, kind: v.kind, tracking: v.tracking, targetAmount: v.targetAmount, startingAmount: v.startingAmount || "0.00", targetDate: v.targetDate || null, monthlyContribution: v.monthlyContribution || "0.00", accountId: v.accountId || null, debtId: v.debtId || null, priority: Number(v.priority), description: v.description || null, visibility: v.visibility, sharedWithMemberIds: v.visibility === "SELECTED" ? v.sharedWithMemberIds : undefined }; return edit === "new" ? create.mutateAsync(body) : upd.mutateAsync({ id: edit.id, ...body }); }} />
      <FormModal open={!!contrib} onClose={() => setContrib(null)} title={`Add to ${contrib?.name ?? ""}`} description="Record a contribution. If you choose a source account, the money is moved there as a transfer, so it is not counted as spending." fields={[{ name: "amount", label: "Amount (negative to withdraw)", kind: "money", required: true, half: true }, { name: "date", label: "Date", kind: "date", required: true, half: true }, { name: "fromAccountId", label: "Move from account (optional)", kind: "account", includeNone: "Do not move money in the ledger", show: () => !!contrib?.accountId }, { name: "memberId", label: "Contributed by", kind: "member", half: true }, { name: "note", label: "Note", kind: "textarea" }]} initial={{ amount: contrib?.monthlyContribution ?? "", date: new Date().toISOString().slice(0, 10), fromAccountId: "", memberId: members.find((m) => m.isMe)?.id ?? "" }} onSubmit={(v) => add.mutateAsync({ id: contrib.id, amount: v.amount, date: v.date, fromAccountId: v.fromAccountId || null, memberId: v.memberId || null, note: v.note || null })} />
    </div>
  );
}

function Emergency() {
  const { fmt, view: gv } = useFin();
  const [view, setView] = React.useState<string>(gv);
  const [ess, setEss] = React.useState("");
  const [plan, setPlan] = React.useState("12");
  const { data } = useFinQuery<any>("/emergency", { view, essentialMonthly: ess || undefined, planMonths: plan, months: "1,3,6,9,12" });
  if (!data) return <div className="skeleton h-64 w-full" />;
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Planning for" className="w-48">{(p) => <Select {...p} value={view} onChange={(e) => setView(e.target.value)}><option value="household">The household</option><option value="my">Me</option></Select>}</Field>
        <Field label="Essential spending per month" hint={data.essentialBasis} className="w-72">{(p) => <Input {...p} inputMode="decimal" value={ess} onChange={(e) => setEss(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={data.essentialMonthly} className="money text-right" />}</Field>
        <Field label="Build it over (months)" className="w-40">{(p) => <Input {...p} type="number" min={1} max={120} value={plan} onChange={(e) => setPlan(e.target.value)} />}</Field>
      </div>
      <section className="grid gap-5 rounded-xl border border-border bg-card p-4 sm:p-5 sm:grid-cols-3"><Figure label="Emergency savings" value={data.currentEmergencySavings} hint="Savings accounts" /><Figure label="Essential spending" value={data.essentialMonthly} hint="Per month" /><Figure label="Coverage" value={<span className="text-3xl money">{data.coverageMonths ? `${fmt.num(data.coverageMonths, 1)} months` : "n/a"}</span>} hint="Months of essentials covered" /></section>
      <Section title="Targets" flush><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Emergency fund targets</caption><thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-4 py-2.5 font-medium">Coverage</th><th className="px-4 py-2.5 text-right font-medium">Target</th><th className="px-4 py-2.5 text-right font-medium">Remaining</th><th className="px-4 py-2.5 text-right font-medium">Needed per month</th><th className="px-4 py-2.5 font-medium">Status</th></tr></thead>
        <tbody>{data.targets.map((t: any) => <tr key={t.months} className="border-b border-border/70 last:border-0"><td className="px-4 py-3">{t.months} month{t.months === 1 ? "" : "s"}</td><td className="px-4 py-3 text-right money">{fmt.money(t.amount)}</td><td className="px-4 py-3 text-right money">{fmt.money(t.remaining)}</td><td className="px-4 py-3 text-right money">{t.requiredMonthly ? fmt.money(t.requiredMonthly) : "n/a"}</td><td className="px-4 py-3">{t.reached ? "Reached" : "In progress"}</td></tr>)}</tbody></table></div></Section>
      {data.scenario && <Section title="If one income stopped" description={`Scenario: ${data.scenario.lostMember?.name ?? "one member"} loses their income.`}>
        <div className="grid gap-5 sm:grid-cols-4"><Figure label="Income lost" value={data.scenario.lostMonthlyNet} size="md" hint="Net per month" /><Figure label="Income remaining" value={data.scenario.remainingIncomeMonthly} size="md" /><Figure label="Monthly shortfall" value={data.scenario.monthlyShortfall} size="md" /><Figure label="Savings would last" value={<span className="text-2xl money">{data.scenario.coversEssentials ? "Covered" : `${fmt.num(data.scenario.runwayMonths, 1)} months`}</span>} /></div>
        <p className="mt-3 text-sm text-muted-foreground">{data.scenario.coversEssentials ? "The remaining income covers essential spending, so savings would not need to be drawn down." : `With essentials of ${fmt.money(data.essentialMonthly)} and ${fmt.money(data.scenario.remainingIncomeMonthly)} still coming in, the ${fmt.money(data.cashAndSavings)} in cash and savings would cover the shortfall for about ${fmt.num(data.scenario.runwayMonths, 1)} months.`}</p>
      </Section>}
      <p className="text-xs text-muted-foreground">{data.note}</p>
    </div>
  );
}

