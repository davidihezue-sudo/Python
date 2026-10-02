import type { Prisma } from "@prisma/client";
import type { DistanceUnit, FuelEconomyUnit, VolumeUnit } from "@/lib/units";
import type { Thresholds } from "./engine/schedule";

export interface Prefs {
  currency: string;
  distanceUnit: DistanceUnit;
  volumeUnit: VolumeUnit;
  fuelEconomyUnit: FuelEconomyUnit;
  timezone: string;
  theme: string;
  notifyInApp: boolean;
  notifyEmail: boolean;
  notifyPush: boolean;
  alertKmBefore: number[];
  alertDaysBefore: number[];
  alertOnDue: boolean;
  alertOnOverdue: boolean;
  thresholds: Thresholds;
  shareHideVin: boolean;
  shareHideCosts: boolean;
  shareHideProviders: boolean;
}

export interface Actor {
  id: string;
  email: string;
  name: string;
  platformRole: "USER" | "PLATFORM_ADMIN";
  emailVerified: boolean;
  prefs: Prefs;
  ip?: string | null;
}

type UserWithPrefs = Prisma.UserGetPayload<{ include: { preference: true } }>;

export const DEFAULT_PREFS: Prefs = {
  currency: "CAD",
  distanceUnit: "KM",
  volumeUnit: "L",
  fuelEconomyUnit: "L_PER_100KM",
  timezone: "America/Edmonton",
  theme: "system",
  notifyInApp: true,
  notifyEmail: true,
  notifyPush: false,
  alertKmBefore: [1000, 500],
  alertDaysBefore: [30, 7],
  alertOnDue: true,
  alertOnOverdue: true,
  thresholds: { upcomingKm: 3000, upcomingDays: 90, dueSoonKm: 1000, dueSoonDays: 30, graceKm: 500, graceDays: 7 },
  shareHideVin: true,
  shareHideCosts: false,
  shareHideProviders: false,
};

export function prefsFromRow(p: UserWithPrefs["preference"]): Prefs {
  if (!p) return DEFAULT_PREFS;
  return {
    currency: p.currency,
    distanceUnit: p.distanceUnit,
    volumeUnit: p.volumeUnit,
    fuelEconomyUnit: p.fuelEconomyUnit,
    timezone: p.timezone,
    theme: p.theme,
    notifyInApp: p.notifyInApp,
    notifyEmail: p.notifyEmail,
    notifyPush: p.notifyPush,
    alertKmBefore: p.alertKmBefore,
    alertDaysBefore: p.alertDaysBefore,
    alertOnDue: p.alertOnDue,
    alertOnOverdue: p.alertOnOverdue,
    thresholds: { upcomingKm: p.upcomingKm, upcomingDays: p.upcomingDays, dueSoonKm: p.dueSoonKm, dueSoonDays: p.dueSoonDays, graceKm: p.graceKm, graceDays: p.graceDays },
    shareHideVin: p.shareHideVin,
    shareHideCosts: p.shareHideCosts,
    shareHideProviders: p.shareHideProviders,
  };
}

export function actorFromUser(u: UserWithPrefs, ip?: string | null): Actor {
  return { id: u.id, email: u.email, name: u.name, platformRole: u.platformRole, emailVerified: !!u.emailVerifiedAt, prefs: prefsFromRow(u.preference), ip };
}
