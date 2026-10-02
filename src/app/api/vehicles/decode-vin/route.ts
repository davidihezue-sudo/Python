import { route } from "@/lib/http";
import { z } from "zod";
import { decodeVin } from "@/server/integrations/vin";

export const POST = route({ body: z.object({ vin: z.string().min(1).max(40) }), rate: { limit: 20, windowSec: 600 } }, async ({ body }) => decodeVin(body.vin));
