import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../env";

const COMMON = new Set(["password", "password1", "password123", "123456789", "1234567890", "qwertyuiop", "letmein123", "iloveyou12", "admin12345", "welcome123", "autovault1", "changeme123"]);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long")
  .refine((p) => !COMMON.has(p.toLowerCase()), "That password is too common")
  .refine((p) => /[a-z]/i.test(p) && /[0-9\W_]/.test(p), "Include letters and at least one number or symbol");

const rounds = () => env().BCRYPT_ROUNDS ?? (process.env.NODE_ENV === "test" ? 4 : 12);

export const hashPassword = (pw: string) => bcrypt.hash(pw, rounds());
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
// Used to equalise timing when the account does not exist (prevents user enumeration by timing).
let dummy: string | null = null;
export async function dummyVerify(pw: string) {
  dummy ??= await bcrypt.hash("not-a-real-password", rounds());
  await bcrypt.compare(pw, dummy);
}
