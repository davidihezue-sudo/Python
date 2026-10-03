"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { Gauge, Fuel, Receipt, AlertTriangle, FileUp, Wrench, ClipboardPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/api";
import { newKey, submitOrQueue } from "@/lib/client/offline";
import { today } from "@/lib/client/utils";
import { expenseSchema, fuelSchema, issueCreateSchema, odometerSchema, ocrConfirmSchema } from "@/lib/validation";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { useFormat, useVehicles } from "@/components/shell/providers";
import { DOC_CATEGORIES, EXPENSE_CATEGORIES, PAYMENT_METHODS, VehicleSelect, label, useCategories, useDefaultVehicleId } from "./common";
import { z } from "zod";

export type QuickKind = "mileage" | "fuel" | "expense" | "issue" | "upload";
export interface QuickPreset {
  vehicleId?: string;
  category?: string;
  recordId?: string;
  expenseId?: string;
  issueId?: string;
  partId?: string;
}

interface Ctx {
  open: (kind: QuickKind, preset?: QuickPreset) => void;
}
const QuickAddContext = React.createContext<Ctx>({ open: () => undefined });
export const useQuickAdd = () => React.useContext(QuickAddContext);

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ kind: QuickKind; preset: QuickPreset; n: number } | null>(null);
  const open = React.useCallback((kind: QuickKind, preset: QuickPreset = {}) => setState((s) => ({ kind, preset, n: (s?.n ?? 0) + 1 })), []);
  const close = () => setState(null);
  return (
    <QuickAddContext.Provider value={{ open }}>
      {children}
      {state?.kind === "mileage" && <MileageDialog key={state.n} preset={state.preset} onClose={close} />}
      {state?.kind === "fuel" && <FuelDialog key={state.n} preset={state.preset} onClose={close} />}
      {state?.kind === "expense" && <ExpenseDialog key={state.n} preset={state.preset} onClose={close} />}
      {state?.kind === "issue" && <IssueDialog key={state.n} preset={state.preset} onClose={close} />}
      {state?.kind === "upload" && <UploadDialog key={state.n} preset={state.preset} onClose={close} />}
    </QuickAddContext.Provider>
  );
}

export const QUICK_ACTIONS: { key: string; label: string; icon: React.ElementType; kind?: QuickKind; href?: string }[] = [
  { key: "maintenance", label: "Log maintenance", icon: Wrench, href: "/service-history/new" },
  { key: "repair", label: "Record repair", icon: ClipboardPlus, href: "/service-history/new?kind=REPAIR" },
  { key: "expense", label: "Add vehicle expense", icon: Receipt, kind: "expense" },
  { key: "mileage", label: "Update mileage", icon: Gauge, kind: "mileage" },
  { key: "fuel", label: "Add fuel", icon: Fuel, kind: "fuel" },
  { key: "issue", label: "Report a vehicle issue", icon: AlertTriangle, kind: "issue" },
  { key: "upload", label: "Upload vehicle receipt", icon: FileUp, kind: "upload" },
];

function useDone(onClose: () => void) {
  const qc = useQueryClient();
  const { toast } = useToast();
  return (res: any, message: string) => {
    if (res?.queued) toast({ title: "Saved offline", description: "This will sync automatically when you're back online.", variant: "info" });
    else toast({ title: message });
    void qc.invalidateQueries();
    onClose();
  };
}

