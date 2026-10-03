"use client";
import * as React from "react";
import { Alert, Button, Input } from "@/components/ui/primitives";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { FormModal, NeedsHousehold, PageHeader, ProgressBar, Section } from "@/components/finance/ui";

export default function RegisteredPage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
const LABEL: Record<string, string> = { RRSP: "RRSP", TFSA: "TFSA", FHSA: "FHSA (first home savings)" };
const TONE: Record<string, "ok" | "warn" | "over"> = { ok: "ok", near: "warn", full: "warn", over: "over" };

function Inner() {
  const { fmt, canWrite } = useFin();
  const [year, setYear] = React.useState<number | null>(null);
  const [edit, setEdit] = React.useState<any | null>(null);
  const { data: d, isLoading } = useFinQuery<any>("/registered-room", year ? { year } : {});
  const save = useFinMutation<any, any>("PUT", "/registered-room", { success: "Saved" });
  if (isLoading || !d) return <div className="skeleton h-64 w-full" />;
  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader eyebrow="Wealth" title="Registered accounts" description="Track your RRSP, TFSA and FHSA contribution room so you do not over-contribute." actions={<select aria-label="Year" value={d.year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 rounded-md border border-input bg-card px-3 text-sm">{[...new Set([...d.years, d.year])].sort().map((y: number) => <option key={y}>{y}</option>)}</select>} />
      <Alert tone="info">{d.privacy} Room figures come from the notice of assessment (CRA My Account). Enter yours, and contributions you record on your own investment accounts are subtracted automatically.</Alert>
      <div className="grid gap-4 md:grid-cols-3">
        {d.items.map((i: any) => (
          <Section key={i.kind} title={LABEL[i.kind]} action={canWrite ? <Button size="sm" variant="outline" onClick={() => setEdit(i)}>{i.hasRoom ? "Edit room" : "Enter room"}</Button> : undefined}>
            {!i.hasRoom ? <p className="text-sm text-muted-foreground">Enter your {d.year} room to start tracking.{i.referenceLimit && <> For reference, the {d.year} limit is {fmt.money(String(i.referenceLimit.annual ?? i.referenceLimit.dollarLimit))}.</>}</p> : (
              <div className="space-y-3">
                <div><p className="text-xs text-muted-foreground">Room left</p><p className="display text-3xl money">{fmt.money(i.remaining)}</p></div>
                <ProgressBar value={Math.min(100, Number(i.percentUsed))} tone={TONE[i.status] ?? "ok"} label={`${i.kind} room used`} />
                <dl className="grid grid-cols-3 gap-2 text-xs"><div><dt className="text-muted-foreground">Opening</dt><dd className="money">{fmt.money(i.openingRoom)}</dd></div><div><dt className="text-muted-foreground">Contributed</dt><dd className="money">{fmt.money(i.contributed)}</dd></div><div><dt className="text-muted-foreground">Used</dt><dd className="money">{i.percentUsed}%</dd></div></dl>
                {Number(i.overBy) > 0 && <Alert tone={Number(i.estimatedMonthlyTax) > 0 ? "danger" : "warning"}>Over by {fmt.money(i.overBy)}. {Number(i.estimatedMonthlyTax) > 0 ? `Estimated tax on the excess: ${fmt.money(i.estimatedMonthlyTax)} a month.` : "This is within the RRSP allowance."}</Alert>}
                {i.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{i.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>}
                {i.accounts.length > 0 ? <p className="text-xs text-muted-foreground">Tracked from: {i.accounts.join(", ")}</p> : <p className="text-xs text-muted-foreground">No {i.kind} investment account is linked yet. Add one under Investments to track contributions automatically.</p>}
              </div>
            )}
          </Section>
        ))}
      </div>
      <RrspHelper year={d.year} />
      <p className="text-xs text-muted-foreground">{d.source}</p>
      <FormModal open={!!edit} onClose={() => setEdit(null)} title={`${edit ? LABEL[edit.kind] : ""} room for ${d.year}`} fields={[{ name: "openingRoom", label: "Room available at the start of the year", kind: "money", required: true }, { name: "note", label: "Note (optional)" }]} initial={{ openingRoom: edit?.openingRoom ?? "", note: edit?.note ?? "" }} onSubmit={(v) => save.mutateAsync({ kind: edit.kind, year: d.year, openingRoom: v.openingRoom, note: v.note || null })} />
    </div>
  );
}

function RrspHelper({ year }: { year: number }) {
  const { fmt } = useFin();
  const [income, setIncome] = React.useState("");
  const { data } = useFinQuery<any>("/registered-room/rrsp-helper", { priorYearIncome: income, year }, { enabled: /^\d+(\.\d{1,2})?$/.test(income) });
  return (
    <Section title="RRSP limit estimate" description="18% of last year's earned income, up to the yearly dollar limit. Your notice of assessment is the official number.">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Earned income last year<Input inputMode="decimal" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="0.00" className="mt-1 w-44 text-right" /></label>
        {data && <p className="text-sm">{data.limit ? <>Estimated new room: <span className="money font-semibold">{fmt.money(data.limit)}</span></> : "No published limit is stored for that year."}</p>}
      </div>
    </Section>
  );
}
