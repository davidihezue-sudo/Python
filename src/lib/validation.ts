// Shared zod schemas — used by API route handlers (server-side validation) and by forms (client-side).
// Conventions: odometer values are KILOMETRES, volumes are litres unless a unit is supplied, money is in the record's currency.
import { z } from "zod";
import { isIsoDate, isValidTimezone } from "./dates";
import { passwordSchema } from "./auth/password";

export const isoDate = z.string().refine(isIsoDate, "Use a valid date (YYYY-MM-DD)");
export const optDate = z.preprocess((v) => (v === "" ? null : v), isoDate.nullable().optional());
const trimmed = (max = 200) => z.string().trim().max(max);
export const reqStr = (max = 200) => trimmed(max).min(1, "Required");
export const optStr = (max = 200) => z.preprocess((v) => (v === "" || v === undefined ? null : v), trimmed(max).nullable().optional());
export const longText = (max = 4000) => optStr(max);
export const id = z.string().min(5).max(40);
export const optId = z.preprocess((v) => (v === "" ? null : v), id.nullable().optional());
export const km = z.coerce.number().min(0, "Cannot be negative").max(5_000_000, "Unrealistically large");
export const optKm = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), km.nullable().optional());
export const money = z.coerce.number().min(0, "Cannot be negative").max(100_000_000);
export const optMoney = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), money.nullable().optional());
export const currency = z.preprocess((v) => (v === "" || v === null ? undefined : typeof v === "string" ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code").default("CAD"));
const optInt = (min = 0, max = 100_000) => z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int().min(min).max(max).nullable().optional());

export const fuelTypeEnum = z.enum(["PETROL", "DIESEL", "HYBRID", "PLUGIN_HYBRID", "ELECTRIC", "OTHER"]);
export const transmissionEnum = z.enum(["MANUAL", "AUTOMATIC", "CVT", "DUAL_CLUTCH", "OTHER"]);
export const drivetrainEnum = z.enum(["FWD", "RWD", "AWD", "FOUR_WD"]);
export const ownershipEnum = z.enum(["OWNED", "FINANCED", "LEASED", "SOLD", "OTHER"]);
export const distanceUnitEnum = z.enum(["KM", "MI"]);
export const volumeUnitEnum = z.enum(["L", "GAL_US", "GAL_UK"]);
export const fuelEconomyUnitEnum = z.enum(["L_PER_100KM", "KM_PER_L", "MPG_US", "MPG_UK"]);
export const triggerEnum = z.enum(["MILEAGE", "TIME", "MILEAGE_OR_TIME", "MILEAGE_AND_TIME", "CONDITION", "INSPECTION", "ONE_TIME", "RECURRING"]);
export const sourceTypeEnum = z.enum(["MANUFACTURER", "SUGGESTED", "USER_DEFINED"]);
export const priorityEnum = z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
export const recordStatusEnum = z.enum(["DRAFT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const workByEnum = z.enum(["OWNER_DIY", "INDEPENDENT_MECHANIC", "DEALERSHIP", "SPECIALIST_WORKSHOP", "OTHER"]);
export const severityEnum = z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]);
export const issueStatusEnum = z.enum(["NEW", "INVESTIGATING", "DIAGNOSED", "AWAITING_PARTS", "SCHEDULED", "IN_REPAIR", "RESOLVED", "MONITORING", "CLOSED"]);
export const partOriginEnum = z.enum(["OEM", "AFTERMARKET", "UNKNOWN"]);
export const partStatusEnum = z.enum(["INSTALLED", "IN_STORAGE", "REMOVED", "REPLACED", "RETURNED", "UNDER_WARRANTY"]);
export const expenseCategoryEnum = z.enum(["MAINTENANCE", "REPAIRS", "FUEL", "INSURANCE", "REGISTRATION", "TAXES", "PARKING", "CAR_WASH", "TOWING", "ROADSIDE_ASSISTANCE", "TIRES", "ACCESSORIES", "FINANCING", "OTHER"]);
export const paymentEnum = z.enum(["CASH", "DEBIT", "CREDIT", "E_TRANSFER", "CHEQUE", "OTHER"]);
export const docCategoryEnum = z.enum(["MAINTENANCE_INVOICE", "REPAIR_RECEIPT", "PURCHASE", "INSURANCE", "WARRANTY", "REGISTRATION", "INSPECTION_REPORT", "DIAGNOSTIC_REPORT", "PARTS_RECEIPT", "VEHICLE_PHOTO", "PART_PHOTO", "ISSUE_PHOTO", "INSPECTION_PHOTO", "OTHER"]);
export const conditionEnum = z.enum(["GOOD", "FAIR", "POOR", "CRITICAL"]);

// ───────── auth / account
export const registerSchema = z.object({
  name: reqStr(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: passwordSchema,
  timezone: z.string().refine(isValidTimezone).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: "You must accept the privacy policy" }) }),
});
export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) });
export const resetSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
export const verifySchema = z.object({ token: z.string().min(10).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

export const profileSchema = z.object({ name: reqStr(100).optional(), locale: z.string().max(20).optional() });
export const prefsSchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    distanceUnit: distanceUnitEnum,
    volumeUnit: volumeUnitEnum,
    fuelEconomyUnit: fuelEconomyUnitEnum,
    timezone: z.string().refine(isValidTimezone, "Unknown timezone"),
    theme: z.enum(["system", "light", "dark"]),
    notifyInApp: z.boolean(),
    notifyEmail: z.boolean(),
    notifyPush: z.boolean(),
    alertKmBefore: z.array(z.coerce.number().int().min(0).max(100000)).max(6),
    alertDaysBefore: z.array(z.coerce.number().int().min(0).max(730)).max(6),
    alertOnDue: z.boolean(),
    alertOnOverdue: z.boolean(),
    upcomingKm: z.coerce.number().int().min(0).max(100000),
    upcomingDays: z.coerce.number().int().min(0).max(730),
    dueSoonKm: z.coerce.number().int().min(0).max(100000),
    dueSoonDays: z.coerce.number().int().min(0).max(730),
    graceKm: z.coerce.number().int().min(0).max(100000),
    graceDays: z.coerce.number().int().min(0).max(730),
    shareHideVin: z.boolean(),
    shareHideCosts: z.boolean(),
    shareHideProviders: z.boolean(),
  })
  .partial();

