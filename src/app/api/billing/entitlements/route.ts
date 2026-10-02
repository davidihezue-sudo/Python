import { route } from "@/lib/http";
import { z } from "zod";
import { describeEntitlements } from "@/server/services/entitlements";
import { requireHouseholdMember } from "@/server/services/access";

export const GET = route({ query: z.object({ householdId: z.string().min(5) }) }, async ({ actor, query }) => {
  await requireHouseholdMember(actor, query.householdId);
  const e = await describeEntitlements(query.householdId);
  return { ...e, paymentProcessing: "not-configured" };
});
