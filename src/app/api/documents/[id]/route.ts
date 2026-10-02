import { route } from "@/lib/http";
import { documentUpdateSchema } from "@/lib/validation";
import { deleteDocument, documentView, getDocumentForActor, updateDocument } from "@/server/services/documents";

export const GET = route({}, async ({ actor, params }) => documentView(await getDocumentForActor(actor, params.id)));
export const PATCH = route({ body: documentUpdateSchema }, async ({ actor, params, body }) => updateDocument(actor, params.id, body));
export const DELETE = route({}, async ({ actor, params }) => deleteDocument(actor, params.id));
