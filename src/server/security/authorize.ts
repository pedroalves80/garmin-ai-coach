import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getGarminConfig } from "../config";
import { isLocalAppHost, requestHost } from "./local-host";

export function authorizeMutation(request: Request) {
  const host = requestHost(request);
  if (!isLocalAppHost(host))
    return NextResponse.json({ error: "Host rejected" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== new URL(`http://${host}`).host ||
        parsed.origin !== origin
      )
        return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
    }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none")
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );

  // Normal local UI requests need no password. The custom header prevents
  // cross-site forms; the origin and Fetch Metadata checks reject foreign pages.
  if (origin && request.headers.get("x-coach-request") === "local") return null;

  // Optional server-to-server automation retains its existing secret header.
  const expected = Buffer.from(getGarminConfig().SYNC_SECRET ?? "");
  const supplied = Buffer.from(request.headers.get("x-sync-secret") ?? "");
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
