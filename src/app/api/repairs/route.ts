import { route, pageQuery, boolish } from "@/lib/http";
import { z } from "zod";
import { issueCreateSchema } from "@/lib/validation";
import { createIssue, listIssues } from "@/server/services/repairs";

export const GET = route({ query: z.object({ vehicleId: z.string().optional(), status: z.string().optional(), open: boolish.optional(), severity: z.string().optional(), q: z.string().max(100).optional(), component: z.string().max(60).optional(), ...pageQuery }) }, async ({ actor, query }) => listIssues(actor, query));
export const POST = route({ body: issueCreateSchema, status: 201 }, async ({ actor, body }) => createIssue(actor, body));