// ───────── households
export const householdSchema = z.object({ name: reqStr(100), timezone: z.string().refine(isValidTimezone).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional() });
export const vehicleLevelEnum = z.enum(["OWNER", "CO_OWNER", "MAINTENANCE_MANAGER", "VIEWER"]);
export const vehicleGrant = z.object({ vehicleId: id, level: vehicleLevelEnum, canViewFinancials: z.boolean().default(false) });
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["ADMIN", "MEMBER", "READ_ONLY"]).default("MEMBER"),
  vehicleAccess: z.array(vehicleGrant).max(50).default([]),
});
export const memberUpdateSchema = z.object({ role: z.enum(["ADMIN", "MEMBER", "READ_ONLY"]).optional() });

// ───────── vehicles
const year = z.coerce.number().int().min(1886).max(new Date().getFullYear() + 2);
export const vehicleBase = z.object({
  nickname: optStr(100),
  make: reqStr(80),
  model: reqStr(80),
  year,
  trim: optStr(80),
  generation: optStr(80),
  engineType: optStr(120),
  engineDisplacementL: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().min(0).max(20).nullable().optional()),
  engineCode: optStr(40),
  fuelType: fuelTypeEnum.default("PETROL"),
  transmission: z.preprocess((v) => (v === "" ? null : v), transmissionEnum.nullable().optional()),
  drivetrain: z.preprocess((v) => (v === "" ? null : v), drivetrainEnum.nullable().optional()),
  vin: z.preprocess((v) => (v === "" ? null : typeof v === "string" ? v.replace(/[\s-]/g, "").toUpperCase() : v), z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q)").nullable().optional()),
  registrationNumber: optStr(30),
  colour: optStr(40),
  bodyType: optStr(60),
  market: optStr(60),
  purchaseDate: optDate,
  purchasePrice: optMoney,
  purchaseOdometerKm: optKm,
  ownershipStatus: ownershipEnum.default("OWNED"),
  currency: currency.optional(),
  insuranceProvider: optStr(100),
  insurancePolicyNumber: optStr(60),
  insuranceRenewalDate: optDate,
  registrationExpiryDate: optDate,
  nextInspectionDate: optDate,
  notes: longText(4000),
});
export const vehicleCreateSchema = vehicleBase.extend({
  householdId: id.optional(),
  currentOdometerKm: optKm,
  odometerDate: optDate,
  templateKey: optStr(60),
  applySuggestedSchedules: z.boolean().default(true),
  useDecodedSpec: z.any().optional(),
});
export const vehicleUpdateSchema = vehicleBase.partial().extend({ photoDocumentId: optId });
export const vehicleAccessSchema = z.object({ userId: id, level: vehicleLevelEnum, canViewFinancials: z.boolean().optional() });
export const ownershipSchema = z.object({ ownerName: reqStr(120), fromDate: isoDate, toDate: optDate, fromOdometerKm: optKm, toOdometerKm: optKm, notes: longText(1000) });

