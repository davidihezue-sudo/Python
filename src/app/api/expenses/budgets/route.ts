import { route } from "@/lib/http";
import { z } from "zod";
import { budgetSchema } from "@/lib/validation";
import { createBudget, listBudgets } from "@/server/services/expenses";

export const GET = route({ query: z.object({ year: z.coerce.number().int().optional() }) }, async ({ actor, query }) => listBudgets(actor, query));
export const POST = route({ body: budgetSchema, status: 201 }, async ({ actor, body }) => createBudget(actor, body));
