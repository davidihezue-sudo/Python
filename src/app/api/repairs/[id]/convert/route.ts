import { route } from "@/lib/http";
import { convertIssueSchema } from "@/lib/validation";
import { convertIssueToRepair } from "@/server/services/repairs";

export const POST = route({ body: convertIssueSchema, status: 201 }, async ({ actor, params, body }) => convertIssueToRepair(actor, params.id, body));
