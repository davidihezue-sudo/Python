import { PrismaClient } from "@prisma/client";
import { ensureReferenceData } from "../src/server/reference/seed-reference";

const prisma = new PrismaClient();
ensureReferenceData(prisma)
  .then((r) => console.log(`Reference data ready: ${r.categories} categories, ${r.schedules} library schedules`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