// ───────── odometer
export const odometerSchema = z.object({
  date: isoDate,
  valueKm: km,
  source: z.enum(["MANUAL", "MAINTENANCE", "FUEL", "INSPECTION", "REPAIR", "IMPORT", "INTEGRATION", "PURCHASE"]).default("MANUAL"),
  note: optStr(500),
  confirmCorrection: z.boolean().default(false),
});
export const odometerUpdateSchema = z.object({ date: isoDate.optional(), valueKm: km.optional(), note: optStr(500), confirmCorrection: z.boolean().default(false) });

// ───────── scheduling
const scheduleCore = {
  name: reqStr(120),
  categoryId: id,
  description: longText(1000),
  componentKey: reqStr(60).regex(/^[a-z0-9_]+$/, "lowercase letters, digits, underscores").optional(),
  triggerType: triggerEnum,
  intervalKm: optKm,
  intervalMonths: optInt(1, 600),
  intervalDays: optInt(1, 20000),
  priority: priorityEnum.default("NORMAL"),
  estCostMin: optMoney,
  estCostMax: optMoney,
  instructions: longText(2000),
  sourceType: sourceTypeEnum.default("USER_DEFINED"),
  sourceNote: optStr(300),
};
const triggerCheck = (v: any, ctx: z.RefinementCtx) => {
  const t = v.triggerType;
  const hasKm = v.intervalKm != null && v.intervalKm > 0;
  const hasTime = (v.intervalMonths ?? 0) > 0 || (v.intervalDays ?? 0) > 0;
  const need = (ok: boolean, msg: string) => ok || ctx.addIssue({ code: "custom", message: msg, path: ["triggerType"] });
  if (t === "MILEAGE") need(hasKm, "Mileage-based rules need a distance interval");
  if (t === "TIME") need(hasTime, "Time-based rules need a time interval");
  if (t === "MILEAGE_OR_TIME" || t === "MILEAGE_AND_TIME") need(hasKm && hasTime, "Both a distance and a time interval are required");
  if (t === "RECURRING") need(hasTime && !!v.anchorDate, "Recurring rules need a time interval and an anchor date");
  if (t === "ONE_TIME") need(!!v.oneTimeDueDate || v.oneTimeDueKm != null, "One-time rules need a due date or odometer target");
  if (t === "INSPECTION") need(hasKm || hasTime, "Inspection rules need an inspection interval");
};
export const assignmentCreateSchema = z
  .object({ vehicleId: id.optional(), ...scheduleCore, anchorDate: optDate, oneTimeDueDate: optDate, oneTimeDueKm: optKm, baselineDate: optDate, baselineKm: optKm, enabled: z.boolean().default(true), dueSoonKm: optInt(0, 100000), dueSoonDays: optInt(0, 730) })
  .superRefine(triggerCheck);
