"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { AlertTriangle, Camera, CheckCircle2, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { convertIssueSchema, issueUpdateSchema } from "@/lib/validation";
import { today, titleCase } from "@/lib/client/utils";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { ChartCard, StackedBars } from "@/components/ui/charts";
import { IssueStatusBadge, SeverityBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { useQuickAdd } from "@/components/forms/quick-dialogs";
import { label, useCategories } from "@/components/forms/common";
import { useFormat } from "@/components/shell/providers";
import { DtcDialog } from "./vehicle-panels";

const STATUSES = ["NEW", "INVESTIGATING", "DIAGNOSED", "AWAITING_PARTS", "SCHEDULED", "IN_REPAIR", "RESOLVED", "MONITORING", "CLOSED"];

export function IssuesPanel({ vehicleId, openId, canWrite = true }: { vehicleId?: string; openId?: string | null; canWrite?: boolean }) {
  const f = useFormat();
  const { open } = useQuickAdd();
  const [status, setStatus] = React.useState("open");
  const [sev, setSev] = React.useState("");
  const [text, setText] = React.useState("");
  const [detail, setDetail] = React.useState<string | null>(openId ?? null);
  React.useEffect(() => setDetail(openId ?? null), [openId]);
  const params = { vehicleId, open: status === "open" ? "true" : undefined, status: status !== "open" && status !== "all" ? status : undefined, severity: sev, q: text, pageSize: 100 };
  const { data, isLoading } = useQuery({ queryKey: ["issues", params], queryFn: () => api<any>(`/api/repairs${qs(params)}`) });
  const { data: comps } = useQuery({ queryKey: ["repair-components", vehicleId], queryFn: () => api<any[]>(`/api/analytics/components${qs({ vehicleId })}`) });
  const repairComps = (comps ?? []).filter((c) => c.kind === "REPAIR").slice(0, 10).map((c) => ({ ...c, name: titleCase(c.component) }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open issues</option><option value="all">All issues</option>{STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Severity" className="h-9 w-auto" value={sev} onChange={(e) => setSev(e.target.value)}><option value="">Any severity</option>{["LOW", "MODERATE", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Input type="search" aria-label="Search issues" placeholder="Search title, symptoms, codes…" className="h-9 w-56" value={text} onChange={(e) => setText(e.target.value)} />
        {canWrite && <Button size="sm" className="ml-auto" onClick={() => open("issue", { vehicleId })}><Plus className="h-4 w-4" /> Report issue</Button>}
      </div>
      {isLoading ? <Skeleton className="h-40" /> : !data?.items.length ? (
        <EmptyState icon={<AlertTriangle className="h-6 w-6" />} title={status === "open" ? "No outstanding issues" : "No issues found"} description="Report warning lights, noises, leaks or vibrations as soon as you notice them, then track them through diagnosis and repair." action={canWrite ? <Button onClick={() => open("issue", { vehicleId })}>Report an issue</Button> : undefined} />
      ) : (
        <ul className="space-y-2">
          {data.items.map((i: any) => (
            <li key={i.id}><button className="w-full text-left" onClick={() => setDetail(i.id)}><Card className="transition-colors hover:border-primary/50"><CardBody className="flex flex-wrap items-center justify-between gap-2 !py-3">
              <div className="min-w-0"><p className="font-medium">{i.title}</p><p className="text-xs text-muted-foreground">{i.vehicleName} · discovered {f.date(i.discoveredAt)}{i.odometerKm != null ? ` · ${f.distance(i.odometerKm)}` : ""}{i.codes.length ? ` · ${i.codes.map((c: any) => c.code).join(", ")}` : ""}</p></div>
              <div className="flex flex-wrap items-center gap-1.5"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} />{i.actualCost != null ? <Badge>{f.money(i.actualCost, i.currency)}</Badge> : i.estimatedCost != null ? <Badge>est. {f.money(i.estimatedCost, i.currency)}</Badge> : null}</div>
            </CardBody></Card></button></li>
          ))}
        </ul>
      )}
      {repairComps.length > 0 && (
        <ChartCard title="Repair cost history by component" unit="completed repairs" data={repairComps} columns={[{ key: "name", label: "Component" }, { key: "total", label: "Total", fmt: (v) => f.money(v) }, { key: "count", label: "Repairs" }]} height={220}>
          <StackedBars data={repairComps} xKey="name" series={[{ key: "total", label: "Repair cost" }]} fmt={(v) => f.money(v)} />
        </ChartCard>
      )}
      {detail && <IssueDetail id={detail} canWrite={canWrite} onClose={() => setDetail(null)} />}
    </div>
  );
}

function IssueDetail({ id, onClose, canWrite }: { id: string; onClose: () => void; canWrite: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { open } = useQuickAdd();
  const { data: i, isLoading } = useQuery({ queryKey: ["issue", id], queryFn: () => api<any>(`/api/repairs/${id}`) });
  const [editing, setEditing] = React.useState(false);
  const [converting, setConverting] = React.useState(false);
  const [dtc, setDtc] = React.useState(false);
  const setStatus = async (s: string) => {
    try { await api(`/api/repairs/${id}`, { method: "PATCH", body: { status: s } }); toast({ title: `Status: ${label(s)}` }); void qc.invalidateQueries(); } catch (e) { toast({ title: "Couldn't change status", description: (e as Error).message, variant: "error" }); }
  };
  const close = () => { onClose(); if (location.search.includes("issue=")) router.replace(location.pathname); };
  return (
    <Modal open onClose={close} size="lg" title={i?.title ?? "Issue"} description={i ? `${i.vehicleName} · discovered ${f.date(i.discoveredAt)}` : undefined}
      footer={i && canWrite ? <>
        <Button variant="danger" onClick={async () => { if (await confirm({ title: "Delete this issue?", confirmLabel: "Delete" })) { await api(`/api/repairs/${id}`, { method: "DELETE" }); void qc.invalidateQueries(); close(); } }}><Trash2 className="h-4 w-4" /></Button>
        <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit details</Button>
        {!["RESOLVED", "CLOSED"].includes(i.status) && <Button onClick={() => setConverting(true)}><Wrench className="h-4 w-4" /> Convert to completed repair</Button>}
      </> : undefined}>
      {isLoading || !i ? <Skeleton className="h-48" /> : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={i.severity} /><IssueStatusBadge status={i.status} />{i.status === "RESOLVED" && <span className="flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Resolved {f.date(i.resolvedAt)}</span>}</div>
          {canWrite && <Field label="Lifecycle status">{(p) => <Select {...p} value={i.status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s} disabled={i.status === "CLOSED" && s !== "NEW" && s !== "CLOSED"}>{label(s)}</option>)}</Select>}</Field>}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Odometer</dt><dd className="font-medium">{i.odometerKm != null ? f.distance(i.odometerKm) : "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Component</dt><dd className="font-medium">{i.componentKey ? titleCase(i.componentKey) : "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Estimated cost</dt><dd className="font-medium">{i.estimatedCost != null ? f.money(i.estimatedCost, i.currency) : "n/a"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Actual cost</dt><dd className="font-medium">{i.actualCost != null ? f.money(i.actualCost, i.currency) : "n/a"}</dd></div>
          </dl>
          {i.description && <div><h3 className="font-semibold">Description</h3><p className="text-muted-foreground">{i.description}</p></div>}
          {i.symptoms && <div><h3 className="font-semibold">Symptoms</h3><p className="text-muted-foreground">{i.symptoms}</p></div>}
          {i.mechanicAssessment && <div><h3 className="font-semibold">Mechanic assessment</h3><p className="text-muted-foreground">{i.mechanicAssessment}</p></div>}
          {i.resolution && <div><h3 className="font-semibold">Resolution</h3><p className="text-muted-foreground">{i.resolution}</p></div>}
          <div>
            <div className="mb-1 flex items-center justify-between"><h3 className="font-semibold">Diagnostic codes</h3>{canWrite && <Button size="sm" variant="outline" onClick={() => setDtc(true)}><Plus className="h-4 w-4" /> Add code</Button>}</div>
            {i.codes.length === 0 ? <p className="text-muted-foreground">None recorded.</p> : <ul className="space-y-1.5">{i.codes.map((c: any) => <li key={c.id} className="rounded-md bg-muted p-2"><span className="font-mono font-semibold">{c.code}</span> <span className="text-muted-foreground">- {c.description ?? c.reference.description ?? "no description"}{!c.description && c.reference.known ? " (generic meaning, not a diagnosis)" : ""}</span></li>)}</ul>}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><h3 className="font-semibold">Photos & documents</h3>{canWrite && <Button size="sm" variant="outline" onClick={() => open("upload", { vehicleId: i.vehicleId, issueId: i.id, category: "ISSUE_PHOTO" })}><Camera className="h-4 w-4" /> Add</Button>}</div>
            {i.documents.length === 0 ? <p className="text-muted-foreground">Nothing attached.</p> : <div className="flex flex-wrap gap-2">{i.documents.map((d: any) => d.mimeType.startsWith("image/") ? <a key={d.id} href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer"><img src={`/api/documents/${d.id}/file`} alt={d.title} className="h-20 w-20 rounded-md border border-border object-cover" /></a> : <a key={d.id} className="text-primary hover:underline" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{d.title}</a>)}</div>}
          </div>
          {i.repairRecords.length > 0 && <div><h3 className="font-semibold">Repair records</h3><ul>{i.repairRecords.map((r: any) => <li key={r.id}><a className="text-primary hover:underline" href={`/service-history?record=${r.id}`}>{r.title} · {f.date(r.serviceDate)}{r.totalCost != null ? ` · ${f.money(r.totalCost, i.currency)}` : ""}</a></li>)}</ul></div>}
        </div>
      )}
      {editing && i && <EditIssue issue={i} onClose={() => setEditing(false)} />}
      {converting && i && <ConvertIssue issue={i} onClose={() => setConverting(false)} onDone={close} />}
      {dtc && i && <DtcDialog vehicleId={i.vehicleId} issueId={i.id} onClose={() => setDtc(false)} />}
    </Modal>
  );
}

function EditIssue({ issue, onClose }: { issue: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cats } = useCategories();
  const form = useZodForm(issueUpdateSchema, { title: issue.title, description: issue.description ?? "", discoveredAt: issue.discoveredAt, odometerKm: issue.odometerKm, symptoms: issue.symptoms ?? "", severity: issue.severity, componentKey: issue.componentKey ?? "", mechanicAssessment: issue.mechanicAssessment ?? "", estimatedCost: issue.estimatedCost, actualCost: issue.actualCost, resolution: issue.resolution ?? "", categoryId: issue.categoryId ?? "" });
  const [err, setErr] = React.useState("");
  const submit = form.handleSubmit(async (v) => { try { await api(`/api/repairs/${issue.id}`, { method: "PATCH", body: v }); toast({ title: "Issue updated" }); void qc.invalidateQueries(); onClose(); } catch (e) { setErr(applyApiErrors(form, e)); } });
  return (
    <Modal open onClose={onClose} title="Edit issue" size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="edit-issue">Save</Button></>}>
      <form id="edit-issue" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Title" error={form.formState.errors.title?.message as string}>{(p) => <Input {...p} {...form.register("title")} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Date discovered">{(p) => <Input type="date" {...p} {...form.register("discoveredAt")} />}</Field>
          <Field label="Odometer">{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Severity">{(p) => <Select {...p} {...form.register("severity")}>{["LOW", "MODERATE", "HIGH", "CRITICAL"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
          <Field label="Related system">{(p) => <Select {...p} {...form.register("categoryId")}><option value="">n/a</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Component" hint="e.g. water_pump">{(p) => <Input {...p} {...form.register("componentKey")} />}</Field>
          <span />
          <Field label="Estimated cost">{(p) => <Controller control={form.control} name="estimatedCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Actual cost">{(p) => <Controller control={form.control} name="actualCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <Field label="Description">{(p) => <Textarea rows={2} {...p} {...form.register("description")} />}</Field>
        <Field label="Symptoms">{(p) => <Textarea rows={2} {...p} {...form.register("symptoms")} />}</Field>
        <Field label="Mechanic assessment">{(p) => <Textarea rows={2} {...p} {...form.register("mechanicAssessment")} />}</Field>
        <Field label="Resolution details">{(p) => <Textarea rows={2} {...p} {...form.register("resolution")} />}</Field>
      </form>
    </Modal>
  );
}

function ConvertIssue({ issue, onClose, onDone }: { issue: any; onClose: () => void; onDone: () => void }) {
  const f = useFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const form = useZodForm(convertIssueSchema, { serviceDate: today(), odometerKm: issue.odometerKm, workPerformedBy: "INDEPENDENT_MECHANIC", title: `Repair: ${issue.title}`, items: [], confirmOdometerCorrection: false, laborCost: "", partsCost: "" });
  const [err, setErr] = React.useState("");
  const [reg, setReg] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try {
      const r = await api<any>(`/api/repairs/${issue.id}/convert`, { method: "POST", body: { ...v, items: [{ name: v.title || issue.title, componentKey: issue.componentKey ?? undefined, completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false }] } });
      toast({ title: "Repair recorded and issue resolved", description: `Total ${f.money(r.totalCost)} added to your expenses.` });
      void qc.invalidateQueries();
      onClose();
      onDone();
    } catch (e: any) { if (e.code === "ODOMETER_REGRESSION") return setReg(e.message); setErr(applyApiErrors(form, e)); }
  });
  return (
    <Modal open onClose={onClose} title="Convert to completed repair" description="Creates a repair record and expense, and marks the issue resolved." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="convert-issue" loading={form.formState.isSubmitting}>Record repair</Button></>}>
      <form id="convert-issue" onSubmit={submit} className="space-y-3" noValidate>
        {err && <Alert tone="danger">{err}</Alert>}
        <Field label="Repair title">{(p) => <Input {...p} {...form.register("title")} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repair date" required>{(p) => <Input type="date" max={today()} {...p} {...form.register("serviceDate")} />}</Field>
          <Field label="Odometer">{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Parts cost">{(p) => <Controller control={form.control} name="partsCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Labour cost">{(p) => <Controller control={form.control} name="laborCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Tax">{(p) => <Controller control={form.control} name="tax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Done by">{(p) => <Select {...p} {...form.register("workPerformedBy")}>{["OWNER_DIY", "INDEPENDENT_MECHANIC", "DEALERSHIP", "SPECIALIST_WORKSHOP", "OTHER"].map((s) => <option key={s} value={s}>{s === "OWNER_DIY" ? "Owner / DIY" : label(s)}</option>)}</Select>}</Field>
        </div>
        <Field label="Resolution details">{(p) => <Textarea rows={2} {...p} {...form.register("resolution")} />}</Field>
        {reg && <Alert tone="warning">{reg}<div className="mt-2"><label className="flex items-center gap-2"><input type="checkbox" onChange={(e) => form.setValue("confirmOdometerCorrection", e.target.checked)} /> This is a legitimate correction</label></div></Alert>}
      </form>
    </Modal>
  );
}
