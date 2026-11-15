import { NextRequest, NextResponse } from "next/server";
import { apiBase, authTimeoutMs, authUnavailableResponse, bearerFromCookie } from "../_utils";

export const dynamic = "force-dynamic";

async function forwardUsers(request: NextRequest, method: "GET" | "POST") {
  const authorization = bearerFromCookie(request);
  if (!authorization) {
    return NextResponse.json({ success: false, message: "Sesión requerida" }, { status: 401 });
  }

  const response = await fetch(`${apiBase()}/auth/users`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    body: method === "POST" ? await request.text() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(authTimeoutMs()),
  }).catch(() => null);

  if (!response) return authUnavailableResponse();

  const data = await response.json().catch(() => null);

  return NextResponse.json(data || {}, { status: response.status });
}

export async function GET(request: NextRequest) {
  return forwardUsers(request, "GET");
}

export async function POST(request: NextRequest) {
  return forwardUsers(request, "POST");
}
