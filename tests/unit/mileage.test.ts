import { describe, expect, it } from "vitest";
import { computeUsage, estimateDateForKm, kmAtDate, monthlyDistance, projectKm, validateReading } from "@/server/engine/mileage";

const R = (date: string, valueKm: number) => ({ date, valueKm });

describe("validateReading", () => {
  const existing = [R("2024-01-01", 100000), R("2024-03-01", 103000)];
  it("accepts forward readings", () => {
    expect(validateReading(existing, R("2024-04-01", 104000)).ok).toBe(true);
    expect(validateReading(existing, R("2024-02-01", 101500)).ok).toBe(true);
  });
  it("rejects a reading lower than an earlier one", () => {
    const r = validateReading(existing, R("2024-04-01", 90000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BACKWARD_FROM_PREVIOUS");
  });
  it("rejects a back-dated reading that exceeds a later one", () => {
    const r = validateReading(existing, R("2024-02-01", 105000));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BELOW_NEXT_READING");
  });
  it("allows several readings on the same date", () => {
    expect(validateReading(existing, R("2024-03-01", 103050)).ok).toBe(true);
  });
  it("warns about implausible daily distance but allows it", () => {
    const r = validateReading(existing, R("2024-03-02", 120000));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(1);
  });
});

describe("computeUsage", () => {
  it("returns no estimate with fewer than two readings", () => {
    expect(computeUsage([R("2024-01-01", 1000)]).avgDailyKm).toBeNull();
    expect(computeUsage([R("2024-01-01", 1000), R("2024-01-01", 1010)]).avgDailyKm).toBeNull();
  });
  it("computes average daily/monthly/yearly distance", () => {
    const u = computeUsage([R("2024-01-01", 100000), R("2024-04-10", 104500)]); // 100 days, 4500 km
    expect(u.avgDailyKm).toBeCloseTo(45, 6);
    expect(u.avgMonthlyKm).toBeCloseTo(45 * 30.4375, 3);
    expect(u.avgYearlyKm).toBeCloseTo(45 * 365.25, 3);
    expect(u.confidence).toBe("ok");
  });
  it("flags low confidence for short windows", () => {
    expect(computeUsage([R("2024-01-01", 100), R("2024-01-20", 400)]).confidence).toBe("low");
  });
  it("prefers the trailing 365 days over ancient history", () => {
    const u = computeUsage([R("2018-01-01", 0), R("2023-06-01", 100000), R("2024-06-01", 110000)]);
    expect(u.avgYearlyKm).toBeGreaterThan(9500);
    expect(u.avgYearlyKm).toBeLessThan(10500);
  });
});

describe("projection helpers", () => {
  it("projects future mileage", () => {
    expect(projectKm(R("2024-01-01", 1000), "2024-01-11", 50)).toBe(1500);
    expect(projectKm(null, "2024-01-11", 50)).toBeNull();
  });
  it("estimates the date a threshold is reached", () => {
    expect(estimateDateForKm(1100, R("2024-01-01", 1000), 10, "2024-01-01")).toBe("2024-01-11");
    expect(estimateDateForKm(900, R("2024-01-01", 1000), 10, "2024-01-05")).toBe("2024-01-05");
    expect(estimateDateForKm(1100, R("2024-01-01", 1000), null, "2024-01-01")).toBeNull();
  });
  it("interpolates the odometer", () => {
    const rs = [R("2024-01-01", 1000), R("2024-01-11", 2000)];
    expect(kmAtDate(rs, "2024-01-06")).toBe(1500);
    expect(kmAtDate(rs, "2023-12-31")).toBeNull();
  });
  it("builds monthly distance", () => {
    const m = monthlyDistance([R("2024-01-01", 0), R("2024-03-01", 6000)]);
    expect(m.map((x) => x.month)).toEqual(["2024-01", "2024-02", "2024-03"].slice(0, m.length));
    expect(m[0].km).toBeCloseTo((6000 / 60) * 31, 0);
  });
});
