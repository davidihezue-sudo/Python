"use client";
import { formatDateInTz } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { distanceLabel, fuelEconomyLabel, kmToUnit, roundOdo, unitToKm, volumeLabel, type DistanceUnit, type FuelEconomyUnit, type VolumeUnit } from "@/lib/units";

export interface ClientPrefs {
  currency: string;
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  fuelEconomyUnit: FuelEconomyUnit;
  timezone: string;
  [k: string]: any;
}

/** Formatter bound to the user's preferences. Odometer values on the wire are always kilometres. */
export function makeFormatters(p: ClientPrefs) {
  const nf = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
  return {
    prefs: p,
    unitLabel: distanceLabel(p.distanceUnit),
    volumeLabel: volumeLabel(p.volumeUnit),
    economyLabel: fuelEconomyLabel(p.fuelEconomyUnit),
    distance: (km: number | null | undefined, decimals = 0) => (km === null || km === undefined ? "—" : `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: decimals }).format(kmToUnit(km, p.distanceUnit))} ${distanceLabel(p.distanceUnit)}`),
    distanceValue: (km: number | null | undefined) => (km === null || km === undefined ? null : Math.round(kmToUnit(km, p.distanceUnit))),
    toKm: (v: number) => roundOdo(unitToKm(v, p.distanceUnit)),
    number: (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : new Intl.NumberFormat("en-CA", { maximumFractionDigits: d }).format(n)),
    int: (n: number | null | undefined) => (n === null || n === undefined ? "—" : nf.format(n)),
    money: (n: number | null | undefined, currency?: string) => formatMoney(n, currency ?? p.currency),
    date: (d: string | null | undefined) => formatDateInTz(d ?? null, p.timezone),
    perDistance: (costPerKm: number | null | undefined) => (costPerKm === null || costPerKm === undefined ? "—" : `${formatMoney(costPerKm * (p.distanceUnit === "MI" ? 1.609344 : 1), p.currency)}/${distanceLabel(p.distanceUnit)}`),
  };
}
export type Formatters = ReturnType<typeof makeFormatters>;
