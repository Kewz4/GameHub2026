import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type {
  Game,
  SteamAchievement,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import {
  refreshGogToken,
  getGogUserInfo,
  getGogGameCredentials,
  getGogGameToken,
  getGogRemoteAchievements,
} from "@main/services/gog-account";
import { getLegendaryConfigPath } from "@main/services/legendary";
import { syncXboxGameAchievements } from "./get-xbox-achievements";
import { achievementsLogger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";

export interface AchievementImportResult {
  gamesProcessed: number;
  gamesWithAchievements: number;
  totalUnlocked: number;
}

const getPrefs = (): Promise<UserPreferences | null> =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

const getLibraryGamesByShop = async (
  shop: string
): Promise<[string, Game][]> => {
  const result: [string, Game][] = [];
  for await (const [key, game] of gamesSublevel.iterator()) {
    if (game.shop === shop && !game.isDeleted) result.push([key, game]);
  }
  return result;
};

/** Persists imported achievements for a game, preserving any locally known
 * definitions when the platform didn't return them. */
const storeAchievements = async (
  gameKey: string,
  game: Game,
  achievements: SteamAchievement[] | null,
  unlocked: UnlockedAchievement[]
): Promise<void> => {
  const existing = await gameAchievementsSublevel
    .get(gameKey)
    .catch(() => null);

  const definitions =
    achievements && achievements.length > 0
      ? achievements
      : (existing?.achievements ?? []);

  // Merge with already unlocked achievements rather than dropping them
  const known = new Set(
    (existing?.unlockedAchievements ?? []).map((a) => a.name.toUpperCase())
  );
  const mergedUnlocked = [
    ...(existing?.unlockedAchievements ?? []),
    ...unlocked.filter((a) => !known.has(a.name.toUpperCase())),
  ];

  await gameAchievementsSublevel.put(gameKey, {
    achievements: definitions,
    unlockedAchievements: mergedUnlocked,
    updatedAt: Date.now(),
    language: existing?.language ?? "en",
  });

  await gamesSublevel.put(gameKey, {
    ...game,
    achievementCount: definitions.length || game.achievementCount,
    unlockedAchievementCount: mergedUnlocked.length,
  });

  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectId}-${game.shop}`,
    mergedUnlocked
  );
};

/* ───────────────────────── Steam ───────────────────────── */

export const importSteamAchievements =
  async (): Promise<AchievementImportResult> => {
    const prefs = await getPrefs();
    if (!prefs?.steamId) {
      throw new Error("Steam account not connected");
    }
    if (!prefs.steamApiKey) {
      throw new Error(
        "Steam API key required for achievement import. Add your Steam API key in Settings → Integrations → Steam Account."
      );
    }

    const games = await getLibraryGamesByShop("steam");
    const result: AchievementImportResult = {
      gamesProcessed: 0,
      gamesWithAchievements: 0,
      totalUnlocked: 0,
    };

    for (const [gameKey, game] of games) {
      result.gamesProcessed++;
      try {
        const playerRes = await axios.get(
          "https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/",
          {
            params: {
              appid: game.objectId,
              key: prefs.steamApiKey,
              steamid: prefs.steamId,
            },
            timeout: 15_000,
          }
        );

        const playerAchievements: Array<{
          apiname: string;
          achieved: number;
          unlocktime: number;
        }> = playerRes.data?.playerstats?.achievements ?? [];
        if (playerAchievements.length === 0) continue;

        let definitions: SteamAchievement[] | null = null;
        try {
          const schemaRes = await axios.get(
            "https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/",
            {
              params: { key: prefs.steamApiKey, appid: game.objectId },
              timeout: 15_000,
            }
          );
          const schema: Array<{
            name: string;
            displayName: string;
            description?: string;
            icon: string;
            icongray: string;
            hidden: number;
          }> = schemaRes.data?.game?.availableGameStats?.achievements ?? [];
          if (schema.length > 0) {
            definitions = schema.map((a) => ({
              name: a.name,
              displayName: a.displayName,
              description: a.description ?? "",
              icon: a.icon,
              icongray: a.icongray,
              hidden: Boolean(a.hidden),
            }));
          }
        } catch {
          // schema is optional — Hydra API definitions may already exist
        }

        const unlocked: UnlockedAchievement[] = playerAchievements
          .filter((a) => a.achieved === 1)
          .map((a) => ({ name: a.apiname, unlockTime: a.unlocktime }));
        if (unlocked.length === 0) continue;

        await storeAchievements(gameKey, game, definitions, unlocked);
        result.gamesWithAchievements++;
        result.totalUnlocked += unlocked.length;
      } catch {
        // Game has no achievements / profile private for this app — skip
      }
    }

    achievementsLogger.log("Steam achievement import complete", result);
    return result;
  };

/* ───────────────────────── GOG ───────────────────────── */

export const importGogAchievements =
  async (): Promise<AchievementImportResult> => {
    const prefs = await getPrefs();
    if (!prefs?.gogRefreshToken) {
      throw new Error("GOG account not connected");
    }

    const tokens = await refreshGogToken(prefs.gogRefreshToken);
    await db.put(
      levelKeys.userPreferences,
      { ...prefs, gogRefreshToken: tokens.refresh_token },
      { valueEncoding: "json" }
    );
    const userInfo = await getGogUserInfo(tokens.access_token);
    if (!userInfo) throw new Error("Could not resolve GOG user");

    const games = await getLibraryGamesByShop("gog");
    const result: AchievementImportResult = {
      gamesProcessed: 0,
      gamesWithAchievements: 0,
      totalUnlocked: 0,
    };

    for (const [gameKey, game] of games) {
      result.gamesProcessed++;
      try {
        const credentials = await getGogGameCredentials(game.objectId);
        if (!credentials) continue;

        // gameplay.gog.com only accepts tokens issued for the game's own
        // OAuth client — the generic embed token is rejected with 401/403
        const gameToken = await getGogGameToken(
          tokens.refresh_token,
          credentials
        );
        if (!gameToken) continue;

        const remote = await getGogRemoteAchievements(
          gameToken,
          userInfo.userId,
          credentials.clientId
        );
        if (remote.length === 0) continue;

        const definitions: SteamAchievement[] = remote.map((a) => ({
          name: a.achievement_key,
          displayName: a.name,
          description: a.description,
          icon: a.image_url_unlocked,
          icongray: a.image_url_locked,
          hidden: !a.is_visible,
        }));

        const unlocked: UnlockedAchievement[] = remote
          .filter((a) => a.date_unlocked)
          .map((a) => ({
            name: a.achievement_key,
            unlockTime: new Date(a.date_unlocked!).getTime() / 1000,
          }));

        await storeAchievements(gameKey, game, definitions, unlocked);
        if (unlocked.length > 0) {
          result.gamesWithAchievements++;
          result.totalUnlocked += unlocked.length;
        }
      } catch {
        // No achievements for this game
      }
    }

    achievementsLogger.log("GOG achievement import complete", result);
    return result;
  };

/* ───────────────────────── Epic ───────────────────────── */

const EPIC_ACHIEVEMENTS_BASE = "https://achievements.epicgames.com/v1";

interface LegendaryAuth {
  accessToken: string;
  accountId: string;
  expiresAt?: string;
  refreshToken?: string;
}

const getLegendaryAuth = (): LegendaryAuth | null => {
  try {
    const userJson = path.join(getLegendaryConfigPath(), "user.json");
    if (!fs.existsSync(userJson)) return null;
    const parsed = JSON.parse(fs.readFileSync(userJson, "utf8"));
    if (!parsed?.access_token || !parsed?.account_id) return null;
    return {
      accessToken: parsed.access_token,
      accountId: parsed.account_id,
      expiresAt: parsed.expires_at,
      refreshToken: parsed.refresh_token,
    };
  } catch {
    return null;
  }
};

const refreshLegendaryToken = async (
  refreshToken: string
): Promise<LegendaryAuth | null> => {
  try {
    const res = await axios.post(
      "https://account-public-service-prod.ol.epicgames.com/account/api/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        token_type: "eg1",
      }),
      {
        headers: {
          Authorization:
            "basic MzRhMDJjZjhmNDQxNGUyOWIxNTkyMTg3NmRhMzZmOWE6ZGFhZmJjY2M3Mzc3NDUwMzlkZmZlNTNkOTRmYzc0Ng==",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15_000,
      }
    );
    const data = res.data;
    if (!data?.access_token || !data?.account_id) return null;
    const updated: LegendaryAuth = {
      accessToken: data.access_token,
      accountId: data.account_id,
      expiresAt: data.expires_at,
      refreshToken: data.refresh_token ?? refreshToken,
    };
    try {
      const userJson = path.join(getLegendaryConfigPath(), "user.json");
      const existing = JSON.parse(fs.readFileSync(userJson, "utf8"));
      fs.writeFileSync(
        userJson,
        JSON.stringify(
          {
            ...existing,
            access_token: updated.accessToken,
            expires_at: updated.expiresAt,
            refresh_token: updated.refreshToken,
          },
          null,
          2
        )
      );
    } catch {
      // non-fatal
    }
    return updated;
  } catch {
    return null;
  }
};

const getValidLegendaryAuth = async (): Promise<LegendaryAuth | null> => {
  const auth = getLegendaryAuth();
  if (!auth) return null;
  if (auth.expiresAt && auth.refreshToken) {
    const expiresAt = new Date(auth.expiresAt).getTime();
    if (Date.now() > expiresAt - 5 * 60 * 1000) {
      const refreshed = await refreshLegendaryToken(auth.refreshToken);
      if (refreshed) return refreshed;
    }
  }
  return auth;
};

/** Epic doesn't ship playtime in legendary's metadata — it lives in the
 * library service. Returns a map of app_name (artifactId) → playtime in ms. */
export const getEpicPlaytimeMap = async (): Promise<Map<string, number>> => {
  const map = new Map<string, number>();
  const auth = await getValidLegendaryAuth();
  if (!auth) return map;

  try {
    const res = await axios.get(
      `https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/${auth.accountId}/all`,
      {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        timeout: 15_000,
      }
    );
    const items: Array<{ artifactId?: string; totalTime?: number }> =
      Array.isArray(res.data) ? res.data : [];
    for (const item of items) {
      if (item.artifactId && typeof item.totalTime === "number") {
        // totalTime is in seconds
        map.set(item.artifactId, item.totalTime * 1000);
      }
    }
  } catch (err) {
    achievementsLogger.warn("getEpicPlaytimeMap failed", err);
  }
  return map;
};

const getEpicSandboxId = (appName: string): string | null => {
  try {
    const metadataPath = path.join(
      getLegendaryConfigPath(),
      "metadata",
      `${appName}.json`
    );
    if (!fs.existsSync(metadataPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    return parsed?.metadata?.namespace ?? parsed?.namespace ?? null;
  } catch {
    return null;
  }
};

export const importEpicAchievements =
  async (): Promise<AchievementImportResult> => {
    const auth = await getValidLegendaryAuth();
    if (!auth) {
      throw new Error(
        "Epic account not connected (sign in via Legendary first)"
      );
    }

    const games = await getLibraryGamesByShop("epic");
    const result: AchievementImportResult = {
      gamesProcessed: 0,
      gamesWithAchievements: 0,
      totalUnlocked: 0,
    };

    const headers = { Authorization: `Bearer ${auth.accessToken}` };

    for (const [gameKey, game] of games) {
      result.gamesProcessed++;
      try {
        const sandboxId = getEpicSandboxId(game.objectId);
        if (!sandboxId) continue;

        // Fetch achievement definitions (no auth required)
        const defsRes = await axios.get(
          `${EPIC_ACHIEVEMENTS_BASE}/clients/${sandboxId}/achievements`,
          { headers, timeout: 15_000 }
        );
        const defsRaw: Array<{
          name: string;
          unlockedDisplayName?: string;
          lockedDisplayName?: string;
          unlockedDescription?: string;
          lockedDescription?: string;
          unlockedIconLink?: string;
          lockedIconLink?: string;
          hidden?: boolean;
        }> = defsRes.data?.achievements ?? defsRes.data ?? [];
        if (!Array.isArray(defsRaw) || defsRaw.length === 0) continue;

        const defs: SteamAchievement[] = defsRaw.map((a) => ({
          name: a.name,
          displayName: a.unlockedDisplayName ?? a.lockedDisplayName ?? a.name,
          description: a.unlockedDescription ?? a.lockedDescription ?? "",
          icon: a.unlockedIconLink ?? "",
          icongray: a.lockedIconLink ?? a.unlockedIconLink ?? "",
          hidden: Boolean(a.hidden),
        }));

        // Fetch player's unlocked achievements
        const playerRes = await axios.get(
          `${EPIC_ACHIEVEMENTS_BASE}/accounts/${auth.accountId}/games/${sandboxId}/achievements`,
          { headers, timeout: 15_000 }
        );
        const playerRaw: Array<{
          name: string;
          unlocked?: boolean;
          completionTime?: string;
        }> =
          playerRes.data?.playerAchievements ??
          playerRes.data?.achievements ??
          playerRes.data ??
          [];

        const unlocked: UnlockedAchievement[] = (
          Array.isArray(playerRaw) ? playerRaw : []
        )
          .filter((a) => a.unlocked)
          .map((a) => ({
            name: a.name,
            unlockTime: a.completionTime
              ? new Date(a.completionTime).getTime() / 1000
              : 0,
          }));

        await storeAchievements(gameKey, game, defs, unlocked);
        if (unlocked.length > 0) {
          result.gamesWithAchievements++;
          result.totalUnlocked += unlocked.length;
        }
      } catch {
        // No achievements / API mismatch for this game — skip
      }
    }

    achievementsLogger.log("Epic achievement import complete", result);
    return result;
  };

/* ───────────────────────── Xbox ───────────────────────── */

export const importXboxAchievements =
  async (): Promise<AchievementImportResult> => {
    const prefs = await getPrefs();
    if (!prefs?.xboxXstsToken || !prefs?.xboxUserHash) {
      throw new Error("Xbox account not connected");
    }

    const games = await getLibraryGamesByShop("xbox");
    const result: AchievementImportResult = {
      gamesProcessed: 0,
      gamesWithAchievements: 0,
      totalUnlocked: 0,
    };

    for (const [gameKey, game] of games) {
      result.gamesProcessed++;
      const titleId = game.xboxTitleId;
      if (!titleId) continue;

      await syncXboxGameAchievements(game.objectId, titleId).catch(() => {});

      const stored = await gameAchievementsSublevel
        .get(gameKey)
        .catch(() => null);
      if (stored && stored.unlockedAchievements.length > 0) {
        result.gamesWithAchievements++;
        result.totalUnlocked += stored.unlockedAchievements.length;
        await gamesSublevel.put(gameKey, {
          ...game,
          achievementCount: stored.achievements.length,
          unlockedAchievementCount: stored.unlockedAchievements.length,
        });
      }
    }

    achievementsLogger.log("Xbox achievement import complete", result);
    return result;
  };
