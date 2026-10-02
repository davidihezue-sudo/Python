import pino from "pino";

// Structured JSON logs. Secrets are redacted; never log request bodies, documents, or tokens.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "autovault" },
  redact: {
    paths: ["password", "*.password", "passwordHash", "*.passwordHash", "token", "*.token", "authorization", "headers.authorization", "headers.cookie", "cookie", "*.secret", "apiKey", "*.apiKey"],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

type Reporter = (err: unknown, context?: Record<string, unknown>) => void;
const reporters: Reporter[] = [];
/** Hook for error-monitoring integrations (Sentry etc.). */
export function registerErrorReporter(fn: Reporter) {
  reporters.push(fn);
}
export function captureError(err: unknown, context: Record<string, unknown> = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.error({ err: { message: e.message, stack: e.stack, name: e.name }, ...context }, "unhandled error");
  for (const r of reporters) {
    try {
      r(err, context);
    } catch {
      /* never let a reporter break the request */
    }
  }
}
