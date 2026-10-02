import { route } from "@/lib/http";
import { issueUpdateSchema } from "@/lib/validation";
import { deleteIssue, getIssue, updateIssue } from "@/server/services/repairs";

export const GET = route({}, async ({ actor, params }) => getIssue(actor, params.id));
export const PATCH = route({ body: issueUpdateSchema }, async ({ actor, params, body }) => updateIssue(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteIssue(actor, params.id));
