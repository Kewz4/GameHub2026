import { registerEvent } from "../register-event";
import { HydraApi, logger, WindowManager } from "@main/services";
import type {
  UpdateProfileRequest,
  UserPreferences,
  UserProfile,
} from "@types";
import { omit } from "lodash-es";
import { R2Sync } from "@main/services/r2-sync";
import { db, levelKeys } from "@main/level";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import axios from "axios";
import { invalidateProfileImagesCache } from "./get-profile-images";
import {
  resolvePersistedProfileImageUrl,
  sanitizeProfileImageCacheComponent,
} from "@main/services/profile-image-helpers";
import {
  assertProfileImageAccountSessionCurrent,
  assertProfileImageAccountSessionGeneration,
  captureProfileImageAccountSessionGeneration,
  createProfileImageAccountSessionScope,
  type ProfileImageAccountSessionScope,
} from "@main/services/profile-image-account-session";

type ProfileImageKind = "profile-avatar" | "profile-banner";
type HydraProfileImageType = "profile-image" | "background-image";

interface PersistedProfileImage {
  rendererUrl: string;
  socialUrl: string | null;
}

interface HydraProfileImageUploadResponse {
  presignedUrl: string;
  profileImageUrl?: string;
  backgroundImageUrl?: string;
}

interface ProfileImageMutationSession {
  scope: ProfileImageAccountSessionScope;
  bearerToken: string;
}

const profileImageMutationTails = new Map<string, Promise<void>>();

const describeProfileMutationError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return (
      [error.code, status ? `HTTP ${status}` : null]
        .filter(Boolean)
        .join(" ") || "request failed"
    );
  }
  return error instanceof Error ? error.message : "unknown error";
};

const runSerializedProfileImageMutation = async <T>(
  ownerId: string,
  kind: ProfileImageKind,
  operation: () => Promise<T>
): Promise<T> => {
  const key = JSON.stringify([ownerId, kind]);
  const previous = profileImageMutationTails.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const settled = current.then(
    () => undefined,
    () => undefined
  );
  profileImageMutationTails.set(key, settled);

  try {
    return await current;
  } finally {
    if (profileImageMutationTails.get(key) === settled) {
      profileImageMutationTails.delete(key);
    }
  }
};

const persistLocalProfileAsset = async (
  sourcePath: string,
  fileBase: "avatar" | "banner",
  session: ProfileImageMutationSession
) => {
  assertProfileImageAccountSessionCurrent(session.scope);
  const ownerId = session.scope.ownerId;
  const ownerDirectory = `${sanitizeProfileImageCacheComponent(ownerId).slice(
    0,
    48
  )}-${crypto.createHash("sha256").update(ownerId).digest("hex").slice(0, 12)}`;
  const profileAssetsDir = path.join(
    app.getPath("userData"),
    "profile-assets",
    ownerDirectory
  );
  await fs.promises.mkdir(profileAssetsDir, { recursive: true });
  assertProfileImageAccountSessionCurrent(session.scope);
  const detected = await (
    await import("file-type")
  ).fileTypeFromFile(sourcePath);
  assertProfileImageAccountSessionCurrent(session.scope);
  const extension =
    detected?.ext ?? (path.extname(sourcePath).slice(1) || "webp");
  // Versioned destinations keep the currently rendered image intact until the
  // complete copy is persisted and the preference switches to the new path.
  const destinationPath = path.join(
    profileAssetsDir,
    `${fileBase}-${Date.now()}-${crypto.randomUUID()}.${extension}`
  );
  await fs.promises.copyFile(sourcePath, destinationPath);
  assertProfileImageAccountSessionCurrent(session.scope);
  return destinationPath;
};

const assertStableRendererUrl = (value: string | null | undefined) => {
  if (!value) throw new Error("Hydra did not return a profile image URL");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Hydra returned an unsupported profile image URL");
  }
  return url.toString();
};

const getHydraApiUrl = (pathname: string) => {
  const baseUrl = import.meta.env.MAIN_VITE_API_URL?.trim();
  if (!baseUrl) throw new Error("Hydra API URL is not configured");
  return `${baseUrl.replace(/\/+$/g, "")}${pathname}`;
};

