import { route } from "@/lib/http";
import { z } from "zod";
import { lookupDtc } from "@/lib/dtc";

export const GET = route({ query: z.object({ code: z.string().min(2).max(12) }) }, async ({ query }) => lookupDtc(query.code));
