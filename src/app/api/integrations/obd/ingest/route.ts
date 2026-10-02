import { route } from "@/lib/http";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { ingestObd } from "@/server/integrations/diagnostics";

// Machine endpoint authenticated by an integration bearer token (no cookies, so no CSRF surface).
export const POST = route({ auth: false, machine: true, body: z.any(), rate: { limit: 60, windowSec: 60, key: ({ ip }) => `ip:${ip}` } }, async ({ req, body }) => {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Missing bearer token");
  return ingestObd(h.slice(7).trim(), body);
});