export const assignmentUpdateSchema = z
  .object({
    name: reqStr(120).optional(),
    description: longText(1000),
    triggerType: triggerEnum.optional(),
    intervalKm: optKm,
    intervalMonths: optInt(1, 600),
    intervalDays: optInt(1, 20000),
    anchorDate: optDate,
    oneTimeDueDate: optDate,
    oneTimeDueKm: optKm,
    priority: priorityEnum.optional(),
    estCostMin: optMoney,
    estCostMax: optMoney,
    instructions: longText(2000),
    sourceType: sourceTypeEnum.optional(),
    sourceNote: optStr(300),
    enabled: z.boolean().optional(),
    dueSoonKm: optInt(0, 100000),
    dueSoonDays: optInt(0, 730),
    alertKmBefore: z.array(z.coerce.number().int().min(0)).max(6).optional(),
    alertDaysBefore: z.array(z.coerce.number().int().min(0)).max(6).optional(),
    baselineDate: optDate,
    baselineKm: optKm,
  });
export const applyLibrarySchema = z.object({ keys: z.array(z.string().max(80)).max(300).optional() });
export const scheduleTemplateSchema = z.object({ ...scheduleCore, anchorDate: optDate, oneTimeDueDate: optDate, oneTimeDueKm: optKm }).superRefine(triggerCheck);

// ───────── maintenance records
export const recordItemSchema = z.object({
  assignmentId: optId,
  categoryId: optId,
  componentKey: z.preprocess((v) => (v === "" ? null : v), z.string().max(60).nullable().optional()),
  name: reqStr(160),
  description: optStr(1000),
  completed: z.boolean().default(true),
  partName: optStr(160),
  partManufacturer: optStr(120),
  partNumber: optStr(80),
  partOrigin: z.preprocess((v) => (v === "" ? null : v), partOriginEnum.nullable().optional()),
  quantity: z.coerce.number().min(0).max(10000).default(1),
  unitCost: money.default(0),
  laborCost: money.default(0),
  trackAsPart: z.boolean().default(false),
  warrantyMonths: optInt(0, 600),
});
export const recordCreateSchema = z.object({
  vehicleId: id,
  kind: z.enum(["MAINTENANCE", "REPAIR"]).default("MAINTENANCE"),
  status: recordStatusEnum.default("COMPLETED"),
  title: reqStr(160),
  description: longText(2000),
  serviceDate: isoDate,
  odometerKm: optKm,
  workPerformedBy: workByEnum.default("INDEPENDENT_MECHANIC"),
  providerId: optId,
  providerName: optStr(120),
  mechanicName: optStr(120),
  location: optStr(200),
  laborCost: optMoney,
  partsCost: optMoney,
  tax: optMoney,
  discount: optMoney,
  currency: currency.optional(),
  warrantyInfo: optStr(500),
  notes: longText(4000),
  repairIssueId: optId,
  items: z.array(recordItemSchema).max(60).default([]),
  idempotencyKey: z.string().min(8).max(80).optional(),
  allowDuplicate: z.boolean().default(false),
  confirmOdometerCorrection: z.boolean().default(false),
  paymentMethod: z.preprocess((v) => (v === "" ? null : v), paymentEnum.nullable().optional()),
});
export const recordUpdateSchema = recordCreateSchema.omit({ vehicleId: true, idempotencyKey: true, kind: true }).partial();

// ───────── repairs
export const issueCreateSchema = z.object({
  vehicleId: id,
  title: reqStr(160),
  description: longText(3000),
  discoveredAt: isoDate,
  odometerKm: optKm,
  symptoms: longText(2000),
  severity: severityEnum.default("MODERATE"),
  status: issueStatusEnum.default("NEW"),
  componentKey: optStr(60),
  categoryId: optId,
  mechanicAssessment: longText(3000),
  estimatedCost: optMoney,
  actualCost: optMoney,
  resolution: longText(3000),
  providerId: optId,
  currency: currency.optional(),
});
export const issueUpdateSchema = issueCreateSchema.omit({ vehicleId: true }).partial();
export const convertIssueSchema = z.object({
  serviceDate: isoDate,
  odometerKm: optKm,
  title: optStr(160),
  laborCost: optMoney,
  partsCost: optMoney,
  tax: optMoney,
  discount: optMoney,
  providerId: optId,
  workPerformedBy: workByEnum.default("INDEPENDENT_MECHANIC"),
  mechanicName: optStr(120),
  resolution: longText(3000),
  notes: longText(3000),
  items: z.array(recordItemSchema).max(40).default([]),
  confirmOdometerCorrection: z.boolean().default(false),
});
export const dtcSchema = z.object({
  vehicleId: id.optional(),
  repairIssueId: optId,
  code: z.string().trim().min(2).max(12),
  description: optStr(300),
  detectedAt: isoDate,
  odometerKm: optKm,
  source: z.enum(["MANUAL", "OBD_ADAPTER", "PROVIDER"]).default("MANUAL"),
  component: optStr(80),
  severity: severityEnum.default("MODERATE"),
  status: z.enum(["ACTIVE", "CLEARED", "RESOLVED"]).default("ACTIVE"),
  symptoms: longText(1000),
  notes: longText(2000),
  resolution: longText(2000),
});

