import { describe, expect, it } from "vitest";
import { resolveRange } from "@/lib/dates";
import { canTransitionIssue, canTransitionRecord, isOpenIssue } from "@/server/engine/status";
import { generateInsights } from "@/server/engine/insights";
import { passwordSchema } from "@/lib/auth/password";
import { assignmentCreateSchema, odometerSchema } from "@/lib/validation";

describe("dashboard date ranges", () => {
  const today = "2024-06-15";
  it("resolves presets", () => {
    expect(resolveRange("30d", today)).toMatchObject({ from: "2024-05-17", to: today });
    expect(resolveRange("90d", today).from).toBe("2024-03-18");
    expect(resolveRange("ytd", today).from).toBe("2024-01-01");
    expect(resolveRange("12m", today).from).toBe("2023-06-16");
    expect(resolveRange("all", today).from).toBeNull();
    expect(resolveRange("custom", today, { from: "2024-02-01", to: "2024-03-01" })).toMatchObject({ from: "2024-02-01", to: "2024-03-01" });
    expect(resolveRange("custom", today, { from: "2024-02-01", to: "2024-01-01" }).to).toBe("2024-02-01");
  });
});

describe("status transitions", () => {
  it("records", () => {
    expect(canTransitionRecord("DRAFT", "COMPLETED")).toBe(true);
    expect(canTransitionRecord("COMPLETED", "DRAFT")).toBe(false);
    expect(canTransitionRecord("COMPLETED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionRecord("CANCELLED", "COMPLETED")).toBe(false);
  });
  it("issues", () => {
    expect(canTransitionIssue("NEW", "RESOLVED")).toBe(true);
    expect(canTransitionIssue("CLOSED", "NEW")).toBe(true);
    expect(canTransitionIssue("CLOSED", "IN_REPAIR")).toBe(false);
    expect(isOpenIssue("MONITORING")).toBe(true);
    expect(isOpenIssue("RESOLVED")).toBe(false);
  });
});

describe("insights", () => {
  const base = { vehicleId: "v1", vehicleName: "X3", today: "2024-06-01", schedules: [], replacements: [], spendLast12: null, spendPrev12: null, fmtMoney: (n: number) => `$${n}`, warranties: [], openIssues: 0, avgMonthlyKmText: null, hasOdometer: true };
  it("flags overdue items with their basis and repeated replacements", () => {
    const out = generateInsights({ ...base, schedules: [{ id: "a", name: "Brake fluid", status: "OVERDUE", summary: "Overdue by 2 months", effectiveDueDate: null, estimatedMonthsToKm: null, estimateBasis: ["GENERAL_SUGGESTION"], enabled: true }], replacements: [{ componentKey: "battery", count: 3, withinMonths24: 2 }] });
    expect(out[0]).toMatchObject({ severity: "critical", title: "Brake fluid is overdue", basis: ["GENERAL_SUGGESTION"] });
    expect(out.some((i) => i.title.includes("battery replaced 3 times"))).toBe(true);
  });
  it("detects spending increases, expiring warranties and missing odometer", () => {
    const out = generateInsights({ ...base, hasOdometer: false, spendPrev12: 1000, spendLast12: 2000, warranties: [{ name: "Powertrain", endDate: "2024-06-20" }] });
    expect(out.map((i) => i.id)).toEqual(expect.arrayContaining(["spend-up", "no-odo"]));
    expect(out.some((i) => i.title.startsWith("Powertrain warranty ends"))).toBe(true);
  });
  it("is silent when nothing is notable", () => {
    expect(generateInsights(base)).toEqual([]);
  });
});

describe("validation schemas", () => {
  it("enforces password policy", () => {
    expect(passwordSchema.safeParse("short1!").success).toBe(false);
    expect(passwordSchema.safeParse("alllettersnonumber").success).toBe(false);
    expect(passwordSchema.safeParse("CorrectHorse9!").success).toBe(true);
  });
  it("requires intervals matching the trigger type", () => {
    const base = { name: "x", categoryId: "cat12345", priority: "NORMAL", sourceType: "USER_DEFINED" };
    expect(assignmentCreateSchema.safeParse({ ...base, triggerType: "MILEAGE" }).success).toBe(false);
    expect(assignmentCreateSchema.safeParse({ ...base, triggerType: "MILEAGE", intervalKm: 10000 }).success).toBe(true);
    expect(assignmentCreateSchema.safeParse({ ...base, triggerType: "MILEAGE_AND_TIME", intervalKm: 10000 }).success).toBe(false);
    expect(assignmentCreateSchema.safeParse({ ...base, triggerType: "RECURRING", intervalMonths: 12 }).success).toBe(false);
    expect(assignmentCreateSchema.safeParse({ ...base, triggerType: "ONE_TIME", oneTimeDueDate: "2025-01-01" }).success).toBe(true);
  });
  it("rejects invalid odometer input", () => {
    expect(odometerSchema.safeParse({ date: "2024-02-30", valueKm: 10 }).success).toBe(false);
    expect(odometerSchema.safeParse({ date: "2024-02-20", valueKm: -5 }).success).toBe(false);
    expect(odometerSchema.safeParse({ date: "2024-02-20", valueKm: "12345.6" }).success).toBe(true);
  });
});
