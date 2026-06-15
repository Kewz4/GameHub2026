import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import {
  probeExophaseAuth,
  type ExophaseAuthState,
} from "@main/services/achievements/exophase";

/**
 * Returns the cached Exophase auth state immediately (fast path for the UI). If
 * `revalidate` is true, it instead loads the account page to confirm the
 * session is still alive.
 */
const getExophaseAuthState = async (
  _event: Electron.IpcMainInvokeEvent,
  revalidate?: boolean
): Promise<ExophaseAuthState> => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  if (revalidate) {
    return probeExophaseAuth();
  }

  const username = prefs?.exophaseUserId ?? null;
  return { authenticated: Boolean(username), username };
};

registerEvent("getExophaseAuthState", getExophaseAuthState);
