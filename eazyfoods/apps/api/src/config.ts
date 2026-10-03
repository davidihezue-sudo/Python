// Central environment configuration. Every integration is optional in development.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotenv() {
  for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadDotenv();

const env = process.env;
export const config = {
  nodeEnv: env.NODE_ENV ?? 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test' || !!env.VITEST,
  port: Number(env.API_PORT ?? 4000),
  host: env.API_HOST ?? '0.0.0.0',
  databaseUrl:
    (env.NODE_ENV === 'test' || env.VITEST) && env.TEST_DATABASE_URL
      ? env.TEST_DATABASE_URL
      : env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5544/eazyfoods',
  appUrl: env.APP_URL ?? 'http://localhost:3000',
  corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  cookieDomain: env.COOKIE_DOMAIN || undefined,
  sessionTtlDays: Number(env.SESSION_TTL_DAYS ?? 30),
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : env.NODE_ENV === 'production',
  // Integrations (all optional)
  payments: {
    provider: (env.PAYMENT_PROVIDER ?? (env.STRIPE_SECRET_KEY ? 'stripe' : 'sandbox')) as 'sandbox' | 'stripe',
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET,
  },
  email: { provider: env.EMAIL_PROVIDER ?? 'dev', from: env.EMAIL_FROM ?? 'EAZyfoods <no-reply@eazyfoods.ca>', sendgridKey: env.SENDGRID_API_KEY },
  sms: { provider: env.SMS_PROVIDER ?? 'dev', twilioSid: env.TWILIO_ACCOUNT_SID, twilioToken: env.TWILIO_AUTH_TOKEN, twilioFrom: env.TWILIO_FROM },
  push: { provider: env.PUSH_PROVIDER ?? 'dev', firebaseKey: env.FIREBASE_SERVER_KEY },
  maps: { provider: env.MAPS_PROVIDER ?? 'local', googleKey: env.GOOGLE_MAPS_API_KEY, mapboxToken: env.MAPBOX_TOKEN },
  storage: {
    provider: env.STORAGE_PROVIDER ?? 'local',
    localDir: env.STORAGE_LOCAL_DIR ?? resolve(process.cwd(), env.NODE_ENV === 'test' ? '.storage-test' : '.storage'),
    publicBase: env.STORAGE_PUBLIC_BASE ?? '/api/files',
    maxBytes: Number(env.UPLOAD_MAX_BYTES ?? 8 * 1024 * 1024),
  },
  ai: { provider: env.AI_PROVIDER ?? 'none', anthropicKey: env.ANTHROPIC_API_KEY },
  analytics: { provider: env.ANALYTICS_PROVIDER ?? 'internal' },
  logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
  demoPassword: env.DEMO_PASSWORD ?? 'EazyDemo!2026',
} as const;