// ───────────── Mileage
export function MileageDialog({ preset, onClose }: { preset: QuickPreset; onClose: () => void }) {
  const f = useFormat();
  const done = useDone(onClose);
  const vehicleId = useDefaultVehicleId(preset.vehicleId);
  const { data: vehicles } = useVehicles();
  const form = useZodForm(odometerSchema.extend({ vehicleId: z.string().min(5, "Choose a vehicle") }), { vehicleId, date: today(), valueKm: undefined, note: "", confirmCorrection: false, source: "MANUAL" });
  const [error, setError] = React.useState("");
  const [regression, setRegression] = React.useState<string | null>(null);
  const vid = form.watch("vehicleId");
  const current = vehicles?.find((v) => v.id === vid)?.currentOdometerKm;
  React.useEffect(() => {
    if (!form.getValues("vehicleId") && vehicleId) form.setValue("vehicleId", vehicleId);
  }, [vehicleId, form]);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      const { vehicleId: id, ...body } = v;
      const res = await submitOrQueue(`/api/vehicles/${id}/odometer`, "POST", body, { label: "Odometer reading", queueable: true });
      done(res, "Mileage updated");
    } catch (e) {
      if (e instanceof ApiError && e.code === "ODOMETER_REGRESSION") {
        setRegression(e.message);
        return;
      }
      setError(applyApiErrors(form, e));
    }
  });
  return (
    <Modal open onClose={onClose} title="Update mileage" description="Record the current odometer reading." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="mileage-form" loading={form.formState.isSubmitting}>Save reading</Button></>}>
      <form id="mileage-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Vehicle" error={form.formState.errors.vehicleId?.message as string} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={form.formState.errors.date?.message as string} required>{(p) => <Input type="date" max={today()} {...p} {...form.register("date")} />}</Field>
          <Field label="Odometer" error={form.formState.errors.valueKm?.message as string} hint={current != null ? `Currently ${f.distance(current)}` : undefined} required>{(p) => <Controller control={form.control} name="valueKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <Field label="Note (optional)">{(p) => <Input {...p} {...form.register("note")} placeholder="e.g. before road trip" />}</Field>
        {regression && (
          <Alert tone="warning" title="That reading is lower than an earlier one">
            {regression}
            <div className="mt-2"><Checkbox label="This is a legitimate correction (e.g. a replaced instrument cluster or a typo in an earlier entry)" checked={form.watch("confirmCorrection")} onChange={(e) => form.setValue("confirmCorrection", e.target.checked)} /></div>
          </Alert>
        )}
      </form>
    </Modal>
  );
}

/** Optional: also record this cost as an expense in one of the member's finance accounts, tagged with the vehicle. */
function LedgerAccountPick({ householdId, value, onChange }: { householdId?: string; value: string; onChange: (v: string) => void }) {
  const { data } = useQuery({ queryKey: ["fuel-ledger-accounts", householdId], enabled: !!householdId, queryFn: () => api<{ items: { id: string; name: string; status: string; mine: boolean; joint: boolean; currency: string }[] }>(`/api/finance/${householdId}/accounts?view=my`) });
  const list = (data?.items ?? []).filter((a) => a.status === "ACTIVE" && (a.mine || a.joint));
  if (!householdId || !list.length) return null;
  return (
    <Field label="Also record in my finances (optional)" hint="Adds this cost as an expense in the account you pay from, tagged with the vehicle, so your budgets and reports include it.">
      {(p) => <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Do not record in finances</option>{list.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}
    </Field>
  );
}

// ───────────── Fuel
export function FuelDialog({ preset, onClose }: { preset: QuickPreset; onClose: () => void }) {
  const f = useFormat();
  const done = useDone(onClose);
  const vehicleId = useDefaultVehicleId(preset.vehicleId);
  const { data: vehicles } = useVehicles();
  const key = React.useRef(newKey());
  const form = useZodForm(fuelSchema, { vehicleId, date: today(), unit: f.prefs.volumeUnit, fuelType: "PETROL", fullTank: true, missedPrevious: false, confirmOdometerCorrection: false });
  const [error, setError] = React.useState("");
  const [regression, setRegression] = React.useState<string | null>(null);
  const vid = form.watch("vehicleId");
  React.useEffect(() => {
    if (!form.getValues("vehicleId") && vehicleId) form.setValue("vehicleId", vehicleId);
    const v = vehicles?.find((x) => x.id === (form.getValues("vehicleId") || vehicleId));
    if (v?.fuelType && v.fuelType !== "ELECTRIC") form.setValue("fuelType", v.fuelType);
  }, [vehicleId, vehicles, form]);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      const res = await submitOrQueue("/api/fuel", "POST", { ...v, idempotencyKey: key.current }, { label: "Fuel fill-up", queueable: true });
      done(res, "Fuel entry saved");
    } catch (e) {
      if (e instanceof ApiError && e.code === "ODOMETER_REGRESSION") return setRegression(e.message);
      setError(applyApiErrors(form, e));
    }
  });
  const current = vehicles?.find((v) => v.id === vid)?.currentOdometerKm;
  return (
    <Modal open onClose={onClose} title="Add fuel" description="Log a fill-up. Economy is calculated between full-tank fill-ups." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="fuel-form" loading={form.formState.isSubmitting}>Save fill-up</Button></>}>
      <form id="fuel-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Vehicle" error={form.formState.errors.vehicleId?.message as string} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={form.formState.errors.date?.message as string} required>{(p) => <Input type="date" max={today()} {...p} {...form.register("date")} />}</Field>
          <Field label="Odometer" hint={current != null ? `Currently ${f.distance(current)}` : undefined} error={form.formState.errors.odometerKm?.message as string} required>{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Quantity" error={form.formState.errors.quantity?.message as string} className="col-span-2" required>{(p) => <Input type="number" step="any" inputMode="decimal" {...p} {...form.register("quantity")} />}</Field>
          <Field label="Unit">{(p) => <Select {...p} {...form.register("unit")}><option value="L">Litres</option><option value="GAL_US">US gal</option><option value="GAL_UK">UK gal</option></Select>}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total cost" error={form.formState.errors.totalCost?.message as string} required>{(p) => <Controller control={form.control} name="totalCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Fuel type">{(p) => <Select {...p} {...form.register("fuelType")}>{["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "OTHER"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
        </div>
        <Field label="Station (optional)">{(p) => <Input {...p} {...form.register("station")} />}</Field>
        <LedgerAccountPick householdId={vehicles?.find((x) => x.id === vid)?.householdId} value={form.watch("ledgerAccountId") ?? ""} onChange={(v) => form.setValue("ledgerAccountId", v || null)} />
        <div className="space-y-2">
          <Checkbox label="Full tank (filled to the top)" {...form.register("fullTank")} />
          <Checkbox label="I missed recording an earlier fill-up (skip economy for this one)" {...form.register("missedPrevious")} />
        </div>
        {regression && <Alert tone="warning" title="Odometer lower than a previous reading">{regression}<div className="mt-2"><Checkbox label="This is a legitimate correction" checked={form.watch("confirmOdometerCorrection")} onChange={(e) => form.setValue("confirmOdometerCorrection", e.target.checked)} /></div></Alert>}
      </form>
    </Modal>
  );
}

