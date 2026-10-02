/**
 * DEVELOPMENT ONLY demo data. Never run in production.
 *  - demo@autovault.local  (password: DemoPass123!)  — owner with a BMW X3 starter profile (NO history) and a clearly-labelled demo Civic with generated history
 *  - admin@autovault.local (password: DemoPass123!)  — platform administrator
 * Demo vehicles are flagged isDemo=true and their notes say so; the UI labels them "Demo".
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { actorFromUser } from "../src/server/context";
import { ensureReferenceData } from "../src/server/reference/seed-reference";
import { TEMPLATES } from "../src/server/reference/library";
import { createVehicle } from "../src/server/services/vehicles";
import { addReading } from "../src/server/services/odometer";
import { createRecord } from "../src/server/services/records";
import { evaluateVehicleSchedules, updateAssignment } from "../src/server/services/schedules";
import { createFuel } from "../src/server/services/fuel";
import { createExpense, createBudget } from "../src/server/services/expenses";
import { createIssue, createCode, convertIssueToRepair } from "../src/server/services/repairs";
import { createWarranty } from "../src/server/services/parts";
import { addDays, addMonths, todayInTz } from "../src/lib/dates";
import { db } from "../src/lib/db";

const prisma = new PrismaClient();
const PASSWORD = "DemoPass123!";

async function ensureUser(email: string, name: string, admin = false) {
  const existing = await prisma.user.findUnique({ where: { email }, include: { preference: true } });
  if (existing) return existing;
  const user = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), platformRole: admin ? "PLATFORM_ADMIN" : "USER" } });
  await prisma.userPreference.create({ data: { userId: user.id } });
  const hh = await prisma.household.create({ data: { name: `${name.split(" ")[0]}'s Household` } });
  await prisma.householdMember.create({ data: { householdId: hh.id, userId: user.id, role: "ADMIN" } });
  await prisma.subscription.create({ data: { householdId: hh.id, plan: "PREMIUM" } });
  return prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { preference: true } });
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  await ensureReferenceData(prisma);
  await ensureUser("admin@autovault.local", "Platform Admin", true);
  const user = await ensureUser("demo@autovault.local", "Dana Demo");
  const actor = actorFromUser(user);
  if ((await prisma.vehicle.count({ where: { household: { members: { some: { userId: user.id } } } } })) > 0) {
    console.log("Demo data already present — nothing to do.");
    return;
  }
  const today = todayInTz(actor.prefs.timezone);

  // 1) The BMW X3 starter profile — deliberately NO fabricated history and no odometer
  const t = TEMPLATES[0];
  await createVehicle(actor, { ...t.vehicle, nickname: "My BMW X3", templateKey: t.key, applySuggestedSchedules: true, ownershipStatus: "OWNED" } as any);

  // 2) A fully-populated DEMO vehicle (generated, clearly labelled)
  const { id: vid } = await createVehicle(actor, { nickname: "Demo Civic (sample data)", make: "Honda", model: "Civic", year: 2012, trim: "EX", fuelType: "PETROL", transmission: "AUTOMATIC", drivetrain: "FWD", ownershipStatus: "OWNED", purchaseDate: addMonths(today, -50), purchasePrice: 9800, purchaseOdometerKm: 98000, currency: "CAD", market: "Canada", colour: "Silver", notes: "DEMO DATA — generated sample history for development. Safe to delete.", applySuggestedSchedules: true, registrationExpiryDate: addDays(today, 24), insuranceRenewalDate: addDays(today, 70) } as any);
  await db.vehicle.update({ where: { id: vid }, data: { isDemo: true } });

  // odometer readings: ~1,250 km/month for 50 months (deterministic wobble)
  const start = addMonths(today, -50);
  let km = 98000;
  const rd: { date: string; km: number }[] = [];
  for (let m = 1; m <= 50; m++) {
    km += Math.round(1250 + Math.sin(m * 1.7) * 220);
    const date = addMonths(start, m);
    rd.push({ date, km });
    await addReading(actor, vid, { date, valueKm: km, source: "MANUAL", confirmCorrection: false });
  }
  // odometer on any date, interpolated between the recorded readings (keeps every derived entry monotonic)
  const kmOn = (date: string) => {
    const hi = rd.findIndex((r) => r.date >= date);
    if (hi <= 0) return rd[0].km;
    const a = rd[hi - 1];
    const b = rd[hi];
    const span = (Date.parse(b.date) - Date.parse(a.date)) / 86400000 || 1;
    return Math.round(a.km + ((b.km - a.km) * (Date.parse(date) - Date.parse(a.date))) / 86400000 / span);
  };
  const kmAt = (monthsAgo: number) => kmOn(addMonths(today, -monthsAgo));
  const sched = async () => (await evaluateVehicleSchedules(vid, actor.prefs, true)).items;
  const by = async (name: string) => (await sched()).find((s) => s.name === name)!;
  const rec = async (monthsAgo: number, title: string, items: { name: string; part?: string; partNo?: string; track?: boolean }[], labor: number, parts: number, provider = "Maple Auto Service") => {
    const as = await Promise.all(items.map((i) => by(i.name)));
    return createRecord(actor, { vehicleId: vid, title, serviceDate: addMonths(today, -monthsAgo), odometerKm: kmAt(monthsAgo), workPerformedBy: provider ? "INDEPENDENT_MECHANIC" : "OWNER_DIY", providerName: provider, laborCost: labor, partsCost: parts, tax: Math.round((labor + parts) * 5) / 100, discount: 0, status: "COMPLETED", kind: "MAINTENANCE", items: items.map((i, idx) => ({ assignmentId: as[idx]?.id ?? null, name: i.name, completed: true, quantity: 1, unitCost: 0, laborCost: 0, trackAsPart: !!i.track, partName: i.part, partNumber: i.partNo, categoryId: null })), allowDuplicate: false, confirmOdometerCorrection: false } as any);
  };
  for (const ago of [40, 32, 24, 16, 8]) await rec(ago, "Oil & filter change", [{ name: "Engine oil" }, { name: "Oil filter", part: "Oil filter", partNo: "15400-PLM-A02", track: true }], 35, 52);
  await rec(30, "Tire rotation", [{ name: "Tire rotation" }], 25, 0);
  await rec(14, "Tire rotation", [{ name: "Tire rotation" }], 25, 0);
  await rec(26, "Brake fluid flush", [{ name: "Brake fluid" }], 90, 18);
  await rec(20, "Front brake pads", [{ name: "Front brake pads", part: "Ceramic front pads", partNo: "BP-1204", track: true }], 140, 95);
  await rec(12, "Battery replacement", [{ name: "Battery", part: "Group 51R battery", partNo: "51R-AGM", track: true }], 0, 189, "");
  await rec(5, "Cabin air filter", [{ name: "Cabin air filter" }], 0, 24, "");

  // a resolved repair with a diagnostic code, and an open issue
  const issue = await createIssue(actor, { vehicleId: vid, title: "Coolant leak near water pump", description: "Sweet smell and small puddle after parking.", discoveredAt: addMonths(today, -9), odometerKm: kmAt(9), severity: "HIGH", status: "NEW", componentKey: "water_pump", estimatedCost: 650 } as any);
  await createCode(actor, { vehicleId: vid, repairIssueId: issue.id, code: "P0128", detectedAt: addMonths(today, -9), odometerKm: kmAt(9), severity: "MODERATE", source: "MANUAL", status: "ACTIVE", notes: "Read with a generic scanner" } as any);
  await convertIssueToRepair(actor, issue.id, { serviceDate: addMonths(today, -8), odometerKm: kmAt(8), laborCost: 320, partsCost: 245, tax: 28.25, workPerformedBy: "INDEPENDENT_MECHANIC", providerId: null, resolution: "Replaced water pump and thermostat; coolant refilled.", items: [{ name: "Water pump replacement", componentKey: "water_pump", completed: true, quantity: 1, unitCost: 245, laborCost: 320, trackAsPart: true, partName: "Water pump", partManufacturer: "Aisin" }], confirmOdometerCorrection: false } as any);
  await createIssue(actor, { vehicleId: vid, title: "Rattle from rear suspension over bumps", discoveredAt: addDays(today, -12), odometerKm: km, severity: "MODERATE", status: "INVESTIGATING", symptoms: "Noticeable on rough roads; quieter when loaded." } as any);

  // fuel: every ~16 days for ~12 months
  for (let i = 0; i < 24; i++) {
    const date = addDays(addMonths(today, -12), i * 15);
    await createFuel(actor, { vehicleId: vid, date, odometerKm: kmOn(date), quantity: Math.round((48 + (i % 4)) * 10) / 10, unit: "L", totalCost: Math.round((52 + (i % 5) * 3) * 100) / 100, fuelType: "PETROL", station: i % 2 ? "Petro-Canada" : "Shell", fullTank: i % 7 !== 3, missedPrevious: false, confirmOdometerCorrection: false } as any);
  }
  // other expenses
  for (const [ago, cat, amt, vendor] of [[11, "INSURANCE", 1180, "Prairie Insurance"], [0, "REGISTRATION", 128, "Alberta Registries"], [6, "CAR_WASH", 22, "Suds Car Wash"], [3, "PARKING", 36, "Impark"]] as const) await createExpense(actor, { vehicleId: vid, date: addMonths(today, -ago), amount: amt, category: cat, vendor, paymentMethod: "CREDIT" } as any);
  await createWarranty(actor, { vehicleId: vid, type: "EXTENDED", name: "Extended powertrain warranty", provider: "Demo Warranty Co.", startDate: addMonths(today, -34), endDate: addDays(today, 41), endKm: km + 8000, coverage: "Engine, transmission, drive axles (demo)" } as any);
  const year = Number(today.slice(0, 4));
  await createBudget(actor, { vehicleId: vid, period: "ANNUAL", year, amount: 1500, categories: ["MAINTENANCE", "REPAIRS", "TIRES"], alertAtPercent: [80, 100] } as any);
  // user-entered baseline for one schedule on the demo car (so inspections show "unknown history" elsewhere)
  const air = await by("Engine air filter");
  await updateAssignment(actor, air.id, { baselineDate: addMonths(today, -22), baselineKm: kmAt(22) } as any);
  console.log(`Seeded demo data. Sign in as demo@autovault.local / ${PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); await db.$disconnect(); });
