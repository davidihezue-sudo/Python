import { route } from "@/lib/http";
import { env, googleEnabled, pushEnabled, smtpEnabled, aiEnabled } from "@/lib/env";
import { getOcrProvider } from "@/server/integrations/ocr";
import { PROVIDERS } from "@/server/integrations/diagnostics";

// Capability report for the Settings → Integrations page. Never returns secret values.
export const GET = route({}, async () => {
  const e = env();
  const ocr = getOcrProvider();
  return {
    capabilities: [
      { id: "vin", label: "VIN decoding (NHTSA vPIC)", enabled: e.VIN_DECODER === "nhtsa", detail: e.VIN_DECODER === "nhtsa" ? "Public NHTSA decoder; best for North American vehicles. Results are suggestions only." : "Disabled (VIN_DECODER=none). Enter specifications manually.", credentials: "none required" },
      { id: "email", label: "Email delivery (SMTP)", enabled: smtpEnabled(), detail: smtpEnabled() ? "Emails are sent via your SMTP server." : "Not configured - emails are written to the outbox/server log only.", credentials: "SMTP_HOST, SMTP_USER, SMTP_PASSWORD" },
      { id: "google", label: "Sign in with Google", enabled: googleEnabled(), detail: googleEnabled() ? "Enabled." : "Not configured.", credentials: "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET" },
      { id: "push", label: "Web push notifications", enabled: pushEnabled(), detail: pushEnabled() ? "VAPID keys configured. Support depends on the browser/device (iOS requires the installed PWA, iOS 16.4+)." : "Not configured.", credentials: "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY" },
      { id: "ai", label: "AI assistant provider", enabled: aiEnabled(), detail: aiEnabled() ? `Using ${e.AI_MODEL}. Tools are read-only and permission-checked.` : "No provider configured - the built-in rule-based assistant is used (it answers only from your records).", credentials: "ANTHROPIC_API_KEY" },
      { id: "ocr", label: "Receipt OCR", enabled: !!ocr && ocr.available().ok, detail: ocr ? `${ocr.name} provider. ${ocr.name === "text" ? "Reads PDFs with a text layer only." : ocr.available().ok ? "Vision extraction." : ocr.available().reason}` : "Disabled (OCR_PROVIDER=none).", credentials: ocr?.name === "anthropic" ? "ANTHROPIC_API_KEY" : "none required" },
      { id: "storage", label: "File storage", enabled: true, detail: e.STORAGE_DRIVER === "s3" ? `S3-compatible bucket ${e.S3_BUCKET ?? "(unset)"}` : "Local disk storage (development / single-server).", credentials: e.STORAGE_DRIVER === "s3" ? "S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY" : "none" },
    ],
    diagnostics: PROVIDERS.map((p) => ({ id: p.id, label: p.label, kind: p.kind, ...p.status(), capabilities: p.capabilities })),
  };
});