// ───────────── Expense
export function ExpenseDialog({ preset, onClose }: { preset: QuickPreset; onClose: () => void }) {
  const done = useDone(onClose);
  const { toast } = useToast();
  const vehicleId = useDefaultVehicleId(preset.vehicleId);
  const key = React.useRef(newKey());
  const form = useZodForm(expenseSchema, { vehicleId, date: today(), category: preset.category ?? "OTHER", paymentMethod: "" });
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!form.getValues("vehicleId") && vehicleId) form.setValue("vehicleId", vehicleId);
  }, [vehicleId, form]);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      if (file && typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Attaching a receipt requires a connection. Remove the file or try again online.");
      const res: any = await submitOrQueue("/api/expenses", "POST", { ...v, idempotencyKey: key.current }, { label: "Expense", queueable: !file });
      if (file && res?.id) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("vehicleId", v.vehicleId);
        fd.set("category", v.category === "REPAIRS" ? "REPAIR_RECEIPT" : "MAINTENANCE_INVOICE");
        fd.set("expenseId", res.id);
        try {
          await api("/api/documents", { method: "POST", body: fd });
        } catch (e) {
          toast({ title: "Expense saved, but the receipt failed to upload", description: (e as Error).message, variant: "error" });
        }
      }
      done(res, "Expense added");
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  return (
    <Modal open onClose={onClose} title="Add expense" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="expense-form" loading={form.formState.isSubmitting}>Save expense</Button></>}>
      <form id="expense-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Vehicle" error={form.formState.errors.vehicleId?.message as string} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={form.formState.errors.date?.message as string} required>{(p) => <Input type="date" {...p} {...form.register("date")} />}</Field>
          <Field label="Category" required>{(p) => <Select {...p} {...form.register("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total amount (incl. tax)" error={form.formState.errors.amount?.message as string} required>{(p) => <Controller control={form.control} name="amount" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="of which tax" error={form.formState.errors.tax?.message as string}>{(p) => <Controller control={form.control} name="tax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor">{(p) => <Input {...p} {...form.register("vendor")} />}</Field>
          <Field label="Payment method">{(p) => <Select {...p} {...form.register("paymentMethod")}><option value="">n/a</option>{PAYMENT_METHODS.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        </div>
        <Field label="Description">{(p) => <Input {...p} {...form.register("description")} />}</Field>
        <Field label="Notes">{(p) => <Textarea {...p} {...form.register("notes")} rows={2} />}</Field>
        <Field label="Receipt (optional)" hint="PDF, JPG, PNG or WEBP up to 10 MB">{(p) => <Input {...p} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="h-auto py-2" />}</Field>
      </form>
    </Modal>
  );
}

// ───────────── Issue
export function IssueDialog({ preset, onClose }: { preset: QuickPreset; onClose: () => void }) {
  const f = useFormat();
  const done = useDone(onClose);
  const { toast } = useToast();
  const router = useRouter();
  const vehicleId = useDefaultVehicleId(preset.vehicleId);
  const { data: cats } = useCategories();
  const form = useZodForm(issueCreateSchema, { vehicleId, discoveredAt: today(), severity: "MODERATE", status: "NEW" });
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (!form.getValues("vehicleId") && vehicleId) form.setValue("vehicleId", vehicleId);
  }, [vehicleId, form]);
  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      const res: any = await api("/api/repairs", { method: "POST", body: v });
      for (const file of files) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("vehicleId", v.vehicleId);
        fd.set("category", "ISSUE_PHOTO");
        fd.set("repairIssueId", res.id);
        try {
          await api("/api/documents", { method: "POST", body: fd });
        } catch (e) {
          toast({ title: `Couldn't upload ${file.name}`, description: (e as Error).message, variant: "error" });
        }
      }
      if (res.warnings?.length) toast({ title: "Issue reported", description: res.warnings[0], variant: "info" });
      done(res, "Issue reported");
      router.push(`/repairs?issue=${res.id}`);
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  return (
    <Modal open onClose={onClose} title="Report a vehicle issue" description="Warning light, noise, leak, vibration… Capture it now, diagnose later." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="issue-form" loading={form.formState.isSubmitting}>Report issue</Button></>}>
      <form id="issue-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Vehicle" error={form.formState.errors.vehicleId?.message as string} required>{(p) => <Controller control={form.control} name="vehicleId" render={({ field }) => <VehicleSelect {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="What's wrong?" error={form.formState.errors.title?.message as string} required>{(p) => <Input {...p} {...form.register("title")} placeholder="e.g. Coolant leak, check engine light" />}</Field>
        <Field label="Description">{(p) => <Textarea {...p} {...form.register("description")} rows={3} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date discovered" required>{(p) => <Input type="date" max={today()} {...p} {...form.register("discoveredAt")} />}</Field>
          <Field label="Odometer">{(p) => <Controller control={form.control} name="odometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Severity">{(p) => <Select {...p} {...form.register("severity")}>{["LOW", "MODERATE", "HIGH", "CRITICAL"].map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
          <Field label="Related system">{(p) => <Select {...p} {...form.register("categoryId")}><option value="">n/a</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        </div>
        <Field label="Symptoms">{(p) => <Textarea {...p} {...form.register("symptoms")} rows={2} placeholder="When does it happen? Speed, temperature, noises…" />}</Field>
        <Field label="Estimated repair cost (optional)">{(p) => <Controller control={form.control} name="estimatedCost" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
        <Field label="Photos (optional)" hint="Attach one or more images">{(p) => <Input {...p} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles([...(e.target.files ?? [])])} className="h-auto py-2" />}</Field>
        <p className="text-xs text-muted-foreground">Odometer entered in {f.unitLabel}. You can add diagnostic codes and mechanic findings from the issue page.</p>
      </form>
    </Modal>
  );
}

// ───────────── Upload (receipt / document) with optional OCR → verify → create expense
export function UploadDialog({ preset, onClose }: { preset: QuickPreset; onClose: () => void }) {
  const done = useDone(onClose);
  const { toast } = useToast();
  const qc = useQueryClient();
  const vehicleId = useDefaultVehicleId(preset.vehicleId);
  const [file, setFile] = React.useState<File | null>(null);
  const [vehicle, setVehicle] = React.useState(vehicleId);
  const [category, setCategory] = React.useState(preset.category ?? "MAINTENANCE_INVOICE");
  const [title, setTitle] = React.useState("");
  const [expires, setExpires] = React.useState("");
  const [ocr, setOcr] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<{ document: any; ocr: any; ocrError: string | null } | null>(null);
  React.useEffect(() => setVehicle((v) => v || vehicleId), [vehicleId]);

  const upload = async () => {
    if (!file) return setError("Choose a file first");
    if (!vehicle) return setError("Choose a vehicle");
    if (typeof navigator !== "undefined" && !navigator.onLine) return setError("Uploads need an internet connection.");
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("vehicleId", vehicle);
      fd.set("category", category);
      if (title) fd.set("title", title);
      if (expires) fd.set("expiresOn", expires);
      if (preset.recordId) fd.set("maintenanceRecordId", preset.recordId);
      if (preset.issueId) fd.set("repairIssueId", preset.issueId);
      if (preset.expenseId) fd.set("expenseId", preset.expenseId);
      if (preset.partId) fd.set("partId", preset.partId);
      if (ocr && ["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT"].includes(category)) fd.set("runOcr", "true");
      const res = await api<any>("/api/documents", { method: "POST", body: fd });
      void qc.invalidateQueries();
      if (res.ocr) setResult(res);
      else {
        toast({ title: "Document uploaded", description: res.ocrError ? `Details couldn't be extracted automatically: ${res.ocrError}` : undefined });
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result?.ocr) return <OcrVerify result={result} vehicleId={vehicle} onClose={() => { done(null, "Document saved"); }} />;
  return (
    <Modal open onClose={onClose} title="Upload a document or receipt" description="PDF, JPG, PNG or WEBP, up to 10 MB." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={upload} loading={busy}>Upload</Button></>}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="File" required>{(p) => <Input {...p} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); if (!title && e.target.files?.[0]) setTitle(e.target.files[0].name.replace(/\.[^.]+$/, "")); }} className="h-auto py-2" />}</Field>
        <Field label="Vehicle" required>{(p) => <VehicleSelect {...p} value={vehicle} onChange={setVehicle} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">{(p) => <Select {...p} value={category} onChange={(e) => setCategory(e.target.value)}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
          <Field label="Expires (optional)">{(p) => <Input type="date" {...p} value={expires} onChange={(e) => setExpires(e.target.value)} />}</Field>
        </div>
        <Field label="Title">{(p) => <Input {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        {["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT"].includes(category) && (
          <Checkbox label="Try to extract vendor, date and totals (you'll verify them before anything is saved)" checked={ocr} onChange={(e) => setOcr(e.target.checked)} />
        )}
      </div>
    </Modal>
  );
}

function OcrVerify({ result, vehicleId, onClose }: { result: { document: any; ocr: any }; vehicleId: string; onClose: () => void }) {
  const { toast } = useToast();
  const o = result.ocr;
  const form = useZodForm(ocrConfirmSchema, { vehicleId, vendor: o.vendor ?? "", date: o.date ?? today(), total: o.total ?? "", tax: o.tax ?? "", invoiceNumber: o.invoiceNumber ?? "", category: "MAINTENANCE" });
  const [error, setError] = React.useState("");
  const submit = form.handleSubmit(async (v) => {
    try {
      await api(`/api/documents/${result.document.id}/ocr/confirm`, { method: "POST", body: v });
      toast({ title: "Expense created from verified details" });
      onClose();
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  return (
    <Modal open onClose={onClose} title="Verify extracted details" description="Nothing is saved as an expense until you confirm these values." size="md" footer={<><Button variant="outline" onClick={onClose}>Skip - keep the document only</Button><Button type="submit" form="ocr-form" loading={form.formState.isSubmitting}>Create expense</Button></>}>
      <form id="ocr-form" onSubmit={submit} className="space-y-4" noValidate>
        <Alert tone="warning" title="Automatically extracted - please check carefully">{o.notes?.join(" ")} Confidence: {o.confidence}.</Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vendor">{(p) => <Input {...p} {...form.register("vendor")} />}</Field>
          <Field label="Date" error={form.formState.errors.date?.message as string} required>{(p) => <Input type="date" {...p} {...form.register("date")} />}</Field>
          <Field label="Total" error={form.formState.errors.total?.message as string} required>{(p) => <Controller control={form.control} name="total" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Tax">{(p) => <Controller control={form.control} name="tax" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Invoice number">{(p) => <Input {...p} {...form.register("invoiceNumber")} />}</Field>
          <Field label="Category">{(p) => <Select {...p} {...form.register("category")}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>}</Field>
        </div>
        {o.lineItems?.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-medium">Detected line items (for reference)</p>
            <ul className="space-y-0.5 text-sm text-muted-foreground">{o.lineItems.map((l: any, i: number) => <li key={i}>{l.description}{l.amount != null ? ` - ${l.amount}` : ""} <span className="text-xs">({l.kind})</span></li>)}</ul>
          </div>
        )}
      </form>
    </Modal>
  );
}
