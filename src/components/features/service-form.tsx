"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client/api";
import { newKey, submitOrQueue } from "@/lib/client/offline";
import { today } from "@/lib/client/utils";
import { computeTotal, toCents } from "@/lib/money";
import { recordCreateSchema } from "@/lib/validation";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { VehicleSelect, label, useDefaultVehicleId, useProviders } from "@/components/forms/common";
import { useFormat, useVehicles } from "@/components/shell/providers";

const WORK = ["OWNER_DIY", "INDEPENDENT_MECHANIC", "DEALERSHIP", "SPECIALIST_WORKSHOP", "OTHER"];
const STATUS = ["COMPLETED", "IN_PROGRESS", "SCHEDULED", "DRAFT", "CANCELLED"];
const blankItem = { assignmentId: "", name: "", completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: false };

export function ServiceForm({ recordId, initialAssignmentId, initialKind = "MAINTENANCE", initialVehicleId }: { recordId?: string; initialAssignmentId?: string | null; initialKind?: "MAINTENANCE" | "REPAIR"; initialVehicleId?: string | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const f = useFormat();
  const { data: vehicles } = useVehicles();
  const { data: providers } = useProviders();
  const defaultVehicle = useDefaultVehicleId(initialVehicleId);
  const editing = !!recordId;
  const key = React.useRef(newKey());
  const form = useZodForm(recordCreateSchema, { vehicleId: defaultVehicle, kind: initialKind, status: "COMPLETED", serviceDate: today(), workPerformedBy: initialKind === "REPAIR" ? "INDEPENDENT_MECHANIC" : "INDEPENDENT_MECHANIC", items: [], allowDuplicate: false, confirmOdometerCorrection: false });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "items" });
  const [error, setError] = React.useState("");
  const [dup, setDup] = React.useState<string | null>(null);
  const [regression, setRegression] = React.useState<string | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [newProvider, setNewProvider] = React.useState(false);
  const vehicleId = form.watch("vehicleId") as string;
  const kind = form.watch("kind") as string;
  const veh = vehicles?.find((v) => v.id === vehicleId);

  const schedules = useQuery({ queryKey: ["schedules", vehicleId], queryFn: () => api<any>(`/api/vehicles/${vehicleId}/schedules`).then((d) => d.items as any[]), enabled: !!vehicleId });
  const existing = useQuery({ queryKey: ["record", recordId], queryFn: () => api<any>(`/api/maintenance/records/${recordId}`), enabled: editing });
  const prefill = useQuery({ queryKey: ["prefill", initialAssignmentId], queryFn: () => api<any>(`/api/maintenance/records/prefill?assignmentId=${initialAssignmentId}`), enabled: !editing && !!initialAssignmentId });

  // initialise from existing record / prefill / default vehicle
  const initialised = React.useRef(false);
  React.useEffect(() => {
    if (initialised.current) return;
    if (editing && existing.data) {
      const r = existing.data;
      form.reset({ vehicleId: r.vehicleId, kind: r.kind, status: r.status, title: r.title, description: r.description ?? "", serviceDate: r.serviceDate, odometerKm: r.odometerKm, workPerformedBy: r.workPerformedBy, providerId: r.providerId ?? "", mechanicName: r.mechanicName ?? "", location: r.location ?? "", laborCost: r.laborCost, partsCost: r.partsCost, tax: r.tax, discount: r.discount, warrantyInfo: r.warrantyInfo ?? "", notes: r.notes ?? "", items: r.items.map((i: any) => ({ ...i, assignmentId: i.assignmentId ?? "", categoryId: i.categoryId, partName: i.partName ?? "", partManufacturer: i.partManufacturer ?? "", partNumber: i.partNumber ?? "", partOrigin: i.partOrigin ?? "" })), allowDuplicate: false, confirmOdometerCorrection: false });
      initialised.current = true;
    } else if (!editing && initialAssignmentId && prefill.data) {
      const p = prefill.data;
      form.reset({ ...form.getValues(), vehicleId: p.vehicleId, title: p.title, serviceDate: p.serviceDate, odometerKm: p.odometerKm, items: p.items.map((i: any) => ({ ...blankItem, ...i })) });
      initialised.current = true;
    } else if (!editing && !initialAssignmentId && defaultVehicle) {
      if (!form.getValues("vehicleId")) form.setValue("vehicleId", defaultVehicle);
      const cur = vehicles?.find((v) => v.id === (form.getValues("vehicleId") || defaultVehicle))?.currentOdometerKm;
      if (cur != null && form.getValues("odometerKm") == null) form.setValue("odometerKm", cur);
      if (vehicles) initialised.current = true;
    }
  }, [editing, existing.data, prefill.data, initialAssignmentId, defaultVehicle, vehicles, form]);

  // live total
  const w = form.watch();
  const items: any[] = w.items ?? [];
  const itemParts = items.reduce((a, i) => a + Math.round(toCents(Number(i.unitCost) || 0) * (Number(i.quantity) || 0)), 0) / 100;
  const itemLabor = items.reduce((a, i) => a + toCents(Number(i.laborCost) || 0), 0) / 100;
  const total = computeTotal({ partsCost: w.partsCost ?? itemParts, laborCost: w.laborCost ?? itemLabor, tax: Number(w.tax) || 0, discount: Number(w.discount) || 0 });
  const canSeeMoney = veh?.canViewFinancials !== false;

  const pickSchedule = (idx: number, id: string) => {
    form.setValue(`items.${idx}.assignmentId`, id);
    const s = schedules.data?.find((x) => x.id === id);
    if (s) {
      form.setValue(`items.${idx}.name`, s.name);
      form.setValue(`items.${idx}.categoryId`, s.categoryId);
      form.setValue(`items.${idx}.componentKey`, s.componentKey);
      if (!form.getValues("title")) form.setValue("title", s.name);
    }
  };

  const submit = form.handleSubmit(async (v) => {
    setError("");
    setDup(null);
    const body: any = { ...v, providerId: newProvider || !v.providerId ? undefined : v.providerId, providerName: newProvider ? v.providerName : undefined, items: (v.items ?? []).map((i: any) => ({ ...i, assignmentId: i.assignmentId || null, partOrigin: i.partOrigin || null })) };
    try {
      let id = recordId;
      if (editing) {
        delete body.vehicleId; delete body.kind; delete body.idempotencyKey;
        await api(`/api/maintenance/records/${recordId}`, { method: "PATCH", body });
      } else {
        const res: any = await submitOrQueue("/api/maintenance/records", "POST", { ...body, idempotencyKey: key.current }, { label: `Service: ${v.title}`, queueable: files.length === 0 });
        if (res?.queued) {
          toast({ title: "Saved as an offline draft", description: "It will sync when you're back online.", variant: "info" });
          router.push("/service-history");
          return;
        }
        id = res.id;
      }
      if (files.length && id) {
        for (const file of files) {
          const fd = new FormData();
          fd.set("file", file);
          fd.set("vehicleId", v.vehicleId);
          fd.set("category", v.kind === "REPAIR" ? "REPAIR_RECEIPT" : "MAINTENANCE_INVOICE");
          fd.set("maintenanceRecordId", id);
          try { await api("/api/documents", { method: "POST", body: fd }); } catch (e) { toast({ title: `Couldn't upload ${file.name}`, description: (e as Error).message, variant: "error" }); }
        }
      }
      toast({ title: editing ? "Service record updated" : "Service recorded", description: v.status === "COMPLETED" ? "Schedules and the next due dates were recalculated." : undefined });
      void qc.invalidateQueries();
      router.push(`/service-history?record=${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "DUPLICATE_RECORD") return setDup(e.message);
      if (e instanceof ApiError && e.code === "ODOMETER_REGRESSION") return setRegression(e.message);
      setError(applyApiErrors(form, e));
    }
  });
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;

  if (editing && existing.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  const isRepair = kind === "REPAIR";
  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {dup && <Alert tone="warning" title="This looks like a duplicate">{dup}<div className="mt-2"><Checkbox label="It's a different service - save it anyway" onChange={(e) => form.setValue("allowDuplicate", e.target.checked)} /></div></Alert>}
      {regression && <Alert tone="warning" title="Odometer conflicts with earlier readings">{regression}<div className="mt-2"><Checkbox label="This is a legitimate correction" onChange={(e) => form.setValue("confirmOdometerCorrection", e.target.checked)} /></div></Alert>}
      {prefill.data?.note && <Alert tone="info">{prefill.data.note}</Alert>}

      <Card>
        <CardHeader title={isRepair ? "Repair details" : "Service details"} />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {!editing && <Field label="Vehicle" error={err("vehicleId")} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={(v) => { field.onChange(v); form.setValue("items", []); }} />} />}</Field>}
            {!editing && <Field label="Type">{(p) => <Select {...p} {...form.register("kind")}><option value="MAINTENANCE">Routine maintenance</option><option value="REPAIR">Repair (fixing a problem)</option></Select>}</Field>}
            <Field label="Title" error={err("title")} className="sm:col-span-2" required>{(p) => <Input {...p} {...form.register("title")} placeholder={isRepair ? "e.g. Replace water pump" : "e.g. Oil change"} />}</Field>
            <Field label="Service date" error={err("serviceDate")} required>{(p) => <Input type="date" max={today()} {...p} {...form.register("serviceDate")} />}</Field>
            <Field label="Odometer" error={err("odometerKm")} hint={veh?.currentOdometerKm != null ? `Vehicle is currently at ${f.distance(veh.currentOdometerKm)}` : "Recording this also updates the vehicle's mileage"}>{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
            <Field label="Status">{(p) => <Select {...p} {...form.register("status")}>{STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>}</Field>
            <Field label="Work performed by">{(p) => <Select {...p} {...form.register("workPerformedBy")}>{WORK.map((s) => <option key={s} value={s}>{s === "OWNER_DIY" ? "Owner / DIY" : label(s)}</option>)}</Select>}</Field>
          </div>
          {form.watch("status") !== "COMPLETED" && <p className="text-xs text-muted-foreground">Only <strong>completed</strong> records update schedules, mileage and expenses.</p>}
          {form.watch("workPerformedBy") !== "OWNER_DIY" && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Service provider">{(p) => newProvider ? <Input {...p} {...form.register("providerName")} placeholder="Workshop name" /> : <Select {...p} {...form.register("providerId")} onChange={(e) => { if (e.target.value === "__new") { setNewProvider(true); form.setValue("providerId", ""); } else form.setValue("providerId", e.target.value); }}><option value="">n/a</option>{providers?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="__new">+ New provider…</option></Select>}</Field>
              <Field label="Mechanic">{(p) => <Input {...p} {...form.register("mechanicName")} />}</Field>
              <Field label="Location">{(p) => <Input {...p} {...form.register("location")} />}</Field>
            </div>
          )}
          <Field label="Description">{(p) => <Textarea rows={2} {...p} {...form.register("description")} />}</Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Work items" description="Select the schedule items you completed - only these are marked as done. Add several for one workshop visit." action={<Button size="sm" variant="outline" onClick={() => append({ ...blankItem })}><Plus className="h-4 w-4" /> Add item</Button>} />
        <CardBody className="space-y-3">
          {fields.length === 0 && <p className="text-sm text-muted-foreground">No items yet. Add the work you did - e.g. “Engine oil” and “Oil filter”. Items linked to a schedule update its last-done date and next due.</p>}
          {fields.map((fld, idx) => (
            <div key={fld.id} className="rounded-lg border border-border p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Schedule item">{(p) => <Select {...p} value={form.watch(`items.${idx}.assignmentId`) ?? ""} onChange={(e) => pickSchedule(idx, e.target.value)}><option value="">Not linked to a schedule</option>{schedules.data?.filter((s) => s.enabled).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
                <Field label="Item name" error={(form.formState.errors.items as any)?.[idx]?.name?.message} required>{(p) => <Input {...p} {...form.register(`items.${idx}.name`)} />}</Field>
                <div className="flex items-center gap-3 pb-2"><Checkbox label="Completed" {...form.register(`items.${idx}.completed`)} /><Button variant="ghost" size="icon" aria-label="Remove item" onClick={() => remove(idx)}><Trash2 className="h-4 w-4" /></Button></div>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-primary">Parts & cost details</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="Part replaced">{(p) => <Input {...p} {...form.register(`items.${idx}.partName`)} />}</Field>
                  <Field label="Manufacturer">{(p) => <Input {...p} {...form.register(`items.${idx}.partManufacturer`)} />}</Field>
                  <Field label="Part number">{(p) => <Input {...p} {...form.register(`items.${idx}.partNumber`)} />}</Field>
                  <Field label="OEM / aftermarket">{(p) => <Select {...p} {...form.register(`items.${idx}.partOrigin`)}><option value="">Unknown</option><option value="OEM">OEM</option><option value="AFTERMARKET">Aftermarket</option></Select>}</Field>
                  <Field label="Quantity">{(p) => <Input type="number" step="any" {...p} {...form.register(`items.${idx}.quantity`)} />}</Field>
                  {canSeeMoney && <Field label="Unit cost">{(p) => <Controller control={form.control} name={`items.${idx}.unitCost`} render={({ field }) => <MoneyInput {...p} value={field.value} onChange={(v) => field.onChange(v ?? 0)} />} />}</Field>}
                  {canSeeMoney && <Field label="Labour for this item">{(p) => <Controller control={form.control} name={`items.${idx}.laborCost`} render={({ field }) => <MoneyInput {...p} value={field.value} onChange={(v) => field.onChange(v ?? 0)} />} />}</Field>}
                  <Field label="Warranty (months)">{(p) => <Input type="number" {...p} {...form.register(`items.${idx}.warrantyMonths`)} />}</Field>
                </div>
                <div className="mt-2"><Checkbox label="Track this part in the parts inventory (closes the previous installation of this component)" {...form.register(`items.${idx}.trackAsPart`)} /></div>
              </details>
            </div>
          ))}
        </CardBody>
      </Card>

      {canSeeMoney && (
        <Card>
          <CardHeader title="Costs" description="Leave parts/labour blank to add up the item costs automatically." action={<Badge tone="primary">Total {f.money(total, veh?.currency)}</Badge>} />
          <CardBody className="grid gap-3 sm:grid-cols-4">
            <Field label="Parts">{(p) => <Controller control={form.control} name="partsCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
            <Field label="Labour">{(p) => <Controller control={form.control} name="laborCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
            <Field label="Tax">{(p) => <Controller control={form.control} name="tax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
            <Field label="Discount">{(p) => <Controller control={form.control} name="discount" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Warranty, notes & receipts" />
        <CardBody className="space-y-3">
          <Field label="Warranty on this work">{(p) => <Input {...p} {...form.register("warrantyInfo")} placeholder="e.g. 12 months / 20,000 km parts & labour" />}</Field>
          <Field label="Notes">{(p) => <Textarea rows={2} {...p} {...form.register("notes")} />}</Field>
          <Field label="Receipts / invoices / photos" hint="PDF, JPG, PNG or WEBP, up to 10 MB each. Requires a connection.">{(p) => <Input {...p} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} className="h-auto py-2" />}</Field>
        </CardBody>
      </Card>

      <div className="sticky bottom-16 z-10 -mx-1 flex justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-pop backdrop-blur lg:bottom-3">
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" loading={form.formState.isSubmitting}>{editing ? "Save changes" : isRepair ? "Save repair" : "Save service"}</Button>
      </div>
    </form>
  );
}
