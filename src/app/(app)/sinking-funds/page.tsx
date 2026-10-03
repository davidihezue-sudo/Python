"use client";
import * as React from "react";
import Link from "next/link";
import { Badge, Button } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, FormModal, NeedsHousehold, PageHeader, ProgressBar, Section, ViewNote } from "@/components/finance/ui";

export default function SinkingPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const TONE: Record<string, any> = { funded: "success", on_track: "success", behind: "warning", overdue: "danger" };
const WORDS: Record<string, string> = { funded: "Fully funded", on_track: "On track", behind: "Behind", overdue: "Past due" };
function Inner() {
  const { fmt, canWrite } = useFin();
  const [add, setAdd] = React.useState(false);
  const { data, isLoading } = useFinQuery<any>("/sinking-funds", { view: "all" });
  const create = useFinMutation<any, any>("POST", "/goals", { success: "Fund added" });
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Plan" title="Sinking funds" description="Save a little each month for costs you know are coming, such as insurance, property tax, gifts and car repairs, so the bill never hurts." actions={canWrite ? <Add label="New fund" onClick={() => setAdd(true)} /> : undefined} />
      <ViewNote />
      {isLoading ? <div className="skeleton h-40 w-full" /> : !data?.items.length ? <EmptyState title="No sinking funds yet" description="Add a cost with a due date and we work out what to set aside each month." action={canWrite ? <Button onClick={() => setAdd(true)}>Add a fund</Button> : undefined} /> : (
        <>
          <p className="text-sm">To cover everything on time, set aside <span className="money font-semibold">{fmt.money(data.totalPerMonth)}</span> a month in total.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {data.items.map((f: any) => (
              <Section key={f.id} title={f.name} description={`Due ${fmt.date(f.dueDate)}`} action={<Badge tone={TONE[f.status]}>{WORDS[f.status]}</Badge>}>
                <ProgressBar value={Number(f.fundedPercent)} tone={f.status === "behind" || f.status === "overdue" ? "warn" : "ok"} label={`${f.name} funded`} />
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-xs text-muted-foreground">Saved</dt><dd className="money">{fmt.money(f.saved)}</dd></div><div><dt className="text-xs text-muted-foreground">Target</dt><dd className="money">{fmt.money(f.target)}</dd></div><div><dt className="text-xs text-muted-foreground">Set aside a month</dt><dd className="money font-semibold">{fmt.money(f.perMonth)}</dd></div></dl>
                <p className="mt-2 text-xs text-muted-foreground">About {fmt.money(f.perPayPeriod)} every two weeks. {Number(f.plannedMonthly) > 0 ? `You plan ${fmt.money(f.plannedMonthly)} a month.` : ""} <Link href="/goals" className="text-primary hover:underline">Record a contribution</Link></p>
              </Section>
            ))}
          </div>
        </>
      )}
      <FormModal open={add} onClose={() => setAdd(false)} title="New sinking fund" description="This creates a savings goal with a due date." fields={[{ name: "name", label: "What is it for?", required: true }, { name: "targetAmount", label: "How much will it cost?", kind: "money", required: true, half: true }, { name: "targetDate", label: "When is it due?", kind: "date", required: true, half: true }, { name: "accountId", label: "Savings account holding the money", kind: "account", required: true }]} initial={{ name: "", targetAmount: "", targetDate: "", accountId: "" }}
        onSubmit={(x) => create.mutateAsync({ name: x.name, kind: "CUSTOM", tracking: "CONTRIBUTIONS", targetAmount: x.targetAmount, targetDate: x.targetDate, accountId: x.accountId })} />
    </div>
  );
}
