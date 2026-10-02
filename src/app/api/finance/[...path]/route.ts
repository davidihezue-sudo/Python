import type { NextRequest } from "next/server";
import { dispatch } from "@/server/finance/router";

// One catch-all route dispatches the finance API through the shared route() wrapper (same-origin check, rate limit, validation, auth).
type Ctx = { params: Promise<{ path: string[] }> };
const handle = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE") => async (req: NextRequest, c: Ctx) => dispatch(req, (await c.params).path, method);
export const GET = handle("GET");
export const POST = handle("POST");
export const PATCH = handle("PATCH");
export const PUT = handle("PUT");
export const DELETE = handle("DELETE");
