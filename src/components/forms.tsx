"use client";
import * as React from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodTypeAny } from "zod";
import { ApiError } from "@/lib/client/api";
import { Input } from "@/components/ui/primitives";
import { useFormat } from "./shell/providers";

export function useZodForm(schema: ZodTypeAny, defaultValues: Record<string, any> = {}): UseFormReturn<any> {
  return useForm<any>({ resolver: zodResolver(schema as any) as any, defaultValues, mode: "onBlur" });
}

/** Maps server-side validation errors (details.fieldErrors) back onto the form's fields. Returns the leftover message. */
export function applyApiErrors(form: UseFormReturn<any>, e: unknown): string {
  if (e instanceof ApiError) {
    let any = false;
    for (const [k, msgs] of Object.entries(e.fieldErrors)) {
      if (k !== "_") {
        form.setError(k as any, { message: msgs[0] });
        any = true;
      }
    }
    return any ? "Please fix the highlighted fields." : e.message;
  }
  return (e as Error)?.message ?? "Something went wrong";
}

/** Numeric input shown in the user's distance unit but bound to kilometres in the form. */
export function DistanceInput({ value, onChange, id, ...rest }: { value: number | null | undefined; onChange: (km: number | null) => void; id?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const f = useFormat();
  const display = (km: number | null | undefined) => (km === null || km === undefined ? "" : String(f.distanceValue(km)));
  const [text, setText] = React.useState(display(value));
  const lastKm = React.useRef<number | null | undefined>(value);
  React.useEffect(() => {
    if (value !== lastKm.current) {
      lastKm.current = value;
      setText(display(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, f.unitLabel]);
  return (
    <div className="relative">
      <Input
        {...rest}
        id={id}
        inputMode="decimal"
        className="pr-12 tabular"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value.replace(/,/g, ""));
          const km = Number.isFinite(n) ? f.toKm(n) : null;
          lastKm.current = km;
          onChange(km);
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{f.unitLabel}</span>
    </div>
  );
}

export function MoneyInput({ value, onChange, id, ...rest }: { value: number | string | null | undefined; onChange: (n: number | null) => void; id?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input {...rest} id={id} inputMode="decimal" className="pl-7 tabular" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : (Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : null))} />
    </div>
  );
}
