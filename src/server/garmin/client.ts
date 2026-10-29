import { getGarminConfig } from "@/server/config";
import { getGarminAccessToken } from "@/server/garmin/auth";

export async function getGarminJson<T>(endpoint: string, accessToken: string): Promise<T> {
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Garmin request failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchConfiguredGarminData() {
  const config = getGarminConfig();
  const token = await getGarminAccessToken();
  const result: { activities?: unknown; health?: unknown; warnings: string[] } = { warnings: [] };

  if (config.GARMIN_ACTIVITY_ENDPOINT) result.activities = await getGarminJson(config.GARMIN_ACTIVITY_ENDPOINT, token.access_token);
  else result.warnings.push("GARMIN_ACTIVITY_ENDPOINT is not configured");
  if (config.GARMIN_HEALTH_ENDPOINT) result.health = await getGarminJson(config.GARMIN_HEALTH_ENDPOINT, token.access_token);
  else result.warnings.push("GARMIN_HEALTH_ENDPOINT is not configured");
  return result;
}
