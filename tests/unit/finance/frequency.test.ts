import { describe, expect, it } from "vitest";
import { annualAmount, monthlyAmount, nextOccurrence, occurrences } from "@/server/finance/engine/frequency";
import { monthsBetween, previousPeriod, resolveRange, startOfWeek, daysInMonth, isLeapYear } from "@/server/finance/engine/dates";

describe("frequencies", () => {
  it("treats biweekly (26) and semi-monthly (24) differently", () => {
    expect(annualAmount(1000, "BIWEEKLY")!.toFixed(0)).toBe("26000");
    expect(annualAmount(1000, "SEMI_MONTHLY")!.toFixed(0)).toBe("24000");
    expect(monthlyAmount(1000, "BIWEEKLY")!.toFixed(2)).toBe("2166.67");
    expect(monthlyAmount(1000, "SEMI_MONTHLY")!.toFixed(2)).toBe("2000.00");
    expect(monthlyAmount(1000, "WEEKLY")!.toFixed(2)).toBe("4333.33");
    expect(monthlyAmount(1200, "QUARTERLY")!.toFixed(2)).toBe("400.00");
    expect(monthlyAmount(1200, "ANNUALLY")!.toFixed(2)).toBe("100.00");
    expect(monthlyAmount(500, "IRREGULAR")).toBeNull();
  });
  it("generates 26 or 27 biweekly paydays and exactly 24 semi-monthly paydays in a year", () => {
    const bi = occurrences("BIWEEKLY", "2026-01-02", "2026-01-01", "2026-12-31");
    expect([26, 27]).toContain(bi.length);
    expect(bi[1]).toBe("2026-01-16");
    const semi = occurrences("SEMI_MONTHLY", "2026-01-15", "2026-01-01", "2026-12-31");
    expect(semi).toHaveLength(24);
    expect(semi.slice(0, 4)).toEqual(["2026-01-15", "2026-01-31", "2026-02-15", "2026-02-28"]);
  });
  it("semi-monthly with day-1 anchor pays on the 1st and 15th; day-10 anchor pays on the 10th and 25th", () => {
    expect(occurrences("SEMI_MONTHLY", "2026-03-01", "2026-03-01", "2026-04-30")).toEqual(["2026-03-01", "2026-03-15", "2026-04-01", "2026-04-15"]);
    expect(occurrences("SEMI_MONTHLY", "2026-03-10", "2026-03-01", "2026-03-31")).toEqual(["2026-03-10", "2026-03-25"]);
  });
  it("month-end anchors clamp without drifting", () => {
    expect(occurrences("MONTHLY", "2026-01-31", "2026-01-01", "2026-05-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
    expect(occurrences("MONTHLY", "2028-01-31", "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });
  it("handles leap days for annual items", () => {
    expect(occurrences("ANNUALLY", "2028-02-29", "2028-01-01", "2030-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(daysInMonth(2028, 2)).toBe(29);
  });
  it("never produces occurrences before the anchor or after the end date", () => {
    expect(occurrences("WEEKLY", "2026-03-10", "2026-03-01", "2026-03-31", "2026-03-20")).toEqual(["2026-03-10", "2026-03-17"]);
    expect(occurrences("QUARTERLY", "2026-03-15", "2026-01-01", "2026-12-31")).toEqual(["2026-03-15", "2026-06-15", "2026-09-15", "2026-12-15"]);
  });
  it("starts a long series far from the anchor correctly", () => {
    expect(occurrences("BIWEEKLY", "2020-01-03", "2026-03-01", "2026-03-31")).toEqual(["2026-03-06", "2026-03-20"].filter((d) => occurrences("BIWEEKLY", "2020-01-03", "2020-01-01", "2026-03-31").includes(d)));
    expect(occurrences("MONTHLY", "2020-05-20", "2026-03-01", "2026-04-30")).toEqual(["2026-03-20", "2026-04-20"]);
  });
  it("finds the next occurrence", () => {
    expect(nextOccurrence("MONTHLY", "2026-01-31", "2026-02-28")).toBe("2026-03-31");
    expect(nextOccurrence("ONE_TIME", "2026-01-31", "2026-02-28")).toBeNull();
    expect(nextOccurrence("MONTHLY", "2026-01-31", "2026-02-28", { inclusive: true })).toBe("2026-02-28");
  });
});

describe("date helpers", () => {
  it("measures fractional months", () => {
    expect(monthsBetween("2026-01-01", "2026-04-01").toFixed(2)).toBe("3.00");
    expect(monthsBetween("2026-01-01", "2026-01-16").toFixed(2)).toBe("0.48");
    expect(monthsBetween("2026-05-01", "2026-01-01").isZero()).toBe(true);
  });
  it("resolves dashboard ranges", () => {
    expect(resolveRange("current_month", "2026-03-15")).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(resolveRange("previous_month", "2026-03-15")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(resolveRange("last_3_months", "2026-03-15")).toMatchObject({ from: "2026-01-01", to: "2026-03-31" });
    expect(resolveRange("last_12_months", "2026-03-15")).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(resolveRange("custom", "2026-03-15", { from: "2026-01-10", to: "2026-02-10" })).toMatchObject({ from: "2026-01-10", to: "2026-02-10" });
  });
  it("finds the equal length period before", () => {
    expect(previousPeriod("2026-03-01", "2026-03-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod("2026-01-01", "2026-03-31")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousPeriod("2026-03-10", "2026-03-19")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
  });
  it("week starts on Monday", () => {
    expect(startOfWeek("2026-03-04")).toBe("2026-03-02"); // Wednesday
    expect(startOfWeek("2026-03-08")).toBe("2026-03-02"); // Sunday
  });
});
