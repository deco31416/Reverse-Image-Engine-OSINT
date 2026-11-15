import { NextRequest, NextResponse } from "next/server";
import { apiBase, authTimeoutMs, authUnavailableResponse, bearerFromCookie, clearSessionCookie } from "../_utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = bearerFromCookie(request);
  if (!authorization) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const response = await fetch(`${apiBase()}/auth/me`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(authTimeoutMs()),
  }).catch(() => null);

  if (!response) return authUnavailableResponse();

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const next = NextResponse.json({ authenticated: false, message: data?.message || "Session expired" }, { status: 401 });
    clearSessionCookie(next);
    return next;
  }

  return NextResponse.json({ authenticated: true, user: data });
}
