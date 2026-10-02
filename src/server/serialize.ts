import type { Prisma } from "@prisma/client";
import { dateToIso } from "@/lib/dates";

type Dec = Prisma.Decimal | number | string | null | undefined;
export const num = (d: Dec): number | null => (d === null || d === undefined ? null : Number(d));
export const num0 = (d: Dec): number => (d === null || d === undefined ? 0 : Number(d));
export const iso = (d: Date | null | undefined) => dateToIso(d);
export const ts = (d: Date | null | undefined) => (d ? d.toISOString() : null);
export const nn = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v);
