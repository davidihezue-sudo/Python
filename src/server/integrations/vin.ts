import { env } from "@/lib/env";
import { checkVin, normalizeVin } from "@/lib/vin";

export interface DecodedSpec {
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
  engineDisplacementL?: number;
  engineCode?: string;
  engineType?: string;
  fuelType?: "PETROL" | "DIESEL" | "HYBRID" | "PLUGIN_HYBRID" | "ELECTRIC" | "OTHER";
  transmission?: "MANUAL" | "AUTOMATIC" | "CVT" | "DUAL_CLUTCH" | "OTHER";
  drivetrain?: "FWD" | "RWD" | "AWD" | "FOUR_WD";
  bodyType?: string;
}

export interface VinDecodeResult {
  provider: string;
  available: boolean;
  reason?: string;
  vin: string;
  check: ReturnType<typeof checkVin>;
  spec: DecodedSpec;
  warnings: string[];
  disclaimer: string;
}

const DISCLAIMER = "Decoded data is a suggestion. Public VIN decoders are best for North American-market vehicles and can be incomplete or wrong for other markets - review each field; values you've confirmed are never overwritten automatically.";

const clean = (s: unknown) => (typeof s === "string" && s.trim() && !/^not applicable$/i.test(s.trim()) ? s.trim() : undefined);
const title = (s: string) => (s === s.toUpperCase() && s.length > 3 ? s.charAt(0) + s.slice(1).toLowerCase() : s);

export function mapNhtsa(row: Record<string, unknown>): { spec: DecodedSpec; warnings: string[] } {
  const spec: DecodedSpec = {};
  const warnings: string[] = [];
  const make = clean(row.Make);
  if (make) spec.make = title(make);
  const model = clean(row.Model);
  if (model) spec.model = model;
  const yr = Number(clean(row.ModelYear));
  if (Number.isInteger(yr) && yr > 1900) spec.year = yr;
  const trim = clean(row.Trim);
  if (trim) spec.trim = trim;
  const disp = Number(clean(row.DisplacementL));
  if (Number.isFinite(disp) && disp > 0) spec.engineDisplacementL = Math.round(disp * 100) / 100;
  const code = clean(row.EngineModel);
  if (code) spec.engineCode = code;
  const cyl = clean(row.EngineCylinders);
  const turbo = clean(row.Turbo);
  if (disp && cyl) spec.engineType = `${spec.engineDisplacementL}L ${cyl}-cylinder${turbo && /yes/i.test(turbo) ? " turbocharged" : ""}`;
  const fuel = clean(row.FuelTypePrimary)?.toLowerCase() ?? "";
  const sec = clean(row.FuelTypeSecondary)?.toLowerCase() ?? "";
  if (fuel) spec.fuelType = fuel.includes("electric") && !sec ? "ELECTRIC" : fuel.includes("electric") ? "HYBRID" : fuel.includes("diesel") ? "DIESEL" : fuel.includes("gasoline") ? (sec.includes("electric") ? "HYBRID" : "PETROL") : "OTHER";
  const el = clean(row.ElectrificationLevel)?.toLowerCase() ?? "";
  if (el.includes("phev") || el.includes("plug-in")) spec.fuelType = "PLUGIN_HYBRID";
  else if (el.includes("hev") || el.includes("hybrid")) spec.fuelType = "HYBRID";
  else if (el.includes("bev")) spec.fuelType = "ELECTRIC";
  const tr = clean(row.TransmissionStyle)?.toLowerCase() ?? "";
  if (tr) spec.transmission = tr.includes("manual") ? "MANUAL" : tr.includes("dual") ? "DUAL_CLUTCH" : tr.includes("continuously") || tr.includes("cvt") ? "CVT" : tr.includes("automatic") ? "AUTOMATIC" : "OTHER";
  const dt = clean(row.DriveType)?.toLowerCase() ?? "";
  if (dt) spec.drivetrain = dt.includes("awd") || dt.includes("all-wheel") ? "AWD" : dt.includes("4wd") || dt.includes("4-wheel") ? "FOUR_WD" : dt.includes("fwd") || dt.includes("front") ? "FWD" : dt.includes("rwd") || dt.includes("rear") ? "RWD" : undefined;
  const body = clean(row.BodyClass);
  if (body) spec.bodyType = body.replace(/\s*\(.*\)/, "");
  const err = clean(row.ErrorText);
  if (err && String(row.ErrorCode) !== "0") warnings.push(err);
  return { spec, warnings };
}

export async function decodeVin(rawVin: string): Promise<VinDecodeResult> {
  const vin = normalizeVin(rawVin);
  const check = checkVin(vin);
  const base = { provider: "nhtsa", vin, check, spec: {} as DecodedSpec, warnings: [] as string[], disclaimer: DISCLAIMER };
  if (!check.formatOk) return { ...base, available: true, reason: check.message, warnings: [check.message] };
  if (env().VIN_DECODER === "none") return { ...base, available: false, reason: "VIN decoding is disabled on this server (VIN_DECODER=none). Enter the details manually." };
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, { signal: AbortSignal.timeout(8000), headers: { accept: "application/json" } });
    if (!res.ok) return { ...base, available: false, reason: `The NHTSA decoder responded with HTTP ${res.status}. You can enter the details manually.` };
    const body: any = await res.json();
    const row = body?.Results?.[0];
    if (!row) return { ...base, available: false, reason: "The decoder returned no data for this VIN." };
    const { spec, warnings } = mapNhtsa(row);
    if (!check.checkDigitOk) warnings.push(check.message);
    if (!spec.make && !spec.model) warnings.push("The decoder did not recognise this VIN - it may be a non-North-American vehicle.");
    return { ...base, available: true, spec, warnings };
  } catch (e) {
    return { ...base, available: false, reason: `VIN decoding is currently unavailable (${(e as Error).name === "TimeoutError" ? "timed out" : "network error"}). You can enter the details manually.` };
  }
}
