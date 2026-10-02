import { route } from "@/lib/http";
import { exportMyData } from "@/server/services/auth";

export const GET = route({ raw: true, rate: { limit: 5, windowSec: 600 } }, async ({ actor }) => {
  const data = await exportMyData(actor);
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="autovault-export-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } });
});
