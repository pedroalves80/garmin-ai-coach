import { getGarminConfig } from "@/server/config";

type GarminTokenResponse = { access_token: string; token_type?: string; expires_in?: number };

export async function getGarminAccessToken(): Promise<GarminTokenResponse> {
  const { GARMIN_PERSONAL_API_KEY, GARMIN_TOKEN_URL } = getGarminConfig();
  if (!GARMIN_PERSONAL_API_KEY) throw new Error("GARMIN_PERSONAL_API_KEY is not configured");

  const response = await fetch(GARMIN_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `ApiKey ${GARMIN_PERSONAL_API_KEY}` },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Garmin token request failed with HTTP ${response.status}`);
  return (await response.json()) as GarminTokenResponse;
}
