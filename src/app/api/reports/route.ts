import { route } from "@/lib/http";
import { REPORT_CATALOG } from "@/server/services/reports";

export const GET = route({}, async () => ({ reports: REPORT_CATALOG, formats: ["pdf", "csv", "xlsx", "json"] }));
