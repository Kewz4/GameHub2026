import { registerEvent } from "../register-event";
import { getPrefs } from "@main/services/achievements/exophase/exophase-cache";
import { parseExophaseUsername } from "@main/services/achievements/exophase/constants";
import { fetchExophaseAccountGames } from "@main/services/achievements/exophase/exophase-account";
import { ExophaseFetcher } from "@main/services/achievements/exophase/exophase-web";
import { collectExophaseProfiles } from "@main/services/achievements/exophase/exophase-importer";

export interface ValidateExophaseProfileResult {
  ok: boolean;
  username?: string;
  gameCount?: number;
  error?: string;
}

/**
 * Resolves a pasted Exophase profile URL/username to a username, then confirms
 * the profile is PUBLIC by enumerating its games (no login needed). Does not
 * persist anything — the renderer stores the username via updateUserPreferences
 * once this succeeds.
 */
const validateExophaseProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  input: string
): Promise<ValidateExophaseProfileResult> => {
  const username = parseExophaseUsername(input);
  if (!username) {
    return {
      ok: false,
      error: "Couldn't read a profile name from that link.",
    };
  }

  const prefs = await getPrefs();
  const existing = collectExophaseProfiles(prefs).map((p) => p.toLowerCase());
  if (existing.includes(username.toLowerCase())) {
    return { ok: false, error: `"${username}" is already added.` };
  }

  const fetcher = new ExophaseFetcher();
  try {
    const games = await fetchExophaseAccountGames(fetcher, username);
    if (games.length === 0) {
      return {
        ok: false,
        error:
          "No public games found. Make sure the profile URL is correct and the profile is set to public on Exophase.",
      };
    }
    return { ok: true, username, gameCount: games.length };
  } catch {
    return {
      ok: false,
      error:
        "Couldn't load that Exophase profile. Check the URL and try again.",
    };
  } finally {
    fetcher.close();
  }
};

registerEvent("validateExophaseProfile", validateExophaseProfile);
