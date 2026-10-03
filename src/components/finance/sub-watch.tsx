"use client";
import * as React from "react";
import { useFin, useFinQuery } from "./provider";
import { Section } from "./ui";

/** Duplicates, price rises and regular charges that are not on the list. Hidden when there is nothing to report. */
export function SubscriptionWatch() {
  const { fmt } = useFin();
  const { data: w } = useFinQuery<any>("/subscriptions/watch", { view: "all" });
  if (!w || (!w.duplicates.length && !w.increases.length && !w.untracked.length)) return null;
  return (
    <Section title="Subscription watch" description={w.note}>
      <div className="space-y-4 text-sm">
        {w.increases.length > 0 && <div><h3 className="mb-1 font-medium">Price increases{Number(w.totalYearlyImpact) > 0 ? ` (about ${fmt.money(w.totalYearlyImpact)} more a year)` : ""}</h3><ul className="divide-y divide-border">{w.increases.map((i: any) => <li key={i.id} className="flex justify-between gap-3 py-1.5"><span>{i.name}</span><span><span className="money">{fmt.money(i.from)}</span> to <span className="money font-medium">{fmt.money(i.to)}</span> <span className="text-xs text-muted-foreground">(+{i.percent}%)</span></span></li>)}</ul></div>}
        {w.duplicates.length > 0 && <div><h3 className="mb-1 font-medium">Possible duplicates</h3><ul className="list-disc space-y-1 pl-5">{w.duplicates.map((d: any) => <li key={d.ids.join()}>{d.names.join(" and ")}. {d.reason}</li>)}</ul></div>}
        {w.untracked.length > 0 && <div><h3 className="mb-1 font-medium">Regular charges not on your list</h3><ul className="divide-y divide-border">{w.untracked.map((u: any) => <li key={u.merchant} className="flex justify-between gap-3 py-1.5"><span>{u.merchant}</span><span className="text-muted-foreground">about <span className="money">{fmt.money(u.typical)}</span> for {u.months} months</span></li>)}</ul></div>}
      </div>
    </Section>
  );
}
