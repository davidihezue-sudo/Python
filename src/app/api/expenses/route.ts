import { route, pageQuery, optNum, optDateQ } from "@/lib/http";
import { z } from "zod";
import { expenseSchema } from "@/lib/validation";
import { createExpense, listExpenses } from "@/server/services/expenses";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), category: z.string().optional(), from: optDateQ, to: optDateQ, q: z.string().max(100).optional(), minAmount: optNum, maxAmount: optNum, sort: z.enum(["date_desc", "date_asc", "amount_desc", "amount_asc"]).optional(), ...pageQuery }) }, async ({ actor, query }) => listExpenses(actor, query));
export const POST = route({ body: expenseSchema, status: 201 }, async ({ actor, body }) => createExpense(actor, body));
