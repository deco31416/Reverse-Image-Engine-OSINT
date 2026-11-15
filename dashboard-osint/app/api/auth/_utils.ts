import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "osint_deco_session";

export function apiBase() {
  return (process.env.OSINT_API_BASE || "http://localhost:7105/api/v1").replace(/\/$/, "");
}

export function authTimeoutMs() {
  return Number(process.env.OSINT_AUTH_PROXY_TIMEOUT_MS || 5000);
}

export function authUnavailableResponse() {
  return NextResponse.json(
    {
      authenticated: false,
      success: false,
      message: "Micro OSINT no disponible todavía. Espera el arranque completo del puerto 7105 y pulsa Actualizar.",
    },
    { status: 503 },
  );
}

export async function authFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(authTimeoutMs()),
  }).catch(() => null);
  if (!response) return authUnavailableResponse();

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return NextResponse.json(
      { success: false, message: data?.message || data?.error || `Auth failed with ${response.status}` },
      { status: response.status },
    );
  }

  return NextResponse.json(data);
}

export function setSessionCookie(response: NextResponse, token: string, expiresIn = 86400) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: expiresIn,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export function bearerFromCookie(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? `Bearer ${token}` : "";
}
