import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Liveness/readiness probe for load balancers. `?deep=1` also verifies the database.
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  if (!deep) return NextResponse.json({ status: "ok", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", time: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
