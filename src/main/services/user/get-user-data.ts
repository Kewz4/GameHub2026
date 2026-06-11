import {
  User,
  type ProfileVisibility,
  type UserDetails,
  type UserPreferences,
} from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import fs from "node:fs";

/** HydraAPI rejects ucarecdn.com image URLs, so uploads are stored locally in
 * userPreferences. Overlay them so the user's own images always show. */
const overlayLocalImages = async <
  T extends {
    profileImageUrl?: string | null;
    backgroundImageUrl?: string | null;
  },
>(
  user: T
): Promise<T> => {
  const prefs = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const rawBg = prefs?.localBackgroundImageUrl;
  // Convert local file path to a usable URL for the renderer.
  // Use the CDN/http URL as-is; convert local paths via file: protocol so
  // Electron's renderer can load them without the local: custom protocol.
  const resolvedBg = rawBg
    ? rawBg.startsWith("http") || rawBg.startsWith("file:")
      ? rawBg
      : `file:///${rawBg.replace(/\\/g, "/")}`
    : user.backgroundImageUrl;

  return {
    ...user,
    profileImageUrl: prefs?.localProfileImageUrl ?? user.profileImageUrl,
    backgroundImageUrl: resolvedBg,
  };
};

/** The banner lives on Uploadcare tagged with the Hydra account id. If this
 * install has no local banner yet (fresh install / cleared data), restore the
 * account's latest one so the banner follows the account everywhere. */
const restoreAccountBanner = async (userId: string): Promise<void> => {
  try {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    const existingBg = prefs?.localBackgroundImageUrl;
    if (existingBg) {
      // If it's an HTTP URL, we already have it
      if (existingBg.startsWith("http") || existingBg.startsWith("file:")) return;
      // If it's a local file path, only skip if the file actually exists
      if (fs.existsSync(existingBg)) return;
      // File missing (cleared data, new machine) — fall through to restore from CDN
    }

    const { UploadcareSync } = await import("../uploadcare-sync");
    const bannerUrl = await UploadcareSync.findLatestImageByKind(
      "profile-banner",
      userId
    );
    if (!bannerUrl) return;

    await db.put(
      levelKeys.userPreferences,
      { ...(prefs ?? {}), localBackgroundImageUrl: bannerUrl },
      { valueEncoding: "json" }
    );
    logger.log(`Restored account banner from Uploadcare: ${bannerUrl}`);
  } catch (error) {
    logger.error("Failed to restore account banner", error);
  }
};

export const getUserData = async () => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then(async (me) => {
      if (me?.id) await restoreAccountBanner(me.id);
      return overlayLocalImages(me);
    })
    .then(async (me) => {
      try {
        const user = await db.get<string, User>(levelKeys.user, {
          valueEncoding: "json",
        });
        await db.put<string, User>(
          levelKeys.user,
          {
            ...user,
            id: me.id,
            displayName: me.displayName,
            profileImageUrl: me.profileImageUrl,
            backgroundImageUrl: me.backgroundImageUrl,
            subscription: me.subscription,
          },
          { valueEncoding: "json" }
        );
      } catch (error) {
        logger.error("Failed to update user in DB", error);
      }
      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }

      logger.error("Failed to get logged user", err);

      try {
        const loggedUser = await db.get<string, User>(levelKeys.user, {
          valueEncoding: "json",
        });

        if (loggedUser) {
          return overlayLocalImages({
            ...loggedUser,
            username: "",
            bio: "",
            email: null,
            profileVisibility: "PUBLIC" as ProfileVisibility,
            quirks: {
              backupsPerGameLimit: 0,
            },
            subscription: loggedUser.subscription
              ? {
                  id: loggedUser.subscription.id,
                  status: loggedUser.subscription.status,
                  plan: {
                    id: loggedUser.subscription.plan.id,
                    name: loggedUser.subscription.plan.name,
                  },
                  expiresAt: loggedUser.subscription.expiresAt,
                }
              : null,
          } as UserDetails);
        }
      } catch (dbError) {
        logger.error("Failed to read user from DB", dbError);
      }

      return null;
    });
};
