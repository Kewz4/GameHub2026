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

  return {
    ...user,
    profileImageUrl: prefs?.localProfileImageUrl ?? user.profileImageUrl,
    backgroundImageUrl:
      prefs?.localBackgroundImageUrl ?? user.backgroundImageUrl,
  };
};

export const getUserData = async () => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then((me) => overlayLocalImages(me))
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
