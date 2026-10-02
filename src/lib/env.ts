import { z } from "zod";

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  REQUIRE_EMAIL_VERIFICATION: bool(true),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: bool(false),
  EMAIL_FROM: z.string().default("AutoVault <no-reply@localhost>"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  CRON_SECRET: z.string().optional(),
  ENABLE_INPROCESS_JOBS: bool(false),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:admin@localhost"),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-sonnet-5-5"),
  VIN_DECODER: z.enum(["nhtsa", "none"]).default("nhtsa"),
  OCR_PROVIDER: z.enum(["none", "anthropic", "text"]).default("text"),
  BILLING_MODE: z.enum(["disabled", "enforced"]).default("disabled"),
  DEFAULT_PLAN: z.enum(["FREE", "PLUS", "PREMIUM"]).default("FREE"),
  LOG_LEVEL: z.string().default("info"),
  ERROR_MONITORING_DSN: z.string().optional(),
  RATE_LIMIT_STORE: z.enum(["memory", "postgres"]).default("memory"),
  BCRYPT_ROUNDS: z.coerce.number().min(4).max(15).optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  if (parsed.data.NODE_ENV === "production" && /change-me|dev-only/.test(parsed.data.AUTH_SECRET)) {
    throw new Error("AUTH_SECRET must be replaced with a unique random value in production");
  }
  cached = parsed.data;
  return cached;
}

export function __resetEnvCache() {
  cached = null;
}

export const isProd = () => process.env.NODE_ENV === "production";
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const smtpEnabled = () => !!process.env.SMTP_HOST;
export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

/** Comma-separated list of emails that receive the PLATFORM_ADMIN role when verified. */
export const adminEmails = (): string[] => (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
