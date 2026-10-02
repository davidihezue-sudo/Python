import { route } from "@/lib/http";
import { PROVIDERS } from "@/server/integrations/diagnostics";

export const GET = route({}, async () => PROVIDERS.map((p) => ({ id: p.id, label: p.label, kind: p.kind, ...p.status(), capabilities: p.capabilities })));
