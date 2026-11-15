import { NextRequest, NextResponse } from "next/server";
import { apiBase, authTimeoutMs, authUnavailableResponse, setSessionCookie } from "../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const response = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
    signal: AbortSignal.timeout(authTimeoutMs()),
  }).catch(() => null);
  if (!response) return authUnavailableResponse();

  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.accessToken) {
    return NextResponse.json(
      { success: false, message: data?.message || data?.error || `Login failed with ${response.status}` },
      { status: response.status },
    );
  }

  const next = NextResponse.json({ success: true, user: data.user, expiresIn: data.expiresIn });
  setSessionCookie(next, data.accessToken, Number(data.expiresIn || 86400));
  return next;
}
