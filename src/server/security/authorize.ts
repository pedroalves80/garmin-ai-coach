import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getGarminConfig } from "../config";

export function authorizeMutation(request: Request) {
  const expected = Buffer.from(getGarminConfig().SYNC_SECRET ?? "");
  const supplied = Buffer.from(request.headers.get("x-sync-secret") ?? "");
  if (
    !expected.length ||
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  return null;
}
