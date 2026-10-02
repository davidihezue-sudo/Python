"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray } from "react-hook-form";
import { Copy, Gauge, Plus, Trash2, Pencil, Upload, ShieldCheck, Cable, Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { inspectionSchema, odometerUpdateSchema, warrantySchema, dtcSchema } from "@/lib/validation";
import { today, titleCase } from "@/lib/client/utils";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { ChartCard, Lines, StackedBars } from "@/components/ui/charts";
import { ScheduleStatusBadge, SeverityBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, applyApiErrors, useZodForm } from "@/components/forms";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { label } from "@/components/forms/common";
import { useFormat, useMe } from "@/components/shell/providers";

// ───────────────────────── Overview
export function OverviewPanel({ v }: { v: any }) {
  const f = useFormat();
  const { data: timeline } = useQuery({ queryKey: ["timeline", v.id], queryFn: () => api<any[]>(`/api/vehicles/${v.id}/timeline?limit=30`) });
  const { data: sched } = useQuery({ queryKey: ["schedules", "summary", v.id], queryFn: () => api<any>(`/api/vehicles/${v.id}/schedules`) });
  const { data: upcoming } = useQuery({ queryKey: ["upcoming", v.id], queryFn: () => api<any[]>(`/api/reminders/upcoming?vehicleId=${v.id}`) });
  const { data: issues } = useQuery({ queryKey: ["issues-open", v.id], queryFn: () => api<any>(`/api/repairs?vehicleId=${v.id}&open=true`) });
  const next = (sched?.items ?? []).filter((i: any) => i.enabled && i.status !== "UNKNOWN_HISTORY" && i.status !== "UP_TO_DATE").slice(0, 4);
  const spec: [string, any][] = [["Engine", [v.engineType, v.engineCode && `(${v.engineCode})`].filter(Boolean).join(" ")], ["Fuel", label(v.fuelType)], ["Transmission", v.transmission && label(v.transmission)], ["Drivetrain", v.drivetrain], ["VIN", v.vin], ["Plate", v.registrationNumber], ["Colour", v.colour], ["Body", v.bodyType], ["Market", v.market], ["Generation", v.generation], ["Ownership", label(v.ownershipStatus)], ["Purchased", v.purchaseDate && `${f.date(v.purchaseDate)}${v.purchasePrice ? ` · ${f.money(v.purchasePrice, v.currency)}` : ""}`], ["Insurance", [v.insuranceProvider, v.insuranceRenewalDate && `renews ${f.date(v.insuranceRenewalDate)}`].filter(Boolean).join(" · ")], ["Registration expires", v.registrationExpiryDate && f.date(v.registrationExpiryDate)]];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <section aria-label="Statistics" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Odometer", v.currentOdometerKm !== null ? f.distance(v.currentOdometerKm) : "Not recorded"], ["Last service", v.stats.lastServiceDate ? f.date(v.stats.lastServiceDate) : "None yet"], ["Lifetime expenses", v.stats.lifetimeSpend === null ? "Restricted" : f.money(v.stats.lifetimeSpend, v.currency)], ["Repair spend", v.stats.repairSpend === null ? "Restricted" : f.money(v.stats.repairSpend, v.currency)]].map(([k, val]) => (
            <Card key={k} className="p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 font-semibold tabular">{val}</p></Card>
          ))}
        </section>
        <Card>
          <CardHeader title="Maintenance health" description={v.health.score === null ? "Insufficient recorded data to estimate a condition score — record when items were last done." : `${v.health.score}/100 — ${v.health.label}. Calculated from ${v.health.known} schedules with recorded history, weighted by priority (${v.health.unknown} have no history).`} />
          <CardBody>
            {next.length === 0 ? <p className="text-sm text-muted-foreground">{sched ? "No schedules need attention right now." : "Loading…"}</p> : (
              <ul className="divide-y divide-border">{next.map((i: any) => <li key={i.id} className="flex items-center justify-between gap-2 py-2"><div><p className="text-sm font-medium">{i.name}</p><p className="text-xs text-muted-foreground">{i.summary}</p></div><ScheduleStatusBadge status={i.status} /></li>)}</ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Activity timeline" description="Services, repairs, readings, fuel, documents and ownership events" />
          <CardBody>
            {!timeline ? <Skeleton className="h-32" /> : timeline.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
              <ol className="relative ml-2 space-y-3 border-l border-border pl-5">
                {timeline.map((e) => (
                  <li key={`${e.type}-${e.id}`} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" aria-hidden />
                    <p className="text-sm font-medium">{e.link ? <Link href={e.link} className="hover:text-primary">{e.title}</Link> : e.title} <Badge className="ml-1">{e.type}</Badge></p>
                    <p className="text-xs text-muted-foreground">{f.date(e.date)}{e.km != null ? ` · ${f.distance(e.km)}` : ""}{e.amount != null ? ` · ${f.money(e.amount, v.currency)}` : ""}{e.detail ? ` · ${e.detail}` : ""}</p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="space-y-4">
        <Card><CardHeader title="Specifications" /><CardBody><dl className="space-y-1.5 text-sm">{spec.filter(([, val]) => val).map(([k, val]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium break-all">{val}</dd></div>)}</dl>{v.notes && <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">{v.notes}</p>}</CardBody></Card>
        <Card><CardHeader title="Outstanding issues" action={<Link href={`/repairs`}><Button variant="ghost" size="sm">All</Button></Link>} /><CardBody>{!issues ? <Skeleton className="h-16" /> : issues.items.length === 0 ? <p className="text-sm text-muted-foreground">No open issues.</p> : <ul className="space-y-2">{issues.items.slice(0, 5).map((i: any) => <li key={i.id}><Link href={`/repairs?issue=${i.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-primary"><span className="truncate">{i.title}</span><SeverityBadge severity={i.severity} /></Link></li>)}</ul>}</CardBody></Card>
        <Card><CardHeader title="Upcoming reminders" action={<Link href="/reminders"><Button variant="ghost" size="sm">All</Button></Link>} /><CardBody>{!upcoming ? <Skeleton className="h-16" /> : upcoming.length === 0 ? <p className="text-sm text-muted-foreground">Nothing coming up.</p> : <ul className="space-y-2">{upcoming.slice(0, 6).map((u) => <li key={u.key} className="text-sm"><p className="font-medium">{u.title}</p><p className="text-xs text-muted-foreground">{u.summary}</p></li>)}</ul>}</CardBody></Card>
        <Card><CardHeader title="Ownership timeline" /><CardBody>{v.ownerships.length === 0 ? <p className="text-sm text-muted-foreground">Add a purchase date to start the timeline.</p> : <ul className="space-y-2 text-sm">{v.ownerships.map((o: any) => <li key={o.id}><p className="font-medium">{o.ownerName}</p><p className="text-xs text-muted-foreground">{f.date(o.fromDate)} → {o.toDate ? f.date(o.toDate) : "present"}{o.fromOdometerKm != null ? ` · from ${f.distance(o.fromOdometerKm)}` : ""}</p></li>)}</ul>}</CardBody></Card>
      </div>
    </div>
  );
}

// ───────────────────────── Odometer
export function OdometerPanel({ vehicleId, canWrite }: { vehicleId: string; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { open } = useQuickAdd();
  const { data: o, isLoading } = useQuery({ queryKey: ["odometer", vehicleId], queryFn: () => api<any>(`/api/vehicles/${vehicleId}/odometer`) });
  const [edit, setEdit] = React.useState<any>(null);
  const [imp, setImp] = React.useState(false);
  if (isLoading || !o) return <Skeleton className="h-64" />;
  const chart = [...o.entries].reverse().map((e: any) => ({ date: e.date, km: f.distanceValue(e.valueKm) }));
  const u = o.usage;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Current odometer", o.currentKm !== null ? f.distance(o.currentKm) : "Not recorded", o.currentAt ? `as of ${f.date(o.currentAt)}` : "Add your first reading"], ["Average / month", u.avgMonthlyKm ? f.distance(u.avgMonthlyKm) : "—", u.note], ["Average / year", u.avgYearlyKm ? f.distance(u.avgYearlyKm) : "—", u.avgDailyKm ? `${f.distance(u.avgDailyKm, 1)} per day` : ""], ["Projected in 90 days", o.projections.in90Days ? f.distance(o.projections.in90Days.km) : "—", o.projections.in90Days ? `≈ ${f.date(o.projections.in90Days.date)}` : "Needs more readings"]].map(([k, v, h]) => <Card key={k} className="p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-1 text-lg font-semibold tabular">{v}</p><p className="text-[11px] text-muted-foreground">{h}</p></Card>)}
      </div>
      {u.confidence === "low" && <Alert tone="info">Estimates use less than 30 days of readings and may be rough.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Odometer history" unit={f.unitLabel} data={chart} columns={[{ key: "date", label: "Date" }, { key: "km", label: f.unitLabel }]} action={canWrite ? <Button size="sm" onClick={() => open("mileage", { vehicleId })}><Gauge className="h-4 w-4" /> Update</Button> : undefined}>
          <Lines data={chart} xKey="date" series={[{ key: "km", label: `Odometer (${f.unitLabel})` }]} area fmt={(v) => f.number(v)} />
        </ChartCard>
        <ChartCard title="Distance driven per month" unit={f.unitLabel} data={o.monthly.map((m: any) => ({ month: m.month, km: f.distanceValue(m.km) }))} columns={[{ key: "month", label: "Month" }, { key: "km", label: f.unitLabel }]}>
          <StackedBars data={o.monthly.map((m: any) => ({ month: m.month, km: f.distanceValue(m.km) }))} xKey="month" series={[{ key: "km", label: `Distance (${f.unitLabel})` }]} fmt={(v) => f.number(v)} />
        </ChartCard>
      </div>
      <Card>
        <CardHeader title="Readings" description="Backward readings are blocked unless you confirm a correction." action={canWrite && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setImp(true)}><Upload className="h-4 w-4" /> Import</Button><Button size="sm" onClick={() => open("mileage", { vehicleId })}><Plus className="h-4 w-4" /> Add reading</Button></div>} />
        <CardBody>
          {o.entries.length === 0 ? <EmptyState title="No odometer readings" description="Add a reading to enable mileage-based schedules and cost per distance." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">Odometer readings</caption><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 pr-3">Date</th><th className="pr-3">Odometer</th><th className="pr-3">Source</th><th className="pr-3">Note</th><th /></tr></thead><tbody className="divide-y divide-border">{o.entries.slice(0, 60).map((e: any) => (
              <tr key={e.id}><td className="py-1.5 pr-3 tabular">{f.date(e.date)}</td><td className="pr-3 font-medium tabular">{f.distance(e.valueKm)}</td><td className="pr-3"><Badge>{titleCase(e.source)}</Badge>{e.isCorrection && <Badge tone="warning" className="ml-1">Correction</Badge>}</td><td className="pr-3 text-muted-foreground">{e.note}</td>
                <td className="text-right">{canWrite && !e.linked && <><Button size="icon" variant="ghost" aria-label="Edit reading" onClick={() => setEdit(e)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Delete reading" onClick={async () => { if (await confirm({ title: "Delete this reading?", confirmLabel: "Delete" })) { await api(`/api/vehicles/${vehicleId}/odometer/${e.id}`, { method: "DELETE" }); toast({ title: "Reading deleted" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button></>}{e.linked && <span className="text-xs text-muted-foreground">from a record</span>}</td></tr>
            ))}</tbody></table></div>
          )}
        </CardBody>
      </Card>
      {edit && <EditReading vehicleId={vehicleId} entry={edit} onClose={() => setEdit(null)} />}
      {imp && <ImportReadings vehicleId={vehicleId} onClose={() => setImp(false)} />}
    </div>
  );
}

function EditReading({ vehicleId, entry, onClose }: { vehicleId: string; entry: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useZodForm(odometerUpdateSchema, { date: entry.date, valueKm: entry.valueKm, note: entry.note ?? "", confirmCorrection: false });
  const [err, setErr] = React.useState("");
  const [reg, setReg] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try {
      await api(`/api/vehicles/${vehicleId}/odometer/${entry.id}`, { method: "PATCH", body: v });
      toast({ title: "Reading updated" });
      void qc.invalidateQueries();
      onClose();
    } catch (e: any) {
      if (e.code === "ODOMETER_REGRESSION") return setReg(e.message);
      setErr(applyApiErrors(form, e));
    }
  });
  return (
    <Modal open onClose={onClose} title="Correct odometer reading" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-reading">Save</Button></>}>
      <form id="edit-reading" onSubmit={submit} className="space-y-3">
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Date">{(p) => <Input type="date" {...p} {...form.register("date")} />}</Field>
        <Field label="Odometer">{(p) => <Controller control={form.control} name="valueKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="Note">{(p) => <Input {...p} {...form.register("note")} />}</Field>
        {reg && <Alert tone="warning">{reg}<div className="mt-2"><Checkbox label="This is a legitimate correction" onChange={(e) => form.setValue("confirmCorrection", e.target.checked)} /></div></Alert>}
      </form>
    </Modal>
  );
}

function ImportReadings({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const f = useFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = React.useState("");
  const [err, setErr] = React.useState<string[]>([]);
  const run = async () => {
    setErr([]);
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^date/i.test(l)).map((l) => {
      const [date, val] = l.split(/[,;\t]/).map((x) => x.trim());
      return { date, valueKm: f.toKm(Number(val.replace(/[^\d.]/g, ""))) };
    });
    try {
      const r = await api<any>(`/api/vehicles/${vehicleId}/odometer/import`, { method: "POST", body: { rows } });
      toast({ title: `Imported ${r.created} readings`, description: r.skipped ? `${r.skipped} duplicates skipped` : undefined });
      void qc.invalidateQueries();
      onClose();
    } catch (e: any) {
      setErr(e.details?.errors?.map((x: any) => `Row ${x.row}: ${x.message}`) ?? [e.message]);
    }
  };
  return (
    <Modal open onClose={onClose} title="Import odometer readings" description={`One reading per line: date (YYYY-MM-DD) and odometer in ${f.unitLabel}, separated by a comma. The whole batch is rejected if any row is invalid.`} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={run}>Import</Button></>}>
      {err.length > 0 && <Alert tone="danger" className="mb-3">{err.slice(0, 8).map((e) => <p key={e}>{e}</p>)}</Alert>}
      <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"2024-01-01, 100000\n2024-02-01, 101250"} aria-label="Readings to import" className="font-mono" />
    </Modal>
  );
}

// ───────────────────────── Warranty
export function WarrantyPanel({ vehicleId, canWrite }: { vehicleId: string; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["warranties", vehicleId], queryFn: () => api<any[]>(`/api/warranties?vehicleId=${vehicleId}`) });
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add warranty</Button></div>}
      {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="No warranties recorded" description="Add manufacturer, powertrain or extended warranties to get expiry alerts. Part warranties appear automatically from the parts inventory." /> : (
        <ul className="space-y-2">{data.map((w) => (
          <li key={`${w.source}-${w.id}`}><Card><CardBody className="flex flex-wrap items-center justify-between gap-2 !py-3">
            <div><p className="font-medium">{w.name}</p><p className="text-xs text-muted-foreground">{titleCase(w.type)}{w.provider ? ` · ${w.provider}` : ""} · {w.startDate ? f.date(w.startDate) : "?"} → {w.endDate ? f.date(w.endDate) : "no end date"}{w.endKm ? ` · to ${f.distance(w.endKm)}` : ""}{w.kmRemaining !== null ? ` (${w.kmRemaining >= 0 ? f.distance(w.kmRemaining) + " left" : "limit exceeded"})` : ""}</p>{w.coverage && <p className="text-xs text-muted-foreground">{w.coverage}</p>}</div>
            <div className="flex items-center gap-2"><Badge tone={w.status === "expired" ? "danger" : w.status === "expiring" ? "warning" : w.status === "active" ? "success" : "neutral"}>{w.status === "no-end-date" ? "No end date" : w.status === "expired" ? "Expired" : w.status === "expiring" ? `${w.daysRemaining} days left` : "Active"}</Badge>{canWrite && w.source === "warranty" && <Button size="icon" variant="ghost" aria-label="Delete warranty" onClick={async () => { if (await confirm({ title: "Delete this warranty?", confirmLabel: "Delete" })) { await api(`/api/warranties/${w.id}`, { method: "DELETE" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button>}</div>
          </CardBody></Card></li>
        ))}</ul>
      )}
      {adding && <WarrantyDialog vehicleId={vehicleId} onClose={() => setAdding(false)} />}
    </div>
  );
}
function WarrantyDialog({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useZodForm(warrantySchema, { vehicleId, type: "MANUFACTURER" });
  const [err, setErr] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try { await api("/api/warranties", { method: "POST", body: v }); toast({ title: "Warranty added" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); }
  });
  const e = (k: string) => form.formState.errors[k]?.message as string | undefined;
  return (
    <Modal open onClose={onClose} title="Add warranty" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="warranty-form">Save</Button></>}>
      <form id="warranty-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Name" error={e("name")} required>{(p) => <Input {...p} {...form.register("name")} placeholder="e.g. Powertrain warranty" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">{(p) => <Select {...p} {...form.register("type")}>{["MANUFACTURER", "POWERTRAIN", "EXTENDED", "PART", "OTHER"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>}</Field>
          <Field label="Provider">{(p) => <Input {...p} {...form.register("provider")} />}</Field>
          <Field label="Start date">{(p) => <Input type="date" {...p} {...form.register("startDate")} />}</Field>
          <Field label="End date">{(p) => <Input type="date" {...p} {...form.register("endDate")} />}</Field>
          <Field label="Mileage limit">{(p) => <Controller control={form.control} name="endKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <Field label="Coverage">{(p) => <Textarea rows={2} {...p} {...form.register("coverage")} />}</Field>
      </form>
    </Modal>
  );
}

// ───────────────────────── Diagnostics (+ OBD gateway)
export function DiagnosticsPanel({ vehicleId, canWrite, canEdit }: { vehicleId: string; canWrite: boolean; canEdit: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { data: codes, isLoading } = useQuery({ queryKey: ["dtc", vehicleId], queryFn: () => api<any[]>(`/api/diagnostics?vehicleId=${vehicleId}`) });
  const { data: integ } = useQuery({ queryKey: ["integrations", vehicleId], queryFn: () => api<any[]>(`/api/vehicles/${vehicleId}/integrations`) });
  const { data: providers } = useQuery({ queryKey: ["diag-providers"], queryFn: () => api<any[]>("/api/diagnostics/providers") });
  const [adding, setAdding] = React.useState(false);
  const [token, setToken] = React.useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Generic code meanings are not diagnoses">Trouble-code descriptions below are the generic industry meaning only. The real cause is vehicle-specific — confirm with a qualified technician.</Alert>
      <Card>
        <CardHeader title="Diagnostic trouble codes" action={canWrite && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add code</Button>} />
        <CardBody>
          {isLoading ? <Skeleton className="h-20" /> : !codes?.length ? <EmptyState title="No codes recorded" description="Enter codes read by a scan tool, or connect an OBD-II gateway." /> : (
            <ul className="divide-y divide-border">{codes.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{c.code}</span><Badge tone={c.status === "ACTIVE" ? "danger" : "success"}>{titleCase(c.status)}</Badge><SeverityBadge severity={c.severity} /><Badge>{titleCase(c.source)}</Badge><span className="text-xs text-muted-foreground">{f.date(c.detectedAt)}{c.odometerKm != null ? ` · ${f.distance(c.odometerKm)}` : ""}</span>
                  {canWrite && <span className="ml-auto flex gap-1">{c.status === "ACTIVE" && <Button size="sm" variant="outline" onClick={async () => { await api(`/api/diagnostics/${c.id}`, { method: "PATCH", body: { status: "RESOLVED" } }); void qc.invalidateQueries(); }}>Mark resolved</Button>}<Button size="icon" variant="ghost" aria-label="Delete code" onClick={async () => { if (await confirm({ title: `Delete ${c.code}?`, confirmLabel: "Delete" })) { await api(`/api/diagnostics/${c.id}`, { method: "DELETE" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button></span>}</div>
                <p className="mt-1 text-sm">{c.description ?? c.reference.description ?? "No description recorded"} {c.reference.known && !c.description && <span className="text-xs text-muted-foreground">(generic meaning)</span>}</p>
                <p className="text-xs text-muted-foreground">{c.reference.scope === "GENERIC" ? "Generic (standard) code" : c.reference.scope === "MANUFACTURER_SPECIFIC" ? "Manufacturer-specific code" : "Non-standard format"}{c.component ? ` · ${c.component}` : ""}</p>
                {(c.symptoms || c.notes || c.resolution) && <p className="mt-1 text-xs text-muted-foreground">{[c.symptoms && `Symptoms: ${c.symptoms}`, c.notes && `Notes: ${c.notes}`, c.resolution && `Resolution: ${c.resolution}`].filter(Boolean).join(" · ")}</p>}
              </li>
            ))}</ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Diagnostics integrations" description="Optional. AutoVault works fully without any adapter or connected-car service." />
        <CardBody className="space-y-3">
          {providers?.map((p) => (
            <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1"><p className="flex items-center gap-2 font-medium"><Cable className="h-4 w-4" aria-hidden />{p.label}<Badge tone={p.available ? "success" : "neutral"}>{p.available ? "Available" : "Not available"}</Badge></p><p className="mt-1 text-sm text-muted-foreground">{p.reason}</p></div>
              {p.id === "obd-gateway" && canEdit && <Button size="sm" variant="outline" onClick={async () => { const r = await api<any>(`/api/vehicles/${vehicleId}/integrations`, { method: "POST", body: {} }); setToken(r.token); void qc.invalidateQueries(); }}>Create ingest token</Button>}
            </div>
          ))}
          {integ?.map((i) => <div key={i.id} className="flex items-center justify-between rounded-lg bg-muted p-3 text-sm"><span>{i.label} · {i.lastSyncAt ? `last data ${new Date(i.lastSyncAt).toLocaleString()}` : "no data received yet"}{i.latest?.batteryVolts ? ` · battery ${i.latest.batteryVolts} V` : ""}{i.latest?.rpm ? ` · ${i.latest.rpm} rpm` : ""}</span>{canEdit && <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/integrations/${i.id}`, { method: "DELETE" }); toast({ title: "Integration revoked" }); void qc.invalidateQueries(); }}>Revoke</Button>}</div>)}
        </CardBody>
      </Card>
      {token && (
        <Modal open onClose={() => setToken(null)} title="Your ingest token" description="Shown once — store it in your adapter bridge. Only a hash is kept on the server." footer={<Button onClick={() => setToken(null)}>I've saved it</Button>}>
          <div className="flex items-center gap-2"><code className="block flex-1 break-all rounded-md bg-muted p-3 text-xs">{token}</code><Button size="icon" variant="outline" aria-label="Copy token" onClick={() => navigator.clipboard?.writeText(token)}><Copy className="h-4 w-4" /></Button></div>
          <p className="mt-3 text-xs text-muted-foreground">POST JSON to <code>/api/integrations/obd/ingest</code> with header <code>Authorization: Bearer …</code>. Body: <code>{"{ dtcs: [{code}], odometerKm, readings: {rpm, coolantTempC, batteryVolts} }"}</code>.</p>
        </Modal>
      )}
      {adding && <DtcDialog vehicleId={vehicleId} onClose={() => setAdding(false)} />}
    </div>
  );
}

function DtcDialog({ vehicleId, onClose, issueId }: { vehicleId: string; onClose: () => void; issueId?: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useZodForm(dtcSchema.extend({}), { vehicleId, repairIssueId: issueId ?? null, detectedAt: today(), severity: "MODERATE", source: "MANUAL", status: "ACTIVE" });
  const [err, setErr] = React.useState("");
  const code = (form.watch("code") as string) ?? "";
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => { const t = setTimeout(() => setDebounced(code), 300); return () => clearTimeout(t); }, [code]);
  const { data: ref } = useQuery({ queryKey: ["dtc-lookup", debounced], queryFn: () => api<any>(`/api/diagnostics/lookup?code=${encodeURIComponent(debounced)}`), enabled: debounced.trim().length >= 4 });
  const submit = form.handleSubmit(async (v) => {
    try { await api("/api/diagnostics", { method: "POST", body: { ...v, vehicleId } }); toast({ title: "Code recorded" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); }
  });
  return (
    <Modal open onClose={onClose} title="Add diagnostic trouble code" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="dtc-form">Save code</Button></>}>
      <form id="dtc-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Code" error={form.formState.errors.code?.message as string} required>{(p) => <Input {...p} {...form.register("code")} className="font-mono uppercase" placeholder="P0301" />}</Field>
        {ref && <Alert tone={ref.known ? "info" : "warning"} title={ref.known ? `${ref.code}: ${ref.description}` : `${ref.code}${ref.scope === "UNKNOWN_FORMAT" ? " — unrecognised format" : ""}`}>{ref.disclaimer}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date detected" required>{(p) => <Input type="date" {...p} {...form.register("detectedAt")} />}</Field>
          <Field label="Odometer">{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Severity">{(p) => <Select {...p} {...form.register("severity")}>{["LOW", "MODERATE", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
          <Field label="Related component">{(p) => <Input {...p} {...form.register("component")} />}</Field>
        </div>
        <Field label="Your description (optional)">{(p) => <Input {...p} {...form.register("description")} />}</Field>
        <Field label="Symptoms">{(p) => <Input {...p} {...form.register("symptoms")} />}</Field>
        <Field label="Diagnostic notes">{(p) => <Textarea rows={2} {...p} {...form.register("notes")} />}</Field>
      </form>
    </Modal>
  );
}
export { DtcDialog };

// ───────────────────────── Inspections
export function InspectionsPanel({ vehicleId, canWrite }: { vehicleId: string; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({ queryKey: ["inspections", vehicleId], queryFn: () => api<any[]>(`/api/inspections?vehicleId=${vehicleId}`) });
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-3">
      {canWrite && <div className="flex justify-end"><Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Record inspection</Button></div>}
      {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <EmptyState icon={<Search className="h-6 w-6" />} title="No inspections recorded" description="Record inspections to rate components (good / fair / poor / critical). Condition- and inspection-based schedules use them to decide what needs work." /> : (
        <ul className="space-y-2">{data.map((i) => (
          <li key={i.id}><Card><CardBody className="!py-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{titleCase(i.type)} inspection · {f.date(i.date)}</p><p className="text-xs text-muted-foreground">{i.odometerKm != null ? f.distance(i.odometerKm) : "odometer not recorded"}{i.inspector ? ` · ${i.inspector}` : ""}{i.overallCondition ? ` · overall ${i.overallCondition}` : ""}{i.nextDueDate ? ` · next due ${f.date(i.nextDueDate)}` : ""}</p></div>{canWrite && <Button size="icon" variant="ghost" aria-label="Delete inspection" onClick={async () => { if (await confirm({ title: "Delete this inspection?", confirmLabel: "Delete" })) { await api(`/api/inspections/${i.id}`, { method: "DELETE" }); void qc.invalidateQueries(); } }}><Trash2 className="h-4 w-4" /></Button>}</div>
            {i.items.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{i.items.map((x: any, n: number) => <Badge key={n} tone={x.condition === "GOOD" ? "success" : x.condition === "FAIR" ? "warning" : "danger"}>{x.name}: {titleCase(x.condition)}</Badge>)}</ul>}
            {i.notes && <p className="mt-2 text-sm text-muted-foreground">{i.notes}</p>}
          </CardBody></Card></li>
        ))}</ul>
      )}
      {adding && <InspectionDialog vehicleId={vehicleId} onClose={() => setAdding(false)} />}
    </div>
  );
}
function InspectionDialog({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: sched } = useQuery({ queryKey: ["schedules", vehicleId], queryFn: () => api<any>(`/api/vehicles/${vehicleId}/schedules`).then((d) => d.items as any[]) });
  const form = useZodForm(inspectionSchema, { vehicleId, type: "GENERAL", date: today(), items: [], confirmOdometerCorrection: false });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const [err, setErr] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try { await api("/api/inspections", { method: "POST", body: { ...v, items: v.items.map((i: any) => ({ ...i, assignmentId: i.assignmentId || null })) } }); toast({ title: "Inspection recorded — schedules recalculated" }); void qc.invalidateQueries(); onClose(); } catch (e: any) { setErr(e.code === "ODOMETER_REGRESSION" ? `${e.message} Fix the odometer or correct earlier readings.` : applyApiErrors(form, e)); }
  });
  return (
    <Modal open onClose={onClose} size="lg" title="Record inspection" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="insp-form" loading={form.formState.isSubmitting}>Save inspection</Button></>}>
      <form id="insp-form" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date" required>{(p) => <Input type="date" max={today()} {...p} {...form.register("date")} />}</Field>
          <Field label="Odometer">{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Type">{(p) => <Select {...p} {...form.register("type")}>{["GENERAL", "PRE_PURCHASE", "SAFETY", "EMISSIONS", "SEASONAL", "OTHER"].map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>}</Field>
          <Field label="Inspector / shop">{(p) => <Input {...p} {...form.register("inspector")} />}</Field>
          <Field label="Overall condition">{(p) => <Input {...p} {...form.register("overallCondition")} placeholder="e.g. Good" />}</Field>
          <Field label="Next inspection due">{(p) => <Input type="date" {...p} {...form.register("nextDueDate")} />}</Field>
        </div>
        <div className="flex items-center justify-between"><p className="text-sm font-medium">Components inspected</p><Button size="sm" variant="outline" onClick={() => append({ assignmentId: "", name: "", condition: "GOOD", notes: "" })}><Plus className="h-4 w-4" /> Add</Button></div>
        {fields.map((fld, idx) => (
          <div key={fld.id} className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
            <Field label="Schedule item">{(p) => <Select {...p} onChange={(e) => { const s = sched?.find((x) => x.id === e.target.value); form.setValue(`items.${idx}.assignmentId`, e.target.value); if (s) { form.setValue(`items.${idx}.name`, s.name); form.setValue(`items.${idx}.componentKey`, s.componentKey); } }}><option value="">Other component…</option>{sched?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
            <Field label="Name" error={(form.formState.errors.items as any)?.[idx]?.name?.message}>{(p) => <Input {...p} {...form.register(`items.${idx}.name`)} />}</Field>
            <Field label="Condition">{(p) => <Select {...p} {...form.register(`items.${idx}.condition`)}>{["GOOD", "FAIR", "POOR", "CRITICAL"].map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</Select>}</Field>
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => remove(idx)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Field label="Notes">{(p) => <Textarea rows={2} {...p} {...form.register("notes")} />}</Field>
      </form>
    </Modal>
  );
}

// ───────────────────────── Access (household sharing per vehicle)
export function AccessPanel({ v }: { v: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const me = useMe();
  const { data: hhs } = useQuery({ queryKey: ["households"], queryFn: () => api<any[]>("/api/households") });
  const hh = hhs?.find((h) => h.id === v.householdId);
  const [userId, setUserId] = React.useState("");
  const [level, setLevel] = React.useState("VIEWER");
  const [fin, setFin] = React.useState(false);
  const set = async (uid: string, lvl: string, canViewFinancials: boolean) => {
    try { await api(`/api/vehicles/${v.id}/access`, { method: "POST", body: { userId: uid, level: lvl, canViewFinancials } }); toast({ title: "Access updated" }); void qc.invalidateQueries(); } catch (e) { toast({ title: "Couldn't update access", description: (e as Error).message, variant: "error" }); }
  };
  const candidates = (hh?.members ?? []).filter((m: any) => !v.access.some((a: any) => a.userId === m.userId) && m.role !== "ADMIN");
  return (
    <div className="space-y-4">
      <Alert tone="info">Household administrators always have full access. For everyone else, access is limited to the vehicles and permissions you grant here. Invite people from Settings → Household.</Alert>
      <Card><CardHeader title="Who can access this vehicle" /><CardBody>
        <ul className="divide-y divide-border">
          {v.access.map((a: any) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{a.name}{a.userId === me.id && " (you)"}</p><p className="text-xs text-muted-foreground">{a.email}</p></div>
              <Select aria-label={`Access level for ${a.name}`} className="h-9 w-auto" value={a.level} onChange={(e) => set(a.userId, e.target.value, a.canViewFinancials)}>{["OWNER", "CO_OWNER", "MAINTENANCE_MANAGER", "VIEWER"].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}</Select>
              <Checkbox label="Can see costs" checked={a.canViewFinancials} disabled={["OWNER", "CO_OWNER"].includes(a.level)} onChange={(e) => set(a.userId, a.level, e.target.checked)} />
              {a.userId !== me.id && <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/vehicles/${v.id}/access/${a.userId}`, { method: "DELETE" }); toast({ title: "Access removed" }); void qc.invalidateQueries(); }}>Remove</Button>}
            </li>
          ))}
        </ul>
        {candidates.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <Field label="Household member">{(p) => <Select {...p} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Select…</option>{candidates.map((m: any) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</Select>}</Field>
            <Field label="Access level">{(p) => <Select {...p} value={level} onChange={(e) => setLevel(e.target.value)}>{["CO_OWNER", "MAINTENANCE_MANAGER", "VIEWER"].map((l) => <option key={l} value={l}>{titleCase(l)}</option>)}</Select>}</Field>
            <Checkbox label="Can see costs" checked={fin} onChange={(e) => setFin(e.target.checked)} />
            <Button disabled={!userId} onClick={() => set(userId, level, fin)}>Grant access</Button>
          </div>
        )}
      </CardBody></Card>
      <Card><CardHeader title="Access levels" /><CardBody><dl className="grid gap-2 text-sm sm:grid-cols-2">{[["Owner", "Everything, including deleting the vehicle and managing access."], ["Co-owner", "Edit the vehicle, add and change records, see costs."], ["Maintenance manager", "Add and edit services, repairs, parts, fuel and mileage. Costs hidden unless granted."], ["Viewer", "Read-only. Costs hidden unless granted."]].map(([k, d]) => <div key={k}><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{d}</dd></div>)}</dl></CardBody></Card>
    </div>
  );
}
export { odometerUpdateSchema };
