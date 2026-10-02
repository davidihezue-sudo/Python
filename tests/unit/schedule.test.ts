import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, deriveLastCompletion, describeDue, evaluateRule, maintenanceHealth, nextRecurringOccurrence, type EvalContext, type RuleInput } from "@/server/engine/schedule";

const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({ currentKm: 168000, currentKmDate: "2024-06-01", today: "2024-06-01", avgDailyKm: 1500 / 30.4375, thresholds: DEFAULT_THRESHOLDS, ...over });

describe("mileage rules", () => {
  const rule: RuleInput = { triggerType: "MILEAGE", intervalKm: 10000, lastCompletedKm: 160000, lastCompletedAt: "2023-12-01", sourceType: "SUGGESTED" };
  it("matches the spec example: 10,000 km interval, last 160,000, now 168,000", () => {
    const ev = evaluateRule(rule, ctx());
    expect(ev.nextDueKm).toBe(170000);
    expect(ev.remainingKm).toBe(2000);
    expect(ev.status).toBe("UPCOMING");
    expect(ev.estimatedMonthsToKm).toBeCloseTo(1.333, 2);
    expect(ev.estimateBasis).toEqual(["GENERAL_SUGGESTION", "HISTORICAL_DRIVING"]);
  });
  it("transitions through statuses", () => {
    const at = (km: number) => evaluateRule(rule, ctx({ currentKm: km })).status;
    expect(at(162000)).toBe("UP_TO_DATE");
    expect(at(167000)).toBe("UPCOMING");
    expect(at(169500)).toBe("DUE_SOON");
    expect(at(170000)).toBe("DUE_NOW");
    expect(at(170400)).toBe("DUE_NOW");
    expect(at(170501)).toBe("OVERDUE");
  });
  it("is unknown without history", () => {
    expect(evaluateRule({ triggerType: "MILEAGE", intervalKm: 10000 }, ctx()).status).toBe("UNKNOWN_HISTORY");
  });
  it("is unknown when the current odometer is unknown", () => {
    expect(evaluateRule(rule, ctx({ currentKm: null })).status).toBe("UNKNOWN_HISTORY");
  });
  it("respects per-rule threshold overrides", () => {
    const ev = evaluateRule({ ...rule, dueSoonKm: 3000 }, ctx());
    expect(ev.status).toBe("DUE_SOON");
  });
  it("labels manufacturer data as such", () => {
    expect(evaluateRule({ ...rule, sourceType: "MANUFACTURER" }, ctx()).estimateBasis[0]).toBe("MANUFACTURER");
    expect(evaluateRule({ ...rule, sourceType: "USER_DEFINED" }, ctx()).estimateBasis[0]).toBe("USER_SCHEDULE");
  });
});

describe("time rules", () => {
  const rule: RuleInput = { triggerType: "TIME", intervalMonths: 24, lastCompletedAt: "2022-07-01" };
  it("computes next due date", () => {
    expect(evaluateRule(rule, ctx()).nextDueDate).toBe("2024-07-01");
  });
  it("brake fluid due in 30 days is DUE_SOON", () => {
    const ev = evaluateRule(rule, ctx());
    expect(ev.remainingDays).toBe(30);
    expect(ev.status).toBe("DUE_SOON");
  });
  it("overdue by about 3 months", () => {
    const ev = evaluateRule({ ...rule, lastCompletedAt: "2022-03-01" }, ctx());
    expect(ev.status).toBe("OVERDUE");
    expect(describeDue(ev)).toMatch(/Overdue by 3 months/);
  });
});

describe("combined rules", () => {
  const base: RuleInput = { intervalKm: 10000, intervalMonths: 12, lastCompletedKm: 160000, lastCompletedAt: "2023-12-01", triggerType: "MILEAGE_OR_TIME" };
  it("OR: whichever occurs first drives the status", () => {
    const ev = evaluateRule(base, ctx({ currentKm: 162000 })); // km fine, time: due 2024-12-01 (183 days)
    expect(ev.status).toBe("UP_TO_DATE");
    const ev2 = evaluateRule(base, ctx({ currentKm: 169800 }));
    expect(ev2.status).toBe("DUE_SOON");
    const ev3 = evaluateRule({ ...base, lastCompletedAt: "2023-03-01" }, ctx({ currentKm: 162000 }));
    expect(ev3.status).toBe("OVERDUE");
  });
  it("AND: only due when both conditions are met", () => {
    const and: RuleInput = { ...base, triggerType: "MILEAGE_AND_TIME", lastCompletedAt: "2023-03-01" };
    expect(evaluateRule(and, ctx({ currentKm: 162000 })).status).not.toBe("OVERDUE"); // time passed, km not
    expect(evaluateRule(and, ctx({ currentKm: 175000 })).status).toBe("OVERDUE"); // both passed
  });
  it("effective due date uses the earlier estimate for OR", () => {
    const ev = evaluateRule(base, ctx({ currentKm: 168000 }));
    // km projected ≈ 41 days out, time due in 183 days
    expect(ev.effectiveDueDate).toBe(ev.estimatedKmDueDate);
  });
});