// ───────── parts
export const partSchema = z.object({
  vehicleId: id,
  name: reqStr(160),
  categoryId: optId,
  componentKey: optStr(60),
  manufacturer: optStr(120),
  origin: partOriginEnum.default("UNKNOWN"),
  partNumber: optStr(80),
  supplier: optStr(120),
  purchaseDate: optDate,
  purchasePrice: optMoney,
  currency: currency.optional(),
  warrantyStart: optDate,
  warrantyEnd: optDate,
  expectedLifeKm: optKm,
  expectedLifeMonths: optInt(1, 600),
  status: partStatusEnum.default("IN_STORAGE"),
  notes: longText(2000),
  installedAt: optDate,
  installedKm: optKm,
  installLaborCost: optMoney,
});
export const partUpdateSchema = partSchema.omit({ vehicleId: true }).partial();
export const replacePartSchema = z.object({
  vehicleId: id,
  componentKey: reqStr(60),
  installedAt: isoDate,
  installedKm: optKm,
  removalReason: optStr(300),
  installLaborCost: optMoney,
  maintenanceRecordId: optId,
  existingPartId: optId,
  part: partSchema.omit({ vehicleId: true, componentKey: true, status: true, installedAt: true, installedKm: true, installLaborCost: true }).optional(),
});
export const warrantySchema = z.object({
  vehicleId: id,
  partId: optId,
  type: z.enum(["MANUFACTURER", "POWERTRAIN", "EXTENDED", "PART", "OTHER"]).default("MANUFACTURER"),
  name: reqStr(120),
  provider: optStr(120),
  startDate: optDate,
  endDate: optDate,
  endKm: optKm,
  coverage: longText(1000),
  notes: longText(1000),
});
export const inspectionSchema = z.object({
  vehicleId: id,
  type: z.enum(["GENERAL", "PRE_PURCHASE", "SAFETY", "EMISSIONS", "SEASONAL", "OTHER"]).default("GENERAL"),
  date: isoDate,
  odometerKm: optKm,
  inspector: optStr(120),
  providerId: optId,
  items: z
    .array(z.object({ assignmentId: optId, componentKey: optStr(60), name: reqStr(120), condition: conditionEnum, notes: optStr(500) }))
    .max(80)
    .default([]),
  overallCondition: optStr(40),
  nextDueDate: optDate,
  notes: longText(3000),
  confirmOdometerCorrection: z.boolean().default(false),
});
export const providerSchema = z.object({
  householdId: id.optional(),
  name: reqStr(120),
  type: z.enum(["DEALERSHIP", "INDEPENDENT", "SPECIALIST", "TIRE_SHOP", "BODY_SHOP", "PARTS_SUPPLIER", "OTHER"]).default("INDEPENDENT"),
  phone: optStr(40),
  email: optStr(200),
  address: optStr(300),
  website: optStr(200),
  notes: longText(1000),
});

