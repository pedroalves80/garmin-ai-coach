import { NextResponse, type NextRequest } from "next/server";
import { isLocalAppHost, requestHost } from "./server/security/local-host";

export function proxy(request: NextRequest) {
  if (!isLocalAppHost(requestHost(request))) {
    return NextResponse.json(
      {
        error:
          "This app accepts local-network hostnames. Configure APP_ALLOWED_ORIGINS for a custom private hostname.",
      },
      { status: 403 },
    );
  }
  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export const config = { matcher: ["/:path*"] };
