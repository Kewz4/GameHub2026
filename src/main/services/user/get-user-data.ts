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
import { app } from "electron";
import {
  planLegacyProfileImageOwnerMigration,
  resolveOwnedProfileImagePreference,
} from "../profile-image-helpers";

/** Private R2 keys are not public image URLs, so profile images are stored as
 * renderer-safe local cache paths in userPreferences. */
const overlayLocalImages = async <
  T extends {
    id: string;
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

  const avatarPreference = resolveOwnedProfileImagePreference(
    prefs ?? {},
    "avatar",
    user.id,
    fs.existsSync
  );
  const bannerPreference = resolveOwnedProfileImagePreference(
    prefs ?? {},
    "banner",
    user.id,
    fs.existsSync
  );
  const resolvedBg = bannerPreference.removed
    ? null
    : (bannerPreference.url ?? user.backgroundImageUrl);
  const resolvedAvatar = avatarPreference.removed
    ? null
    : (avatarPreference.url ?? user.profileImageUrl);

  return {
    ...user,
    profileImageUrl: resolvedAvatar,
    backgroundImageUrl: resolvedBg,
  };
};

/**
 * Adopt only legacy values with strong account provenance, then restore any
 * missing images from the signed-in account's private R2 namespace.
 */
const restoreAccountProfileImages = async (userId: string): Promise<void> => {
  try {
    const storedPreferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    const migration = planLegacyProfileImageOwnerMigration(
      storedPreferences ?? {}
    );
    const prefs: UserPreferences = {
      ...(storedPreferences ?? ({} as UserPreferences)),
      ...migration,
    };

    // Commit the migration/quarantine marker before touching the network. If
    // R2 is offline, a later account switch must still be unable to claim an
    // unknown ownerless value.
    if (Object.keys(migration).length > 0) {
      await db.put(levelKeys.userPreferences, prefs, {
        valueEncoding: "json",
      });
    }

    const avatarPreference = resolveOwnedProfileImagePreference(
      prefs,
      "avatar",
      userId,
      fs.existsSync
    );
    const bannerPreference = resolveOwnedProfileImagePreference(
      prefs,
      "banner",
      userId,
      fs.existsSync
    );

    const { R2Sync } = await import("../r2-sync");
    const [avatarUrl, bannerUrl] = await Promise.all([
      avatarPreference.url || avatarPreference.removed
        ? Promise.resolve(null)
        : R2Sync.findLatestImageByKind("profile-avatar", userId),
      bannerPreference.url || bannerPreference.removed
        ? Promise.resolve(null)
        : R2Sync.findLatestImageByKind("profile-banner", userId),
    ]);

    const updates: Partial<UserPreferences> = {};
    if (avatarUrl) {
      updates.localProfileImageUrl = avatarUrl;
      updates.localProfileImageUserId = userId;
      updates.profileAvatarRemoved = false;
    }
    if (bannerUrl) {
      updates.localBackgroundImageUrl = bannerUrl;
      updates.localBackgroundImageUserId = userId;
      updates.profileBannerRemoved = false;
    }

    if (Object.keys(updates).length > 0) {
      await db.put(
        levelKeys.userPreferences,
        { ...prefs, ...updates },
        { valueEncoding: "json" }
      );
    }
    if (avatarUrl || bannerUrl) {
      logger.log(
        `Restored account profile images from R2 (avatar=${Boolean(
          avatarUrl
        )}, banner=${Boolean(bannerUrl)})`
      );
    }
  } catch (error) {
    logger.error("Failed to restore account profile images", error);
  }
};

export const getUserData = async () => {
  if (!app.isPackaged && process.env.GAMEHUB_READ_ONLY_VISUAL_QA === "true") {
    const loggedUser = await db
      .get<string, User>(levelKeys.user, { valueEncoding: "json" })
      .catch(() => null);
    if (!loggedUser) return null;
    return overlayLocalImages({
      ...loggedUser,
      username: loggedUser.displayName.trim() || "GameHub user",
      bio: "",
      email: null,
      profileVisibility: "PUBLIC" as ProfileVisibility,
      quirks: { backupsPerGameLimit: 0 },
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

  return HydraApi.get<UserDetails>(`/profile/me`)
    .then(async (me) => {
      if (me?.id) await restoreAccountProfileImages(me.id);
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
            username: loggedUser.displayName.trim() || "GameHub user",
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
