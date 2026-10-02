/**
 * DEVELOPMENT ONLY demo data. Never run in production.
 *  - david@familyfinance.local  (password: DemoPass123!)  administrator of the demo household
 *  - sharon@familyfinance.local (password: DemoPass123!)  member of the demo household, own login and private records
 *  - admin@familyfinance.local  (password: DemoPass123!)  platform administrator
 * The household is flagged isDemo=true and named "Demo household", so it is labelled in the UI and can be removed from Household > Data.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { actorFromUser } from "../src/server/context";
import { ensureReferenceData } from "../src/server/reference/seed-reference";
import { createFinanceHousehold } from "../src/server/finance/household";
import { finCtx } from "../src/server/finance/access";
import { populateDemoData } from "../src/server/finance/demo";
import { AVATAR_COLORS } from "../src/server/finance/defaults";
import { ensureMemberDefaults } from "../src/server/finance/household";


const prisma = new PrismaClient();
const PASSWORD = "DemoPass123!";

async function ensureUser(email: string, name: string, admin = false) {
  const existing = await prisma.user.findUnique({ where: { email }, include: { preference: true } });
  if (existing) return existing;
  const user = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), platformRole: admin ? "PLATFORM_ADMIN" : "USER" } });
  await prisma.userPreference.create({ data: { userId: user.id } });
  return prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { preference: true } });
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");
  await ensureReferenceData(prisma);
  await ensureUser("admin@familyfinance.local", "Platform Admin", true);
  const david = await ensureUser("david@familyfinance.local", "David Demo");
  const sharon = await ensureUser("sharon@familyfinance.local", "Sharon Demo");
  const already = await prisma.householdMember.findFirst({ where: { userId: david.id, household: { isDemo: true, deletedAt: null } } });
  if (already) { console.log("Demo household already exists. Run Household > Data > Remove demo data to reset."); return; }
  const actor = actorFromUser(david as never);
  const { id } = await createFinanceHousehold(actor, { name: "Demo household", countryCode: "CA", region: "AB", city: "Calgary", currency: "CAD", fiscalYearStartMonth: 1, dateFormat: "YYYY-MM-DD", numberLocale: "en-CA", structure: "Two earners", goalsPreference: ["Emergency fund", "Buy a home"], budgetPeriod: "MONTHLY", completeOnboarding: true } as never, { demo: true });
  const m = await prisma.householdMember.create({ data: { householdId: id, userId: sharon.id, role: "MEMBER", avatarColor: AVATAR_COLORS[1] } });
  await ensureMemberDefaults(id, sharon.id);
  const ctx = await finCtx(actor, id, "write");
  const r = await populateDemoData(ctx, m.id);
  console.log(`Seeded demo household with ${r.transactions} transactions.`);
  console.log(`Sign in as david@familyfinance.local or sharon@familyfinance.local with password ${PASSWORD}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
