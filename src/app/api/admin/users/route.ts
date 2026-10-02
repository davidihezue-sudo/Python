import { route } from "@/lib/http";
import { z } from "zod";
import { listUsers } from "@/server/services/admin";

export const GET = route({ query: z.object({ search: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1) }) }, async ({ actor, query }) => listUsers(actor, query));
