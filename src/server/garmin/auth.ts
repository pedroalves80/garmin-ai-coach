import { z } from "zod";
import { parsePayload } from "./schemas";
import { requestJson } from "./http";

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});
const tokenUrl =
  "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token";

// In-memory only: neither tokens nor the key enter SQLite or the browser bundle.
export class GarminTokenProvider {
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  invalidate() {
    this.cached = undefined;
  }

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now())
      return this.cached.token;
    if (this.pending) return this.pending;
    this.pending = this.obtain();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async obtain() {
    const data = parsePayload(
      tokenSchema,
      await requestJson(
        tokenUrl,
        {
          method: "POST",
          headers: { Authorization: `ApiKey ${this.key}` },
        },
        this.fetcher,
      ),
    );
    const lifetime = Math.min(data.expires_in ?? 86400, 86400);
    this.cached = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(0, lifetime - 60) * 1000,
    };
    return data.access_token;
  }
}
