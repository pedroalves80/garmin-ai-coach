import { getConfig } from "../config";
import { getDatabase } from "../db/client";
import { openAIAdapter } from "./openai";
import { CoachService, CoachError } from "./service";

export function coachService() {
  const config = getConfig();
  return new CoachService(
    getDatabase(),
    async (input) => {
      if (!config.OPENAI_API_KEY)
        throw new CoachError(
          "Set OPENAI_API_KEY in the server's .env and restart to enable coaching.",
          503,
        );
      return openAIAdapter(config.OPENAI_API_KEY, config.OPENAI_MODEL)(input);
    },
    config.OPENAI_MODEL,
  );
}
