import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

// Fresh database for every e2e run: drop/create, apply migrations, seed reference data.
export default async function globalSetup() {
  const admin = "postgresql://autovault:autovault@localhost:5432/postgres";
  const url = "postgresql://autovault:autovault@localhost:5432/autovault_e2e?schema=public";
  execSync(`psql "${admin}" -c "DROP DATABASE IF EXISTS autovault_e2e WITH (FORCE)" -c "CREATE DATABASE autovault_e2e"`, { stdio: "pipe" });
  const env = { ...process.env, DATABASE_URL: url };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
  rmSync("./storage-e2e", { recursive: true, force: true });
}
