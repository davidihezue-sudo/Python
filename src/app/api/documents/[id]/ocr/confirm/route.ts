import { route } from "@/lib/http";
import { ocrConfirmSchema } from "@/lib/validation";
import { confirmOcr } from "@/server/services/documents";

export const POST = route({ body: ocrConfirmSchema, status: 201 }, async ({ actor, params, body }) => confirmOcr(actor, params.id, body));
