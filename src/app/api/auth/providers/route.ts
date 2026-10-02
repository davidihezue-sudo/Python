import { route } from "@/lib/http";
import { googleEnabled } from "@/lib/env";

export const GET = route({ auth: false }, async () => ({ google: googleEnabled(), password: true }));
