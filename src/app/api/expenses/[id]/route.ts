import { route } from "@/lib/http";
import { expenseUpdateSchema } from "@/lib/validation";
import { deleteExpense, getExpense, updateExpense } from "@/server/services/expenses";

export const GET = route({}, async ({ actor, params }) => getExpense(actor, params.id));
export const PATCH = route({ body: expenseUpdateSchema }, async ({ actor, params, body }) => updateExpense(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteExpense(actor, params.id));
