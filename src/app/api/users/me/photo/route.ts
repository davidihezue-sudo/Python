import { route } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { setProfilePhoto } from "@/server/services/users";

export const POST = route({ rate: { limit: 10, windowSec: 600 } }, async ({ req, actor }) => {
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new AppError("VALIDATION_ERROR", "Choose an image to upload");
  return setProfilePhoto(actor, { name: f.name, size: f.size, data: Buffer.from(await f.arrayBuffer()) });
});
