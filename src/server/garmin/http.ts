export class GarminHttpError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? "Garmin credentials were rejected. Check the personal key and its expiration."
        : status === 403
          ? "Garmin denied access to this data."
          : `Garmin request failed (HTTP ${status}). Try syncing again later.`,
    );
  }
}

type Fetcher = typeof fetch;
type Sleep = (ms: number) => Promise<void>;
const wait: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestResponse(
  url: string,
  options: RequestInit,
  fetcher: Fetcher = fetch,
  sleep: Sleep = wait,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...options,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      if (attempt === 2)
        throw new Error(
          "Garmin could not be reached. Check the network and retry.",
        );
      await sleep(500 * 2 ** attempt);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const header = response.headers.get("retry-after");
      const retryAfter = header
        ? /^\d+$/.test(header)
          ? Number(header) * 1000
          : Date.parse(header) - Date.now()
        : 0;
      await response.body?.cancel();
      await sleep(
        Math.min(
          10_000,
          Math.max(
            500 * 2 ** attempt,
            Number.isFinite(retryAfter) ? retryAfter : 0,
          ),
        ),
      );
      continue;
    }
    if (!response.ok) throw new GarminHttpError(response.status);
    return response;
  }
  throw new Error("Garmin retry limit reached.");
}

export async function requestJson(
  url: string,
  options: RequestInit,
  fetcher: Fetcher = fetch,
  sleep: Sleep = wait,
): Promise<unknown> {
  const response = await requestResponse(url, options, fetcher, sleep);
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch {
    throw new Error("Garmin returned invalid JSON.");
  }
}

export async function requestText(
  url: string,
  options: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const response = await requestResponse(url, options, fetcher);
  try {
    return await response.text();
  } catch {
    throw new Error("Garmin response could not be read. Retry the sync.");
  }
}
