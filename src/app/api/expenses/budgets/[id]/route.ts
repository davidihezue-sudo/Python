import { route } from "@/lib/http";
import { z } from "zod";
import { deleteBudget, updateBudget } from "@/server/services/expenses";

export const PATCH = route({ body: z.object({ amount: z.coerce.number().positive().optional(), categories: z.array(z.string()).optional(), alertAtPercent: z.array(z.coerce.number().int().min(1).max(200)).max(5).optional() }) }, async ({ actor, params, body }) => updateBudget(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteBudget(actor, params.id));
