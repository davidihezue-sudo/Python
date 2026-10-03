import { route } from "@/lib/http";
import { sendTestPush } from "@/server/services/notifications";

export const POST = route({ rate: { limit: 6, windowSec: 600 } }, async ({ actor }) => sendTestPush(actor));
