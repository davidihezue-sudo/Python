"use client";
import * as React from "react";
import { Controller } from "react-hook-form";
import { Search } from "lucide-react";
import { api } from "@/lib/client/api";
import { vehicleCreateSchema, vehicleUpdateSchema } from "@/lib/validation";
import { checkVin } from "@/lib/vin";
import { Alert, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { DistanceInput, MoneyInput, applyApiErrors, useZodForm } from "@/components/forms";
import { label } from "@/components/forms/common";

const FUEL = ["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "OTHER"];
const TRANS = ["MANUAL", "AUTOMATIC", "CVT", "DUAL_CLUTCH", "OTHER"];
const DRIVE = ["FWD", "RWD", "AWD", "FOUR_WD"];
const OWN = ["OWNED", "FINANCED", "LEASED", "SOLD", "OTHER"];

interface Props {
  mode: "create" | "edit";
  vehicleId?: string;
  defaults?: Record<string, any>;
  confirmedFields?: string[];
  onSaved: (id: string) => void;
  onCancel?: () => void;
  formId?: string;
}

/** One form for creating and editing vehicles. VIN decoding only ever SUGGESTS values; the user chooses what to apply. */
export function VehicleForm({ mode, vehicleId, defaults = {}, onSaved, onCancel, formId = "vehicle-form", confirmedFields = [] }: Props) {
  const schema = mode === "create" ? vehicleCreateSchema : vehicleUpdateSchema;
  const form = useZodForm(schema, { fuelType: "PETROL", ownershipStatus: "OWNED", applySuggestedSchedules: true, ...defaults });
  const [error, setError] = React.useState("");
  const [decode, setDecode] = React.useState<any>(null);
  const [decoding, setDecoding] = React.useState(false);
  const [picked, setPicked] = React.useState<Record<string, boolean>>({});
  const vin = form.watch("vin") as string | undefined;
  const vinCheck = vin ? checkVin(vin) : null;

  const runDecode = async () => {
    setDecoding(true);
    setDecode(null);
    try {
      const res = mode === "edit" && vehicleId ? await api(`/api/vehicles/${vehicleId}/decode-vin`, { method: "POST" }) : await api("/api/vehicles/decode-vin", { method: "POST", body: { vin } });
      const diff = res.diff ?? Object.entries(res.spec ?? {}).map(([field, value]) => ({ field, decoded: value, current: form.getValues(field) ?? null, confirmedByUser: false, same: String(form.getValues(field) ?? "") === String(value) }));
      setDecode({ ...res, diff });
      const init: Record<string, boolean> = {};
      for (const d of diff) init[d.field] = !d.same && !d.confirmedByUser && (d.current === null || d.current === "" || d.current === undefined);
      setPicked(init);
    } catch (e) {
      setDecode({ available: false, reason: (e as Error).message, diff: [] });
    } finally {
      setDecoding(false);
    }
  };
  const applyDecoded = async () => {
    const fields = Object.keys(picked).filter((k) => picked[k]);
    for (const f of fields) form.setValue(f, decode.spec[f], { shouldDirty: true });
    if (mode === "edit" && vehicleId && fields.length) {
      try {
        await api(`/api/vehicles/${vehicleId}/apply-decoded`, { method: "POST", body: { fields } });
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setDecode(null);
  };

  const submit = form.handleSubmit(async (v) => {
    setError("");
    try {
      if (mode === "create") {
        const res = await api<{ id: string }>("/api/vehicles", { method: "POST", body: v });
        onSaved(res.id);
      } else {
        await api(`/api/vehicles/${vehicleId}`, { method: "PATCH", body: v });
        onSaved(vehicleId as string);
      }
    } catch (e) {
      setError(applyApiErrors(form, e));
    }
  });
  const err = (k: string) => form.formState.errors[k]?.message as string | undefined;
  const reg = (k: string) => form.register(k);
  const conf = (k: string) => (confirmedFields.includes(k) ? "You've confirmed this value - decoding won't overwrite it." : undefined);

  return (
    <form id={formId} onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Identity</legend>
        <Field label="Nickname" error={err("nickname")} hint="Shown throughout the app. Defaults to year, make and model.">{(p) => <Input {...p} {...reg("nickname")} />}</Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Make" error={err("make")} required>{(p) => <Input {...p} {...reg("make")} />}</Field>
          <Field label="Model" error={err("model")} required>{(p) => <Input {...p} {...reg("model")} />}</Field>
          <Field label="Model year" error={err("year")} required>{(p) => <Input type="number" {...p} {...reg("year")} />}</Field>
          <Field label="Trim" error={err("trim")}>{(p) => <Input {...p} {...reg("trim")} />}</Field>
          <Field label="Generation" error={err("generation")}>{(p) => <Input {...p} {...reg("generation")} placeholder="e.g. F25" />}</Field>
          <Field label="Body type">{(p) => <Input {...p} {...reg("bodyType")} />}</Field>
        </div>
        <div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="VIN" error={err("vin")} hint={vinCheck ? vinCheck.message : "17 characters. Optional - you can enter everything manually."}>{(p) => <Input {...p} {...reg("vin")} className="font-mono uppercase" maxLength={20} />}</Field>
            <Button variant="outline" onClick={runDecode} loading={decoding} disabled={!vin || !vinCheck?.formatOk}><Search className="h-4 w-4" /> Decode VIN</Button>
          </div>
          {decode && (
            <div className="mt-3 rounded-lg border border-border p-3 text-sm">
              {!decode.available ? (
                <Alert tone="warning" title="VIN decoding unavailable">{decode.reason}</Alert>
              ) : decode.diff.length === 0 ? (
                <p>The decoder returned no usable details. {decode.warnings?.join(" ")}</p>
              ) : (
                <>
                  <p className="mb-2 font-medium">Suggested details from the VIN - choose what to apply</p>
                  <ul className="space-y-1.5">
                    {decode.diff.map((d: any) => (
                      <li key={d.field}>
                        <Checkbox checked={!!picked[d.field]} disabled={d.same} onChange={(e) => setPicked((p) => ({ ...p, [d.field]: e.target.checked }))} label={<span><strong>{label(d.field)}</strong>: {String(d.decoded)} {d.same ? <em className="text-muted-foreground">(already matches)</em> : d.current ? <span className="text-muted-foreground">(currently “{String(d.current)}”{d.confirmedByUser ? ", confirmed by you" : ""})</span> : null}</span>} />
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">{decode.disclaimer}</p>
                  {decode.warnings?.map((w: string) => <p key={w} className="mt-1 text-xs text-warning">{w}</p>)}
                  <div className="mt-3 flex gap-2"><Button size="sm" onClick={applyDecoded}>Apply selected</Button><Button size="sm" variant="ghost" onClick={() => setDecode(null)}>Dismiss</Button></div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Registration / plate">{(p) => <Input {...p} {...reg("registrationNumber")} />}</Field>
          <Field label="Colour">{(p) => <Input {...p} {...reg("colour")} />}</Field>
          <Field label="Market">{(p) => <Input {...p} {...reg("market")} placeholder="e.g. Canada" />}</Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Powertrain</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fuel / propulsion" hint={conf("fuelType")}>{(p) => <Select {...p} {...reg("fuelType")}>{FUEL.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
          <Field label="Transmission">{(p) => <Select {...p} {...reg("transmission")}><option value="">Unknown</option>{TRANS.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
          <Field label="Drivetrain" hint="Used to include or hide AWD/RWD-specific schedules">{(p) => <Select {...p} {...reg("drivetrain")}><option value="">Unknown / not set</option>{DRIVE.map((x) => <option key={x} value={x}>{x === "FOUR_WD" ? "Four-wheel drive" : x === "AWD" ? "All-wheel drive" : x === "FWD" ? "Front-wheel drive" : "Rear-wheel drive"}</option>)}</Select>}</Field>
          <Field label="Engine description" className="sm:col-span-2">{(p) => <Input {...p} {...reg("engineType")} placeholder="e.g. N20 2.0L turbocharged petrol" />}</Field>
          <Field label="Displacement (L)">{(p) => <Input type="number" step="0.1" {...p} {...reg("engineDisplacementL")} />}</Field>
          <Field label="Engine code">{(p) => <Input {...p} {...reg("engineCode")} />}</Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ownership</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ownership status">{(p) => <Select {...p} {...reg("ownershipStatus")}>{OWN.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select>}</Field>
          <Field label="Purchase date">{(p) => <Input type="date" {...p} {...reg("purchaseDate")} />}</Field>
          <Field label="Purchase price">{(p) => <Controller control={form.control} name="purchasePrice" render={({ field }) => <MoneyInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          <Field label="Odometer at purchase">{(p) => <Controller control={form.control} name="purchaseOdometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>
          {mode === "create" && <Field label="Current odometer" hint="You can add this later">{(p) => <Controller control={form.control} name="currentOdometerKm" render={({ field }) => <DistanceInput {...p} value={field.value} onChange={field.onChange} />} />}</Field>}
          <Field label="Currency">{(p) => <Input {...p} {...reg("currency")} maxLength={3} placeholder="e.g. CAD" className="uppercase" />}</Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Insurance, registration & inspection</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Insurance provider">{(p) => <Input {...p} {...reg("insuranceProvider")} />}</Field>
          <Field label="Policy number">{(p) => <Input {...p} {...reg("insurancePolicyNumber")} />}</Field>
          <Field label="Insurance renewal">{(p) => <Input type="date" {...p} {...reg("insuranceRenewalDate")} />}</Field>
          <Field label="Registration expiry">{(p) => <Input type="date" {...p} {...reg("registrationExpiryDate")} />}</Field>
          <Field label="Next inspection due">{(p) => <Input type="date" {...p} {...reg("nextInspectionDate")} />}</Field>
        </div>
        <Field label="Notes">{(p) => <Textarea rows={3} {...p} {...reg("notes")} />}</Field>
      </fieldset>
      {mode === "create" && !defaults.templateKey && <Checkbox label="Add the suggested maintenance checklist (generic starting intervals - you can edit, disable or add your own)" {...form.register("applySuggestedSchedules")} />}
      {onCancel && <div className="hidden"><Button onClick={onCancel}>Cancel</Button></div>}
    </form>
  );
}
