import { route } from "@/lib/http";
import { readDocumentFile } from "@/server/services/documents";

// Access-controlled download/preview. Only PDF/JPEG/PNG/WEBP can ever be stored, so serving inline is safe; nosniff + a locked CSP are added anyway.
export const GET = route({ raw: true, rate: { limit: 300, windowSec: 60 } }, async ({ req, actor, params }) => {
  const f = await readDocumentFile(actor, params.id);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const safeName = f.fileName.replace(/[^\w.\- ()]/g, "_");
  return new Response(new Uint8Array(f.data), {
    headers: {
      "content-type": f.mime,
      "content-length": String(f.data.length),
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": f.mime === "application/pdf" ? "default-src 'none'; style-src 'unsafe-inline'; object-src 'self'" : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=300",
      etag: `"${f.sha256}"`,
    },
  });
});
