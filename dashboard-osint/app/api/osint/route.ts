import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "osint_deco_session";

function apiBase() {
  return (process.env.OSINT_API_BASE || "http://localhost:7105/api/v1").replace(/\/$/, "");
}

function normalizePath(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path") || "";
  if (!path.startsWith("/")) {
    throw new Error("Proxy path must start with /");
  }
  if (path.includes("://")) {
    throw new Error("Absolute proxy URLs are not allowed");
  }
  return path;
}

function proxyTimeoutMs(path?: string) {
  if (path && (path === "/osint/health" || path.startsWith("/osint/health?"))) return 2500;
  if (path && (
    path === "/osint/visual/detect-faces" ||
    path.startsWith("/osint/visual/detect-faces?") ||
    path === "/osint/face-jobs" ||
    path.startsWith("/osint/face-jobs?")
  )) return Number(process.env.OSINT_FACE_PROXY_TIMEOUT_MS || 60000);
  return Number(process.env.OSINT_PROXY_TIMEOUT_MS || 8000);
}

async function proxy(request: NextRequest) {
  const sessionToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionToken) return NextResponse.json({ success: false, message: 'Sesión requerida' }, { status: 401 });
  const path = normalizePath(request);
  if (!path.startsWith('/osint/')) throw new Error('Unsupported proxy endpoint');
  const target = `${apiBase()}${path}`;
  if (!new URL(target).pathname.startsWith(`${new URL(apiBase()).pathname}/osint/`)) throw new Error('Invalid proxy path');
  const headers = new Headers();

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Accept", request.headers.get("accept") || "application/json");

  headers.set('Authorization', `Bearer ${sessionToken}`);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(proxyTimeoutMs(path)),
  });

  const responseHeaders = new Headers();
  const responseContentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition");

  if (responseContentType) responseHeaders.set("Content-Type", responseContentType);
  if (disposition) responseHeaders.set("Content-Disposition", disposition);

  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

function handleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const unavailable =
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("aborted") ||
    message.includes("timed out") ||
    error instanceof DOMException;
  return NextResponse.json(
    {
      success: false,
      message: unavailable
        ? "Micro OSINT no disponible todavía. Espera el arranque completo del puerto 7105 y pulsa Actualizar."
        : message,
    },
    { status: unavailable ? 503 : 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    return await proxy(request);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    return await proxy(request);
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    return await proxy(request);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await proxy(request);
  } catch (error) {
    return handleError(error);
  }
}
