"use client";
import * as React from "react";
import { Info } from "lucide-react";
import { useFin, useFinQuery } from "./provider";
import { Section } from "./ui";

const TONE = { ok: "text-success", tight: "text-warning", short: "text-danger" } as const;
const WORDS = { ok: "You are in good shape until pay day.", tight: "Things are tight until pay day.", short: "Upcoming bills are more than your cash on hand." } as const;

/** Cash on hand minus what is due before the next pay day, per day. A guide, never a guarantee. */
export function SafeToSpend() {
  const { fmt, view } = useFin();
  const [open, setOpen] = React.useState(false);
  const { data: d } = useFinQuery<any>("/safe-to-spend", { view: view === "household" ? "household" : "my" });
  if (!d) return null;
  return (
    <Section title="Safe to spend" description={d.nextPayday ? `Until your next pay day, ${fmt.date(d.nextPayday)}` : "Until the end of the month"} action={<button onClick={() => setOpen((s) => !s)} aria-expanded={open} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Info className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">How is this worked out?</span><span className="sm:hidden">How?</span></button>}>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className={`display text-4xl money ${TONE[d.status as keyof typeof TONE]}`}>{fmt.money(d.safe)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{WORDS[d.status as keyof typeof WORDS]}</p>
        </div>
        <dl className="grid grid-cols-3 gap-4 sm:gap-6 text-sm">
          <div><dt className="text-xs text-muted-foreground">Cash</dt><dd className="money">{fmt.money(d.cash)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Already committed</dt><dd className="money">{fmt.money(d.committed)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">About per day</dt><dd className="money">{fmt.money(d.perDay)}</dd></div>
        </dl>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{d.basis.map((b: string) => <li key={b}>{b}</li>)}</ul>
          {d.items?.length > 0 && <ul className="divide-y divide-border rounded-md border border-border">{d.items.map((i: any, n: number) => <li key={n} className="flex justify-between gap-3 px-3 py-1.5"><span>{i.label} <span className="text-xs text-muted-foreground">{fmt.date(i.date)}</span></span><span className="money">{fmt.money(i.amount)}</span></li>)}</ul>}
        </div>
      )}
    </Section>
  );
}