// ───────── expenses / fuel / budgets / reminders
export const expenseSchema = z.object({
  vehicleId: id,
  date: isoDate,
  amount: money,
  tax: optMoney,
  currency: currency.optional(),
  category: expenseCategoryEnum,
  vendor: optStr(120),
  providerId: optId,
  description: optStr(500),
  paymentMethod: z.preprocess((v) => (v === "" ? null : v), paymentEnum.nullable().optional()),
  notes: longText(2000),
  idempotencyKey: z.string().min(8).max(80).optional(),
});
export const expenseUpdateSchema = expenseSchema.omit({ vehicleId: true, idempotencyKey: true }).partial();
export const fuelSchema = z.object({
  vehicleId: id,
  date: isoDate,
  odometerKm: km,
  quantity: z.coerce.number().positive().max(2000),
  unit: volumeUnitEnum.default("L"),
  totalCost: money,
  pricePerUnit: optMoney,
  currency: currency.optional(),
  fuelType: fuelTypeEnum.default("PETROL"),
  station: optStr(120),
  fullTank: z.boolean().default(true),
  missedPrevious: z.boolean().default(false),
  notes: longText(1000),
  idempotencyKey: z.string().min(8).max(80).optional(),
  confirmOdometerCorrection: z.boolean().default(false),
});
export const fuelUpdateSchema = fuelSchema.omit({ vehicleId: true, idempotencyKey: true }).partial();
export const budgetSchema = z
  .object({
    vehicleId: optId,
    householdId: id.optional(),
    period: z.enum(["MONTHLY", "ANNUAL"]),
    year: z.coerce.number().int().min(2000).max(2100),
    month: optInt(1, 12),
    amount: money.positive(),
    currency: currency.optional(),
    categories: z.array(expenseCategoryEnum).default(["MAINTENANCE", "REPAIRS", "TIRES"]),
    alertAtPercent: z.array(z.coerce.number().int().min(1).max(200)).max(5).default([80, 100]),
  })
  .refine((b) => b.period === "ANNUAL" || (b.month ?? 0) >= 1, { message: "Month is required for monthly budgets", path: ["month"] });
export const reminderSchema = z
  .object({
    vehicleId: id,
    assignmentId: optId,
    type: z.enum(["CUSTOM", "REGISTRATION", "INSURANCE", "INSPECTION", "WARRANTY"]).default("CUSTOM"),
    title: reqStr(160),
    notes: longText(1000),
    dueDate: optDate,
    dueKm: optKm,
    leadDays: z.array(z.coerce.number().int().min(0).max(730)).max(6).default([7, 1]),
    leadKm: z.array(z.coerce.number().int().min(0).max(100000)).max(6).default([]),
  })
  .refine((r) => !!r.dueDate || r.dueKm != null, { message: "Set a due date or an odometer target", path: ["dueDate"] });
export const reminderUpdateSchema = z.object({ title: reqStr(160).optional(), notes: longText(1000), dueDate: optDate, dueKm: optKm, status: z.enum(["ACTIVE", "DONE", "DISMISSED"]).optional(), leadDays: z.array(z.coerce.number().int().min(0)).max(6).optional(), leadKm: z.array(z.coerce.number().int().min(0)).max(6).optional() });

// ───────── documents / misc
export const documentMetaSchema = z.object({
  vehicleId: id.optional().nullable(),
  title: optStr(200),
  category: docCategoryEnum.default("OTHER"),
  description: longText(1000),
  expiresOn: optDate,
  maintenanceRecordId: optId,
  repairIssueId: optId,
  expenseId: optId,
  partId: optId,
  inspectionId: optId,
  warrantyId: optId,
  runOcr: z.coerce.boolean().optional(),
});
export const documentUpdateSchema = documentMetaSchema.omit({ runOcr: true }).partial();
export const ocrConfirmSchema = z.object({
  vehicleId: id,
  vendor: optStr(120),
  date: isoDate,
  total: money,
  tax: optMoney,
  invoiceNumber: optStr(80),
  category: expenseCategoryEnum.default("MAINTENANCE"),
  description: optStr(500),
});
export const aiChatSchema = z.object({ message: reqStr(2000), conversationId: id.optional(), vehicleId: optId });
export const pushSubSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(100) }) });
export const dateRangeQuery = z.object({
  range: z.enum(["30d", "90d", "ytd", "12m", "all", "custom"]).default("12m"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  vehicleId: z.string().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type VehicleCreateInput = z.infer<typeof vehicleCreateSchema>;
export type RecordCreateInput = z.infer<typeof recordCreateSchema>;
