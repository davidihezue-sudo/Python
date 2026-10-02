// Standalone worker: `npm run worker`. Reminders are generated even when nobody opens the app.
import "dotenv/config";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { startScheduler } from "./jobs";

const stop = startScheduler();
const shutdown = async () => {
  logger.info("worker shutting down");
  stop();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
