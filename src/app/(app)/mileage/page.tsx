"use client";
import * as React from "react";
import { Alert, Button, Select } from "@/components/ui/primitives";
import { useConfirm } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";
import { useFin, useFinMutation, useFinQuery } from "@/components/finance/provider";
import { Add, DataTable, FormModal, NeedsHousehold, PageHeader, Section, type Col } from "@/components/finance/ui";

export default function MileagePage() {
  return <NeedsHousehold><Inner /></NeedsHousehold>;
}
function Inner() {
  const { fmt, canWrite } = useFin();
  const confirm = useConfirm();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = React.useState(thisYear);
  const [add, setAdd] = React.useState(false);
  const { data: trips, isLoading } = useFinQuery<any>("/mileage/trips", { year });
  const { data: rep } = useFinQuery<any>("/mileage/report", { year });
  const create = useFinMutation<any, any>("POST", "/mileage/trips", { success: "Trip logged" });
  const del = useFinMutation<any, any>("DELETE", (b) => `/mileage/trips/${b.id}`, { success: "Trip removed" });
  const csv = () => {
    const rows = [["Date", "Vehicle", "Kilometres", "Business", "Purpose", "From", "To"], ...(trips?.items ?? []).map((t: any) => [t.date, t.vehicle, t.km, t.business ? "yes" : "no", t.purpose ?? "", t.fromPlace ?? "", t.toPlace ?? ""])];
    const text = rows.map((r) => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = `mileage-${year}.csv`; a.click();
  };
  const cols: Col<any>[] = [
    { key: "d", header: "Date", cell: (r) => fmt.date(r.date) },
    { key: "v", header: "Vehicle", primary: true, cell: (r) => <span className="flex flex-col"><span className="font-medium">{r.vehicle}</span><span className="text-xs text-muted-foreground">{r.purpose ?? (r.business ? "Business" : "Personal")}{r.fromPlace || r.toPlace ? ` · ${r.fromPlace ?? ""} to ${r.toPlace ?? ""}` : ""}</span></span> },
    { key: "b", header: "Type", hideOnMobile: true, cell: (r) => (r.business ? "Business" : "Personal") },
    { key: "k", header: "Kilometres", align: "right", cell: (r) => <span className="money">{r.km}</span> },
    { key: "x", header: "", align: "right", cell: (r) => canWrite ? <Button size="sm" variant="ghost" className="text-danger" onClick={async (e) => { e.stopPropagation(); if (await confirm({ title: "Remove this trip?", confirmLabel: "Remove", tone: "danger" })) del.mutate({ id: r.id }); }}>Remove</Button> : null },
  ];
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Vehicles" title="Mileage log" description="Log business trips so you have what you need at tax time. Distance is in kilometres." actions={<div className="flex flex-wrap gap-2"><Select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-10 w-auto">{[0, 1, 2, 3].map((i) => <option key={i}>{thisYear - i}</option>)}</Select>{canWrite && <Add label="Log a trip" onClick={() => setAdd(true)} />}<Button variant="outline" onClick={csv} disabled={!trips?.items.length}>Download CSV</Button></div>} />
      {rep?.vehicles.map((v: any) => (
        <Section key={v.vehicleId} title={v.name} description={`${v.trips} trips in ${year}`}>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
            <div><dt className="text-xs text-muted-foreground">Business km</dt><dd className="money text-lg">{v.businessKm}</dd></div>
            <div><dt className="text-xs text-muted-foreground">All driving</dt><dd className="money text-lg">{v.totalKm ?? "unknown"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Business share</dt><dd className="text-lg">{v.businessPercent ? `${v.businessPercent}%` : "unknown"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Share of running costs</dt><dd className="money text-lg">{v.percentMethod ? fmt.money(v.percentMethod) : "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Per-km allowance</dt><dd className="money text-lg">{v.rateMethod ? fmt.money(v.rateMethod) : "n/a"}</dd></div>
          </dl>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{v.notes.map((n: string) => <li key={n}>{n}</li>)}{!v.canViewCosts && <li>You do not have access to this vehicle's costs.</li>}</ul>
        </Section>
      ))}
      {rep && <Alert tone="info">{rep.source}</Alert>}
      <Section flush><DataTable cols={cols} rows={trips?.items ?? []} loading={isLoading} caption="Trips" empty={<EmptyState title="No trips yet" description="Log each business trip with its distance and purpose." action={canWrite ? <Button onClick={() => setAdd(true)}>Log a trip</Button> : undefined} />} /></Section>
      <FormModal open={add} onClose={() => setAdd(false)} title="Log a trip" fields={[{ name: "vehicleId", label: "Vehicle", kind: "vehicle", required: true }, { name: "date", label: "Date", kind: "date", required: true, half: true }, { name: "km", label: "Kilometres", kind: "number", required: true, half: true }, { name: "purpose", label: "Purpose" }, { name: "fromPlace", label: "From", half: true }, { name: "toPlace", label: "To", half: true }, { name: "business", label: "", kind: "checkbox", hint: "This was a business trip" }]} initial={{ vehicleId: "", date: new Date().toISOString().slice(0, 10), km: "", purpose: "", fromPlace: "", toPlace: "", business: true }}
        onSubmit={(v) => create.mutateAsync({ vehicleId: v.vehicleId, date: v.date, km: Number(v.km), purpose: v.purpose || null, fromPlace: v.fromPlace || null, toPlace: v.toPlace || null, business: !!v.business })} />
    </div>
  );
}
