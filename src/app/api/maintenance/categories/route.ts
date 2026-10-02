import { route } from "@/lib/http";
import { listCategories } from "@/server/services/schedules";

export const GET = route({}, async () => listCategories());