describe("other trigger types", () => {
  it("one-time rule uses date or km, completes once done", () => {
    const r: RuleInput = { triggerType: "ONE_TIME", oneTimeDueDate: "2024-06-10" };
    expect(evaluateRule(r, ctx()).status).toBe("DUE_SOON");
    expect(evaluateRule({ ...r, lastCompletedAt: "2024-06-02" }, ctx()).status).toBe("UP_TO_DATE");
    expect(evaluateRule({ triggerType: "ONE_TIME" }, ctx()).status).toBe("UNKNOWN_HISTORY");
  });
  it("recurring rule anchors on a calendar date", () => {
    const r: RuleInput = { triggerType: "RECURRING", anchorDate: "2024-11-01", intervalMonths: 12 };
    const ev = evaluateRule(r, ctx());
    expect(ev.nextDueDate).toBe("2024-11-01");
    expect(nextRecurringOccurrence("2024-11-01", 12, null, "2024-10-25", 90)).toBe("2025-11-01"); // done early => next year
    expect(nextRecurringOccurrence("2024-11-01", 12, null, "2023-11-03", 90)).toBe("2024-11-01");
  });
  it("inspection rules require an inspection when due", () => {
    const r: RuleInput = { triggerType: "INSPECTION", intervalMonths: 12, lastInspectedAt: "2023-01-01" };
    expect(evaluateRule(r, ctx()).status).toBe("INSPECTION_REQUIRED");
    expect(evaluateRule({ triggerType: "INSPECTION", intervalMonths: 12 }, ctx()).status).toBe("INSPECTION_REQUIRED");
    expect(evaluateRule({ ...r, lastInspectedAt: "2024-05-01" }, ctx()).status).toBe("UP_TO_DATE");
  });
  it("condition rules follow the last inspection rating until the part is replaced", () => {
    const base: RuleInput = { triggerType: "CONDITION", lastCondition: "POOR", lastInspectedAt: "2024-01-01" };
    expect(evaluateRule(base, ctx()).status).toBe("DUE_NOW");
    expect(evaluateRule({ ...base, lastCondition: "GOOD" }, ctx()).status).toBe("UP_TO_DATE");
    expect(evaluateRule({ ...base, lastCondition: "CRITICAL" }, ctx()).status).toBe("OVERDUE");
    expect(evaluateRule({ ...base, lastCompletedAt: "2024-03-01" }, ctx()).status).toBe("UP_TO_DATE");
    expect(evaluateRule({ triggerType: "CONDITION" }, ctx()).status).toBe("UNKNOWN_HISTORY");
  });
});

describe("last completion derivation", () => {
  it("takes the latest event and respects a manual baseline", () => {
    expect(deriveLastCompletion([{ date: "2024-01-01", km: 100 }, { date: "2024-03-01", km: 300 }])).toEqual({ date: "2024-03-01", km: 300 });
    expect(deriveLastCompletion([{ date: "2024-01-01", km: 100 }], { date: "2024-05-01", km: 500 })).toEqual({ date: "2024-05-01", km: 500 });
    expect(deriveLastCompletion([], {})).toBeNull();
  });
});

describe("maintenance health", () => {
  it("returns null score with too little data", () => {
    expect(maintenanceHealth([{ status: "UNKNOWN_HISTORY", priority: "NORMAL" }]).score).toBeNull();
  });
  it("weights by priority", () => {
    const h = maintenanceHealth([
      { status: "UP_TO_DATE", priority: "NORMAL" },
      { status: "UP_TO_DATE", priority: "NORMAL" },
      { status: "OVERDUE", priority: "CRITICAL" },
    ]);
    expect(h.score).toBe(Math.round((100 * 2 + 100 * 2 + 0) / 8));
  });
});
