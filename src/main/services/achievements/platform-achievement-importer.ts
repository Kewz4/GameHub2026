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
  getGogGameClientId,
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
    if (!prefs?.steamId || !prefs?.steamApiKey) {
      throw new Error(
        "Steam account not connected (Steam ID + API key required)"
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
        const clientId = await getGogGameClientId(game.objectId);
        if (!clientId) continue;

        const remote = await getGogRemoteAchievements(
          tokens.access_token,
          userInfo.userId,
          clientId
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

const EPIC_GRAPHQL_URL = "https://launcher.store.epicgames.com/graphql";

const getLegendaryAuth = (): {
  accessToken: string;
  accountId: string;
} | null => {
  try {
    const userJson = path.join(getLegendaryConfigPath(), "user.json");
    if (!fs.existsSync(userJson)) return null;
    const parsed = JSON.parse(fs.readFileSync(userJson, "utf8"));
    if (!parsed?.access_token || !parsed?.account_id) return null;
    return { accessToken: parsed.access_token, accountId: parsed.account_id };
  } catch {
    return null;
  }
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
    const auth = getLegendaryAuth();
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

    const headers = {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    };

    for (const [gameKey, game] of games) {
      result.gamesProcessed++;
      try {
        const sandboxId = getEpicSandboxId(game.objectId);
        if (!sandboxId) continue;

        const definitionsRes = await axios.post(
          EPIC_GRAPHQL_URL,
          {
            query: `query($sandboxId: String!) {
              Achievement {
                productAchievementsRecordBySandbox(sandboxId: $sandboxId) {
                  records {
                    achievements {
                      achievement {
                        name
                        unlockedDisplayName
                        lockedDisplayName
                        unlockedDescription
                        lockedDescription
                        unlockedIconLink
                        lockedIconLink
                        hidden
                      }
                    }
                  }
                }
              }
            }`,
            variables: { sandboxId },
          },
          { headers, timeout: 15_000 }
        );

        const records =
          definitionsRes.data?.data?.Achievement
            ?.productAchievementsRecordBySandbox?.records ?? [];
        const defs: SteamAchievement[] = [];
        for (const record of records) {
          for (const entry of record?.achievements ?? []) {
            const a = entry?.achievement;
            if (!a?.name) continue;
            defs.push({
              name: a.name,
              displayName:
                a.unlockedDisplayName ?? a.lockedDisplayName ?? a.name,
              description: a.unlockedDescription ?? a.lockedDescription ?? "",
              icon: a.unlockedIconLink ?? "",
              icongray: a.lockedIconLink ?? a.unlockedIconLink ?? "",
              hidden: Boolean(a.hidden),
            });
          }
        }
        if (defs.length === 0) continue;

        const playerRes = await axios.post(
          EPIC_GRAPHQL_URL,
          {
            query: `query($epicAccountId: String!, $sandboxId: String!) {
              PlayerProfile {
                playerProfile(epicAccountId: $epicAccountId) {
                  playerAchievementGameRecordsBySandbox(sandboxId: $sandboxId) {
                    records {
                      playerAchievements {
                        playerAchievement {
                          achievementName
                          unlocked
                          unlockDate
                        }
                      }
                    }
                  }
                }
              }
            }`,
            variables: { epicAccountId: auth.accountId, sandboxId },
          },
          { headers, timeout: 15_000 }
        );

        const playerRecords =
          playerRes.data?.data?.PlayerProfile?.playerProfile
            ?.playerAchievementGameRecordsBySandbox?.records ?? [];
        const unlocked: UnlockedAchievement[] = [];
        for (const record of playerRecords) {
          for (const entry of record?.playerAchievements ?? []) {
            const a = entry?.playerAchievement;
            if (!a?.achievementName || !a.unlocked) continue;
            unlocked.push({
              name: a.achievementName,
              unlockTime: a.unlockDate
                ? new Date(a.unlockDate).getTime() / 1000
                : 0,
            });
          }
        }

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
      const titleId = (game as Game & { xboxTitleId?: string | null })
        .xboxTitleId;
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
