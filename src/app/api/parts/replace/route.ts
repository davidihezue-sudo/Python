import { route } from "@/lib/http";
import { replacePartSchema } from "@/lib/validation";
import { replaceComponent } from "@/server/services/parts";

export const POST = route({ body: replacePartSchema, status: 201 }, async ({ actor, body }) => replaceComponent(actor, body));
