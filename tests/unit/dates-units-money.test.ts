import { describe, expect, it } from "vitest";
import { addDays, addMonths, diffDays, humanizeDays, isIsoDate, todayInTz } from "@/lib/dates";
import { KM_PER_MILE, formatDistance, kmToUnit, litresPer100kmToUnit, unitToKm, unitToLitres, litresToUnit } from "@/lib/units";
import { computeTotal, sumMoney, toCents } from "@/lib/money";

describe("dates", () => {
  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-13-01")).toBe(false);
    expect(isIsoDate("2024-1-1")).toBe(false);
  });
  it("adds months with day clamping", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2023-01-31", 1)).toBe("2023-02-28");
    expect(addMonths("2024-11-15", 3)).toBe("2025-02-15");
    expect(addMonths("2024-03-15", -4)).toBe("2023-11-15");
  });
  it("computes day differences across DST-free UTC arithmetic", () => {
    expect(diffDays("2024-03-11", "2024-03-10")).toBe(1);
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
  });
  it("derives today in a timezone", () => {
    const instant = new Date("2025-01-01T03:30:00Z");
    expect(todayInTz("America/Edmonton", instant)).toBe("2024-12-31");
    expect(todayInTz("UTC", instant)).toBe("2025-01-01");
  });
  it("humanizes durations", () => {
    expect(humanizeDays(3)).toBe("3 days");
    expect(humanizeDays(-92)).toBe("3 months");
  });
});

describe("units", () => {
  it("converts km <-> miles round trip", () => {
    expect(kmToUnit(160.9344, "MI")).toBeCloseTo(100, 6);
    expect(unitToKm(100, "MI")).toBeCloseTo(KM_PER_MILE * 100, 6);
    expect(kmToUnit(123, "KM")).toBe(123);
  });
  it("formats distance with unit label", () => {
    expect(formatDistance(1000, "KM")).toMatch(/1,000 km|1 000 km/);
    expect(formatDistance(1609.344, "MI")).toMatch(/1,000 mi|1 000 mi/);
    expect(formatDistance(null, "KM")).toBe("n/a");
  });
  it("converts volumes", () => {
    expect(unitToLitres(1, "GAL_US")).toBeCloseTo(3.785411784, 6);
    expect(litresToUnit(4.54609, "GAL_UK")).toBeCloseTo(1, 6);
  });
  it("converts fuel economy", () => {
    expect(litresPer100kmToUnit(10, "L_PER_100KM")).toBe(10);
    expect(litresPer100kmToUnit(10, "KM_PER_L")).toBeCloseTo(10, 6);
    // 10 L/100km ≈ 23.52 MPG (US) ≈ 28.25 MPG (UK)
    expect(litresPer100kmToUnit(10, "MPG_US")).toBeCloseTo(23.5215, 3);
    expect(litresPer100kmToUnit(10, "MPG_UK")).toBeCloseTo(28.2481, 3);
  });
});

describe("money", () => {
  it("avoids floating point drift", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents("1.005")).toBe(101);
  });
  it("computes totals with discount and floors at zero", () => {
    expect(computeTotal({ partsCost: 80.5, laborCost: 120, tax: 10.03, discount: 5 })).toBe(205.53);
    expect(computeTotal({ partsCost: 10, discount: 50 })).toBe(0);
  });
});
