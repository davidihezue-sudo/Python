"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client/api";
import { Select } from "@/components/ui/primitives";
import { useSelectedVehicle, useVehicles } from "@/components/shell/providers";

export const EXPENSE_CATEGORIES = ["MAINTENANCE", "REPAIRS", "FUEL", "INSURANCE", "REGISTRATION", "TAXES", "PARKING", "CAR_WASH", "TOWING", "ROADSIDE_ASSISTANCE", "TIRES", "ACCESSORIES", "FINANCING", "OTHER"];
export const PAYMENT_METHODS = ["CASH", "DEBIT", "CREDIT", "E_TRANSFER", "CHEQUE", "OTHER"];
export const DOC_CATEGORIES = ["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PARTS_RECEIPT", "PURCHASE", "INSURANCE", "WARRANTY", "REGISTRATION", "INSPECTION_REPORT", "DIAGNOSTIC_REPORT", "VEHICLE_PHOTO", "PART_PHOTO", "ISSUE_PHOTO", "INSPECTION_PHOTO", "OTHER"];
export const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Vehicle picker limited to vehicles the user can write to; defaults to the globally selected vehicle. */
export function VehicleSelect({ value, onChange, writableOnly = true, includeNone, ...rest }: { value?: string | null; onChange: (id: string) => void; writableOnly?: boolean; includeNone?: boolean } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">) {
  const { data } = useVehicles();
  const list = (data ?? []).filter((v) => !writableOnly || v.canWrite);
  return (
    <Select {...rest} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      {includeNone ? <option value="">No specific vehicle</option> : <option value="" disabled>Select a vehicle…</option>}
      {list.map((v) => (
        <option key={v.id} value={v.id}>
          {v.nickname}
        </option>
      ))}
    </Select>
  );
}

export function useDefaultVehicleId(preset?: string | null): string {
  const { vehicleId } = useSelectedVehicle();
  const { data } = useVehicles();
  const writable = (data ?? []).filter((v) => v.canWrite);
  if (preset && writable.some((v) => v.id === preset)) return preset;
  if (vehicleId !== "all" && writable.some((v) => v.id === vehicleId)) return vehicleId;
  return writable[0]?.id ?? "";
}

export function useCategories() {
  return useQuery({ queryKey: ["maintenance-categories"], queryFn: () => api<{ id: string; key: string; name: string }[]>("/api/maintenance/categories"), staleTime: 3600_000 });
}
export function useProviders() {
  return useQuery({ queryKey: ["providers"], queryFn: () => api<{ id: string; name: string; type: string }[]>("/api/providers") });
}
