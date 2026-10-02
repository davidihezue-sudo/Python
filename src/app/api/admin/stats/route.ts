import { route } from "@/lib/http";
import { platformStats } from "@/server/services/admin";

export const GET = route({}, async ({ actor }) => platformStats(actor));
