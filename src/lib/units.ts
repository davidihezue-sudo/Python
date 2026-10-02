// Unit conversion. The database stores kilometres and litres; display units are a user preference.
export type DistanceUnit = "KM" | "MI";
export type VolumeUnit = "L" | "GAL_US" | "GAL_UK";
export type FuelEconomyUnit = "L_PER_100KM" | "KM_PER_L" | "MPG_US" | "MPG_UK";

export const KM_PER_MILE = 1.609344;
export const L_PER_GAL_US = 3.785411784;
export const L_PER_GAL_UK = 4.54609;

export function kmToUnit(km: number, unit: DistanceUnit): number {
  return unit === "MI" ? km / KM_PER_MILE : km;
}
export function unitToKm(value: number, unit: DistanceUnit): number {
  return unit === "MI" ? value * KM_PER_MILE : value;
}
export const distanceLabel = (unit: DistanceUnit) => (unit === "MI" ? "mi" : "km");

/** Round to one decimal - the precision used for stored odometer values. */
export function roundOdo(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatDistance(km: number | null | undefined, unit: DistanceUnit, opts: { decimals?: number; locale?: string } = {}): string {
  if (km === null || km === undefined || Number.isNaN(km)) return "n/a";
  const v = kmToUnit(km, unit);
  return `${new Intl.NumberFormat(opts.locale ?? "en-CA", { maximumFractionDigits: opts.decimals ?? 0 }).format(v)} ${distanceLabel(unit)}`;
}

export function litresToUnit(l: number, unit: VolumeUnit): number {
  if (unit === "GAL_US") return l / L_PER_GAL_US;
  if (unit === "GAL_UK") return l / L_PER_GAL_UK;
  return l;
}
export function unitToLitres(v: number, unit: VolumeUnit): number {
  if (unit === "GAL_US") return v * L_PER_GAL_US;
  if (unit === "GAL_UK") return v * L_PER_GAL_UK;
  return v;
}
export const volumeLabel = (unit: VolumeUnit) => (unit === "GAL_US" ? "gal (US)" : unit === "GAL_UK" ? "gal (UK)" : "L");

/** Convert consumption expressed as litres per 100 km into the requested display unit. */
export function litresPer100kmToUnit(lp100: number, unit: FuelEconomyUnit): number {
  if (lp100 <= 0) return NaN;
  switch (unit) {
    case "L_PER_100KM":
      return lp100;
    case "KM_PER_L":
      return 100 / lp100;
    case "MPG_US":
      return (100 / lp100) * L_PER_GAL_US / KM_PER_MILE;
    case "MPG_UK":
      return (100 / lp100) * L_PER_GAL_UK / KM_PER_MILE;
  }
}
export const fuelEconomyLabel = (u: FuelEconomyUnit) =>
  ({ L_PER_100KM: "L/100 km", KM_PER_L: "km/L", MPG_US: "MPG (US)", MPG_UK: "MPG (UK)" })[u];
/** For L/100km lower is better; for the others higher is better. */
export const fuelEconomyLowerIsBetter = (u: FuelEconomyUnit) => u === "L_PER_100KM";

export function isoCurrencyOrDefault(c: string | undefined | null, fallback = "CAD") {
  return c && /^[A-Z]{3}$/.test(c) ? c : fallback;
}
