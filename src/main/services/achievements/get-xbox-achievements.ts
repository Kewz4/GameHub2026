import axios from "axios";
import { db, gamesSublevel, levelKeys } from "@main/level";
import type {
  UserPreferences,
  SteamAchievement,
  UnlockedAchievement,
} from "@types";
import { logger } from "@main/services/logger";
import { persistImportedAchievements } from "./persist-imported-achievements";

interface XblAchievement {
  id: string;
  name: string;
  titleAssociations: Array<{ name: string; id: number }>;
  progressState: "Achieved" | "InProgress" | "NotStarted";
  progression: {
    timeUnlocked: string; // ISO date or ""
    requirements: any[];
  };
  mediaAssets: Array<{ name: string; type: string; url: string }>;
  isSecret: boolean;
  description: string;
  lockedDescription: string;
  productId: string;
  achievementType: string;
  isRevoked: boolean;
  rewards: Array<{
    name: string | null;
    description: string | null;
    value: string;
    mediaAsset: any;
    type: string;
  }>;
  estimatedTime: string;
  deeplink: string;
}

export async function getXboxAchievements(
  titleId: string,
  xuid: string,
  uhs: string,
  xstsToken: string
): Promise<{
  achievements: SteamAchievement[];
  unlocked: UnlockedAchievement[];
}> {
  const headers = {
    Authorization: `XBL3.0 x=${uhs};${xstsToken}`,
    "x-xbl-contract-version": "2",
    "Accept-Language": "en-US",
    Accept: "application/json",
  };

  const res = await axios.get(
    `https://achievements.xboxlive.com/users/xuid(${xuid})/achievements`,
    {
      params: { titleId, maxItems: 1000 },
      headers,
      timeout: 15_000,
    }
  );

  const items: XblAchievement[] = res.data?.achievements ?? [];

  const achievements: SteamAchievement[] = items.map((a) => {
    const icon = a.mediaAssets?.find((m) => m.type === "Icon")?.url ?? "";
    return {
      name: a.id,
      displayName: a.name,
      description: a.isSecret ? "" : a.description,
      icon,
      icongray: icon,
      hidden: a.isSecret,
    };
  });

  const unlocked: UnlockedAchievement[] = items
    .filter((a) => a.progressState === "Achieved")
    .map((a) => ({
      name: a.id,
      unlockTime: a.progression?.timeUnlocked
        ? new Date(a.progression.timeUnlocked).getTime() / 1000
        : 0,
    }));

  return { achievements, unlocked };
}

/** Fetch and store Xbox achievements for a game in the library. */
export async function syncXboxGameAchievements(
  objectId: string, // productId
  titleId: string
): Promise<void> {
  try {
    const prefs = await db.get<string, UserPreferences>(
      levelKeys.userPreferences,
      {
        valueEncoding: "json",
      }
    );

    if (!prefs?.xboxXstsToken || !prefs?.xboxUserHash) return;

    // Extract xuid from stored gamertag preferences (written during Xbox sign-in)
    // We need xuid — retrieve from the xboxAccessToken JWT claims or store it separately.
    // For now, read xboxXuid from prefs (we'll write it during auth).
    const xuid = (prefs as any).xboxXuid as string | undefined;
    if (!xuid) return;

    const { achievements, unlocked } = await getXboxAchievements(
      titleId,
      xuid,
      prefs.xboxUserHash,
      prefs.xboxXstsToken
    );

    const key = levelKeys.game("xbox", objectId);
    const game = await gamesSublevel.get(key).catch(() => null);
    if (!game || game.isDeleted) return;

    await persistImportedAchievements(game, achievements, unlocked);

    logger.log(
      `Xbox achievements synced for ${objectId}: ${unlocked.length}/${achievements.length} unlocked`
    );
  } catch (err) {
    logger.error("Failed to sync Xbox achievements", {
      objectId,
      titleId,
      err,
    });
  }
}