const getCapturedHydraRequestConfig = (
  session: ProfileImageMutationSession
) => ({
  headers: { Authorization: `Bearer ${session.bearerToken}` },
});

const captureProfileImageMutationSession = async () => {
  const generation = captureProfileImageAccountSessionGeneration();
  const bearerToken = await HydraApi.getAccessToken();
  assertProfileImageAccountSessionGeneration(generation);

  const response = await axios.get<UserProfile>(getHydraApiUrl("/profile/me"), {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  assertProfileImageAccountSessionGeneration(generation);

  return {
    bearerToken,
    scope: createProfileImageAccountSessionScope(response.data.id, generation),
  } satisfies ProfileImageMutationSession;
};

const uploadHydraProfileImage = async (
  type: HydraProfileImageType,
  sourcePath: string,
  session: ProfileImageMutationSession
) => {
  assertProfileImageAccountSessionCurrent(session.scope);
  const [stat, detected] = await Promise.all([
    fs.promises.stat(sourcePath),
    import("file-type").then(({ fileTypeFromFile }) =>
      fileTypeFromFile(sourcePath)
    ),
  ]);
  assertProfileImageAccountSessionCurrent(session.scope);
  const imageExt = detected?.ext ?? path.extname(sourcePath).slice(1);
  if (!imageExt) throw new Error("Could not determine profile image type");

  const response = await axios.post<HydraProfileImageUploadResponse>(
    getHydraApiUrl(`/presigned-urls/${type}`),
    { imageExt, imageLength: stat.size },
    getCapturedHydraRequestConfig(session)
  );
  assertProfileImageAccountSessionCurrent(session.scope);
  const uploadUrl = new URL(response.data.presignedUrl);
  if (uploadUrl.protocol !== "https:") {
    throw new Error("Hydra returned an insecure profile upload URL");
  }

  const stableUrl = assertStableRendererUrl(
    type === "background-image"
      ? response.data.backgroundImageUrl
      : response.data.profileImageUrl
  );
  const fileBuffer = await fs.promises.readFile(sourcePath);
  assertProfileImageAccountSessionCurrent(session.scope);
  await axios.put(uploadUrl.toString(), fileBuffer, {
    headers: { "Content-Type": detected?.mime ?? "application/octet-stream" },
  });
  assertProfileImageAccountSessionCurrent(session.scope);

  // Persist only Hydra's stable canonical URL. The upload URL is temporary.
  return stableUrl;
};

const persistProfileImage = async ({
  sourcePath,
  kind,
  localFileBase,
  hydraType,
  session,
}: {
  sourcePath: string;
  kind: ProfileImageKind;
  localFileBase: "avatar" | "banner";
  hydraType: HydraProfileImageType;
  session: ProfileImageMutationSession;
}): Promise<PersistedProfileImage> => {
  const ownerId = session.scope.ownerId;
  const [localPath, r2ImageKey, socialUrl] = await Promise.all([
    persistLocalProfileAsset(sourcePath, localFileBase, session).catch(
      (error) => {
        logger.warn(
          `Could not persist local ${kind}: ${describeProfileMutationError(error)}`
        );
        return null;
      }
    ),
    runSerializedProfileImageMutation(ownerId, kind, async () => {
      assertProfileImageAccountSessionCurrent(session.scope);
      const key = await R2Sync.uploadImage(sourcePath, {
        kind,
        hydraUserId: ownerId,
      });
      assertProfileImageAccountSessionCurrent(session.scope);
      return key;
    }).catch((error) => {
      logger.warn(
        `Could not upload ${kind} to R2: ${describeProfileMutationError(error)}`
      );
      return null;
    }),
    uploadHydraProfileImage(hydraType, sourcePath, session).catch((error) => {
      logger.warn(
        `Could not publish ${kind} through Hydra: ${describeProfileMutationError(error)}`
      );
      return null;
    }),
  ]);

  assertProfileImageAccountSessionCurrent(session.scope);
  let rendererUrl = localPath;
  if (!rendererUrl && r2ImageKey) {
    assertProfileImageAccountSessionCurrent(session.scope);
    const cached = await R2Sync.findLatestImageByKind(kind, ownerId).catch(
      () => null
    );
    assertProfileImageAccountSessionCurrent(session.scope);
    if (cached) rendererUrl = cached;
  }

  rendererUrl ??= socialUrl;
  if (!rendererUrl) throw new Error(`GameHub could not persist ${kind}`);

  return { rendererUrl, socialUrl };
};

export const patchUserProfile = async (updateProfile: UpdateProfileRequest) => {
  return HydraApi.patch<UserProfile>("/profile", updateProfile);
};

const patchUserProfileInCapturedSession = async (
  session: ProfileImageMutationSession,
  updateProfile: UpdateProfileRequest
) => {
  assertProfileImageAccountSessionCurrent(session.scope);
  const response = await axios.patch<UserProfile>(
    getHydraApiUrl("/profile"),
    updateProfile,
    getCapturedHydraRequestConfig(session)
  );
  assertProfileImageAccountSessionCurrent(session.scope);
  return response.data;
};

const getUserProfileInCapturedSession = async (
  session: ProfileImageMutationSession
) => {
  assertProfileImageAccountSessionCurrent(session.scope);
  const response = await axios.get<UserProfile>(
    getHydraApiUrl("/profile/me"),
    getCapturedHydraRequestConfig(session)
  );
  assertProfileImageAccountSessionCurrent(session.scope);
  return response.data;
};

const updateProfile = async (
  _event: Electron.IpcMainInvokeEvent,
  updateProfile: UpdateProfileRequest
) => {
  const payload = omit(updateProfile, [
    "profileImageUrl",
    "backgroundImageUrl",
  ]);

  const prefUpdates: Partial<UserPreferences> = {};
  const pendingR2Deletions: Promise<void>[] = [];
  const profileImagesChanged =
    updateProfile.profileImageUrl !== undefined ||
    updateProfile.backgroundImageUrl !== undefined;
  // Every profile mutation is pinned to one authenticated owner. Image
  // uploads are the longest race window, but a text-only edit must not patch a
  // newly signed-in account either.
  const profileSession = await captureProfileImageMutationSession();
  const profileOwnerId = profileSession.scope.ownerId;
  if (profileImagesChanged) {
    prefUpdates.profileImageOwnershipMigrationVersion = 1;
  }

  if (updateProfile.profileImageUrl !== undefined) {
    if (updateProfile.profileImageUrl === null) {
      payload["profileImageUrl"] = null;
      prefUpdates.localProfileImageUrl = null;
      prefUpdates.localProfileImageUserId = profileOwnerId;
      prefUpdates.profileAvatarRemoved = true;
      if (profileOwnerId) {
        pendingR2Deletions.push(
          runSerializedProfileImageMutation(
            profileOwnerId,
            "profile-avatar",
            async () => {
              assertProfileImageAccountSessionCurrent(profileSession.scope);
              await R2Sync.deleteProfileImagesByKind(
                "profile-avatar",
                profileOwnerId
              );
              assertProfileImageAccountSessionCurrent(profileSession.scope);
            }
          ).catch((error) => {
            logger.warn(
              `Could not delete profile avatar from R2: ${describeProfileMutationError(error)}`
            );
          })
        );
      }
    } else {
      const persisted = await persistProfileImage({
        sourcePath: updateProfile.profileImageUrl,
        kind: "profile-avatar",
        localFileBase: "avatar",
        hydraType: "profile-image",
        session: profileSession,
      });
      prefUpdates.localProfileImageUrl = persisted.rendererUrl;
      prefUpdates.localProfileImageUserId = profileOwnerId;
      prefUpdates.profileAvatarRemoved = false;
      if (persisted.socialUrl) {
        payload["profileImageUrl"] = persisted.socialUrl;
      }
    }
  }

  if (updateProfile.backgroundImageUrl !== undefined) {
    if (updateProfile.backgroundImageUrl === null) {
      if (profileOwnerId) {
        pendingR2Deletions.push(
          runSerializedProfileImageMutation(
            profileOwnerId,
            "profile-banner",
            async () => {
              assertProfileImageAccountSessionCurrent(profileSession.scope);
              await R2Sync.deleteProfileImagesByKind(
                "profile-banner",
                profileOwnerId
              );
              assertProfileImageAccountSessionCurrent(profileSession.scope);
            }
          ).catch((error) => {
            logger.warn(
              `Could not delete profile banner from R2: ${describeProfileMutationError(error)}`
            );
          })
        );
      }
      payload["backgroundImageUrl"] = null;
      prefUpdates.localBackgroundImageUrl = null;
      prefUpdates.localBackgroundImageUserId = profileOwnerId;
      prefUpdates.profileBannerRemoved = true;
    } else {
      const persisted = await persistProfileImage({
        sourcePath: updateProfile.backgroundImageUrl,
        kind: "profile-banner",
        localFileBase: "banner",
        hydraType: "background-image",
        session: profileSession,
      });
      prefUpdates.localBackgroundImageUrl = persisted.rendererUrl;
      prefUpdates.localBackgroundImageUserId = profileOwnerId;
      prefUpdates.profileBannerRemoved = false;
      if (persisted.socialUrl) {
        payload["backgroundImageUrl"] = persisted.socialUrl;
      }
    }
  }

  // Persist URLs locally so they survive even if HydraAPI rejects them.
  if (Object.keys(prefUpdates).length > 0) {
    assertProfileImageAccountSessionCurrent(profileSession.scope);
    const prefs = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => ({}) as UserPreferences);
    assertProfileImageAccountSessionCurrent(profileSession.scope);
    await db.put(
      levelKeys.userPreferences,
      { ...prefs, ...prefUpdates },
      { valueEncoding: "json" }
    );
    assertProfileImageAccountSessionCurrent(profileSession.scope);
  }

  // The owner-scoped tombstone is durable before waiting on R2. Awaiting the
  // serialized deletion prevents a quick remove-then-upload from deleting the
  // replacement object after this IPC call has already returned.
  await Promise.all(pendingR2Deletions);
  assertProfileImageAccountSessionCurrent(profileSession.scope);

  if (profileImagesChanged) {
    invalidateProfileImagesCache(profileOwnerId ?? undefined);
  }

  // Best-effort HydraAPI sync. Only Hydra's stable canonical social URL enters
  // this payload; private R2 keys and temporary upload URLs never do.
  // Fall back to current profile from server to avoid corrupting Redux state.
  const serverProfile = await patchUserProfileInCapturedSession(
    profileSession,
    payload
  ).catch(async () => {
    assertProfileImageAccountSessionCurrent(profileSession.scope);
    return getUserProfileInCapturedSession(profileSession).catch(() => {
      assertProfileImageAccountSessionCurrent(profileSession.scope);
      return {} as UserProfile;
    });
  });

  assertProfileImageAccountSessionCurrent(profileSession.scope);

  // The friends window owns a separate renderer store and already listens for
  // this event. Keep it in sync with the main and Big Picture profile views.
  WindowManager.sendToAppWindows("on-profile-updated");

  // Return the renderer-safe local source immediately as well. Without this,
  // Redux briefly replaces the freshly selected image with Hydra's older URL
  // until the next getMe/profile refresh finishes.
  return {
    ...serverProfile,
    ...(updateProfile.profileImageUrl !== undefined
      ? {
          profileImageUrl:
            updateProfile.profileImageUrl === null
              ? null
              : resolvePersistedProfileImageUrl(
                  prefUpdates.localProfileImageUrl,
                  fs.existsSync
                ),
        }
      : {}),
    ...(updateProfile.backgroundImageUrl !== undefined
      ? {
          backgroundImageUrl:
            updateProfile.backgroundImageUrl === null
              ? null
              : resolvePersistedProfileImageUrl(
                  prefUpdates.localBackgroundImageUrl,
                  fs.existsSync
                ),
        }
      : {}),
  } as UserProfile;
};

registerEvent("updateProfile", updateProfile);
