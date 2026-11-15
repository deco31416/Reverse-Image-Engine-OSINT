import { NextRequest } from "next/server";
import { authFetch } from "../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return authFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(body || {}),
  });
}
