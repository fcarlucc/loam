import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost, isSameOrigin } from "@/lib/security";

// Guards every API route: only this machine may call it, and only the app's own page may change data.
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
