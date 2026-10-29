import { isIP } from "node:net";

export function requestHost(request: Request): string {
  return request.headers.get("host") ?? new URL(request.url).host;
}

export function isLocalAppHost(authority: string): boolean {
  let url: URL;
  try {
    url = new URL(`http://${authority}`);
  } catch {
    return false;
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    return false;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const configured = (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (
    configured.some((origin) => {
      try {
        return new URL(origin).host === url.host;
      } catch {
        return false;
      }
    })
  )
    return true;
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".home.arpa")
  )
    return true;
  if (isIP(hostname) === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (isIP(hostname) === 6)
    return /^f[cd][\da-f]{2}:|^fe[89ab][\da-f]:/i.test(hostname);
  // Single-label names resolve on the local network (for example raspberrypi).
  return /^[a-z][a-z\d-]*$/i.test(hostname);
}
