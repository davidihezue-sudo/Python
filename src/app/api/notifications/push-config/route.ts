import { route } from "@/lib/http";
import { pushEnabled } from "@/lib/env";

// Capability report for the client; the browser still needs its own feature detection (PushManager, Notification).
export const GET = route({}, async () => ({ serverSupport: pushEnabled(), vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null }));
