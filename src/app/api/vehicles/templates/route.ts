import { route } from "@/lib/http";
import { TEMPLATES } from "@/server/reference/library";

export const GET = route({}, async () => TEMPLATES.map((t) => ({ key: t.key, label: t.label, note: t.note, vehicle: t.vehicle, scheduleCount: t.scheduleKeys.length })));
