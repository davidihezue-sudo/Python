import { route } from "@/lib/http";
import { z } from "zod";
import { prefillFromAssignment } from "@/server/services/records";

export const GET = route({ query: z.object({ assignmentId: z.string().min(5) }) }, async ({ actor, query }) => prefillFromAssignment(actor, query.assignmentId));
