export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_INPROCESS_JOBS === "true") {
    const { startScheduler } = await import("@/server/jobs/jobs");
    startScheduler();
  }
}
