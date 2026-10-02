import { route } from "@/lib/http";
import { z } from "zod";
import { globalSearch } from "@/server/services/search";

export const GET = route({ query: z.object({ q: z.string().max(100).default("") }), rate: { limit: 120, windowSec: 60 } }, async ({ actor, query }) => globalSearch(actor, query.q));
