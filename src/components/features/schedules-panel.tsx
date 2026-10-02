"use client";
import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { CalendarClock, ListChecks, Pencil, Plus, Trash2, Wrench, History as HistoryIcon, Info } from "lucide-react";
import { api, qs } from "@/lib/client/api";
import { assignmentCreateSchema, assignmentUpdateSchema } from "@/lib/validation";
import { Alert, Badge, Button, Card, CardBody, Checkbox, Field, Input, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { EmptyState } from "@/components/ui/empty";
import { Modal, useConfirm } from "@/components/ui/dialog";
import { ScheduleStatusBadge, SOURCE_LABEL, BASIS_LABEL } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { label, useCategories } from "@/components/forms/common";
import { useFormat } from "@/components/shell/providers";
import { cn } from "@/lib/client/utils";

const TRIGGERS: [string, string, string][] = [
  ["MILEAGE", "Mileage-based", "Due every N distance"],
  ["TIME", "Time-based", "Due every N months/days"],
  ["MILEAGE_OR_TIME", "Mileage OR time", "Whichever comes first"],
  ["MILEAGE_AND_TIME", "Mileage AND time", "Only when both have elapsed"],
  ["INSPECTION", "Inspection-based", "Inspect periodically; replace if needed"],
  ["CONDITION", "Condition-based", "Replace when inspection shows wear"],
  ["ONE_TIME", "One-time", "A single due date or odometer target"],
  ["RECURRING", "Recurring (fixed date)", "Repeats on a calendar anchor, e.g. seasonal tires"],
];

export function SchedulesPanel({ vehicleId, canWrite = true }: { vehicleId?: string; canWrite?: boolean }) {
  const f = useFormat();
  const qc = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const single = !!vehicleId && vehicleId !== "all";
  const { data, isLoading } = useQuery({ queryKey: ["schedules", vehicleId ?? "all"], queryFn: () => (single ? api<any>(`/api/vehicles/${vehicleId}/schedules`).then((d) => d.items) : api<any[]>(`/api/maintenance/schedules${qs({ vehicleId })}`)) });
  const [status, setStatus] = React.useState("attention");
  const [cat, setCat] = React.useState("");
  const [text, setText] = React.useState("");
  const [editing, setEditing] = React.useState<any | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  const items = (data ?? []).filter((i: any) => {
    if (status === "attention" && !["OVERDUE", "DUE_NOW", "DUE_SOON", "INSPECTION_REQUIRED", "UPCOMING"].includes(i.status)) return false;
    if (status !== "attention" && status !== "all" && status !== "disabled" && i.status !== status) return false;
    if (status === "disabled" ? i.enabled : !i.enabled && status !== "all") return false;
    if (cat && i.categoryName !== cat) return false;
    if (text && !`${i.name} ${i.vehicleName ?? ""}`.toLowerCase().includes(text.toLowerCase())) return false;
    return true;
  });
  const cats = [...new Set((data ?? []).map((i: any) => i.categoryName))] as string[];
  const counts = (s: string) => (data ?? []).filter((i: any) => i.enabled && i.status === s).length;

  const applyLibrary = async () => {
    setApplying(true);
    try {
      const r = await api<{ created: number }>(`/api/vehicles/${vehicleId}/schedules/apply-library`, { method: "POST", body: {} });
      toast({ title: r.created ? `Added ${r.created} suggested schedules` : "All suggested schedules were already added" });
      void qc.invalidateQueries();
    } catch (e) {
      toast({ title: "Couldn't add schedules", description: (e as Error).message, variant: "error" });
    } finally {
      setApplying(false);
    }
  };
  const del = async (i: any) => {
    if (!(await confirm({ title: `Delete “${i.name}”?`, description: "The schedule is removed from this vehicle. Past service records are not affected.", confirmLabel: "Delete schedule" }))) return;
    await api(`/api/maintenance/schedules/${i.id}`, { method: "DELETE" });
    toast({ title: "Schedule deleted" });
    void qc.invalidateQueries();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-auto">
          <option value="attention">Needs attention ({["OVERDUE", "DUE_NOW", "DUE_SOON", "INSPECTION_REQUIRED", "UPCOMING"].reduce((a, s) => a + counts(s), 0)})</option>
          <option value="all">All schedules</option>
          <option value="OVERDUE">Overdue ({counts("OVERDUE")})</option>
          <option value="DUE_NOW">Due now ({counts("DUE_NOW")})</option>
          <option value="DUE_SOON">Due soon ({counts("DUE_SOON")})</option>
          <option value="UPCOMING">Upcoming ({counts("UPCOMING")})</option>
          <option value="INSPECTION_REQUIRED">Inspection required ({counts("INSPECTION_REQUIRED")})</option>
          <option value="UP_TO_DATE">Up to date ({counts("UP_TO_DATE")})</option>
          <option value="UNKNOWN_HISTORY">Unknown history ({counts("UNKNOWN_HISTORY")})</option>
          <option value="disabled">Disabled</option>
        </Select>
        <Select aria-label="Filter by category" value={cat} onChange={(e) => setCat(e.target.value)} className="h-9 w-auto"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
        <Input aria-label="Search schedules" type="search" placeholder="Search…" value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-40" />
        {single && canWrite && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={applyLibrary} loading={applying}><ListChecks className="h-4 w-4" /> Add suggested checklist</Button>
            <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Custom schedule</Button>
          </div>
        )}
      </div>

      {isLoading ? <Skeleton className="h-48" /> : !data?.length ? (
        <EmptyState icon={<CalendarClock className="h-6 w-6" />} title="No maintenance schedules yet" description="Add the suggested checklist (generic intervals you can edit) or create your own schedules from your owner's manual." action={single && canWrite ? <Button onClick={applyLibrary} loading={applying}>Add suggested checklist</Button> : undefined} />
      ) : items.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-6 w-6" />} title={status === "attention" ? "All configured schedules are currently up to date" : "No schedules match these filters"} description={status === "attention" ? "Nothing is due or approaching. Check “Unknown history” to see items waiting for a recorded service." : undefined} action={status === "attention" ? <Button variant="outline" onClick={() => setStatus("all")}>Show all schedules</Button> : undefined} />
      ) : (
        <ul className="space-y-2">
          {items.map((i: any) => (
            <li key={i.id}>
              <Card className={cn(!i.enabled && "opacity-60")}>
                <CardBody className="flex flex-wrap items-center gap-3 !py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{i.name}</p>
                      <ScheduleStatusBadge status={i.status} />
                      {!i.enabled && <Badge>Disabled</Badge>}
                      {i.priority === "CRITICAL" && <Badge tone="danger">Critical</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{i.vehicleName ? `${i.vehicleName} · ` : ""}{i.categoryName} · {i.summary}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ruleText(i, f)}
                      {i.lastCompletedAt ? ` · last done ${f.date(i.lastCompletedAt)}${i.lastCompletedKm !== null ? ` at ${f.distance(i.lastCompletedKm)}` : ""}` : ""}
                      {i.nextDueKm !== null ? ` · next at ${f.distance(i.nextDueKm)}` : ""}
                      {i.nextDueDate ? ` · by ${f.date(i.nextDueDate)}` : ""}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                      <span title={i.sourceNote ?? ""}>{SOURCE_LABEL[i.sourceType]}</span>
                      {i.estimateBasis?.length > 0 && i.status !== "UNKNOWN_HISTORY" && <span>Estimate based on: {i.estimateBasis.map((b: string) => BASIS_LABEL[b]).join(" + ")}</span>}
                      {i.estimatedMonthsToKm !== null && i.estimatedMonthsToKm > 0 && <span>≈ {i.estimatedMonthsToKm.toFixed(1)} months at your average driving</span>}
                    </p>
                  </div>
                  {canWrite && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Link href={`/service-history/new?assignmentId=${i.id}`}><Button size="sm" variant={["OVERDUE", "DUE_NOW", "DUE_SOON", "INSPECTION_REQUIRED"].includes(i.status) ? "primary" : "outline"}><Wrench className="h-4 w-4" /> Record</Button></Link>
                      <Button size="icon" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${i.name}`} onClick={() => del(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {editing && <ScheduleEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} />}
      {adding && single && <ScheduleEditor vehicleId={vehicleId} onClose={() => setAdding(false)} />}
    </div>
  );
}

export function ruleText(i: any, f: ReturnType<typeof useFormat>) {
  const km = i.intervalKm ? f.distance(i.intervalKm) : null;
  const t = i.intervalMonths ? `${i.intervalMonths} mo` : i.intervalDays ? `${i.intervalDays} days` : null;
  switch (i.triggerType) {
    case "MILEAGE": return `Every ${km}`;
    case "TIME": return `Every ${t}`;
    case "MILEAGE_OR_TIME": return `Every ${km} or ${t}, whichever first`;
    case "MILEAGE_AND_TIME": return `Every ${km} and ${t}`;
    case "INSPECTION": return `Inspect every ${[km, t].filter(Boolean).join(" or ")}`;
    case "CONDITION": return `Replace on condition${t ? ` · re-inspect every ${t}` : ""}`;
    case "ONE_TIME": return `One-time${i.oneTimeDueDate ? ` · ${f.date(i.oneTimeDueDate)}` : ""}${i.oneTimeDueKm ? ` · ${f.distance(i.oneTimeDueKm)}` : ""}`;
    case "RECURRING": return `Repeats every ${t} from ${f.date(i.anchorDate)}`;
  }
  return "";
}

export function ScheduleEditor({ initial, vehicleId, onClose }: { initial?: any; vehicleId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: cats } = useCategories();
  const editing = !!initial;
  const detail = useQuery({ queryKey: ["schedule", initial?.id], queryFn: () => api<any>(`/api/maintenance/schedules/${initial.id}`), enabled: editing });
  const form = useZodForm(editing ? assignmentUpdateSchema : assignmentCreateSchema, editing ? { ...initial, intervalKm: initial.intervalKm, enabled: initial.enabled } : { triggerType: "MILEAGE_OR_TIME", priority: "NORMAL", enabled: true, sourceType: "USER_DEFINED" });
  const [error, setError] = React.useState("");
  const trigger = form.watch("triggerType") as string;
  const wantsKm = ["MILEAGE", "MILEAGE_OR_TIME", "MILEAGE_AND_TIME", "INSPECTION", "CONDITION"].includes(trigger);
  const wantsTime = ["TIME", "MILEAGE_OR_TIME", "MILEAGE_AND_TIME", "INSPECTION", "CONDITION", "RECURRING"].includes(trigger);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      if (editing) await api(`/api/maintenance/schedules/${initial.id}`, { method: "PATCH", body: v });
      else await api("/api/maintenance/schedules", { method: "POST", body: { ...v, vehicleId } });
      toast({ title: editing ? "Schedule updated — due dates recalculated" : "Schedule added" });
      void qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;
  return (
    <Modal open onClose={onClose} size="lg" title={editing ? `Edit “${initial.name}”` : "Add a custom schedule"} description={editing ? "Changing intervals marks this schedule as your own (not a suggestion) and recalculates its status." : "Use intervals from your owner's manual or your mechanic."} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="schedule-form" loading={form.formState.isSubmitting}>{editing ? "Save changes" : "Add schedule"}</Button></>}>
      <form id="schedule-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        {editing && initial.sourceType !== "USER_DEFINED" && <Alert tone="info" title={SOURCE_LABEL[initial.sourceType]}>{initial.sourceNote}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" error={err("name")} required>{(p) => <Input {...p} {...form.register("name")} />}</Field>
          {!editing && <Field label="Category" error={err("categoryId")} required>{(p) => <Select {...p} {...form.register("categoryId")}><option value="">Select…</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>}
          <Field label="Trigger" error={err("triggerType")} hint={TRIGGERS.find((t) => t[0] === trigger)?.[2]}>{(p) => <Select {...p} {...form.register("triggerType")}>{TRIGGERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Priority">{(p) => <Select {...p} {...form.register("priority")}>{["LOW", "NORMAL", "HIGH", "CRITICAL"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {wantsKm && <Field label={trigger === "CONDITION" ? "Re-inspect every (distance)" : trigger === "INSPECTION" ? "Inspect every (distance)" : "Interval (distance)"}>{(p) => <Controller control={form.control} name="intervalKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>}
          {wantsTime && <Field label="Interval (months)">{(p) => <Input type="number" min={1} {...p} {...form.register("intervalMonths")} />}</Field>}
          {wantsTime && <Field label="…plus days">{(p) => <Input type="number" min={1} {...p} {...form.register("intervalDays")} />}</Field>}
          {trigger === "RECURRING" && <Field label="Anchor date" hint="First occurrence; repeats from here">{(p) => <Input type="date" {...p} {...form.register("anchorDate")} />}</Field>}
          {trigger === "ONE_TIME" && <><Field label="Due date">{(p) => <Input type="date" {...p} {...form.register("oneTimeDueDate")} />}</Field><Field label="Or due at odometer">{(p) => <Controller control={form.control} name="oneTimeDueKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field></>}
        </div>
        {err("triggerType") && <p role="alert" className="text-xs text-danger">{err("triggerType")}</p>}
        <div className="rounded-lg border border-border p-3">
          <p className="text-sm font-medium">When was this last done?</p>
          <p className="mb-2 text-xs text-muted-foreground">Optional starting point so due dates can be calculated. It doesn't create an expense; recording a real service later takes over.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date">{(p) => <Input type="date" {...p} {...form.register("baselineDate")} />}</Field>
            <Field label="Odometer">{(p) => <Controller control={form.control} name="baselineKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          </div>
        </div>
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced: thresholds, cost estimate, notes</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="“Due soon” within (distance)" hint="Overrides your default threshold">{(p) => <Input type="number" {...p} {...form.register("dueSoonKm")} />}</Field>
            <Field label="“Due soon” within (days)">{(p) => <Input type="number" {...p} {...form.register("dueSoonDays")} />}</Field>
            <Field label="Estimated cost — min">{(p) => <Controller control={form.control} name="estCostMin" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
            <Field label="Estimated cost — max">{(p) => <Controller control={form.control} name="estCostMax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          </div>
          <Field label="Instructions / notes" className="mt-3">{(p) => <Textarea rows={2} {...p} {...form.register("instructions")} />}</Field>
        </details>
        <Checkbox label="Enabled (disabled schedules aren't tracked or notified)" {...form.register("enabled")} />
        {editing && detail.data?.changeHistory?.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-sm font-medium"><HistoryIcon className="h-4 w-4" /> Change history</p>
            <ul className="text-xs text-muted-foreground">{detail.data.changeHistory.map((h: any) => <li key={h.id}>{new Date(h.at).toLocaleString()} — {h.action}{h.by ? ` by ${h.by}` : ""}</li>)}</ul>
          </div>
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Statuses recalculate whenever your odometer, records or this schedule change. Thresholds for “upcoming” and “due soon” are in Settings.</p>
      </form>
    </Modal>
  );
}
