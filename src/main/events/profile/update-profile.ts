import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UpdateProfileRequest, UserProfile } from "@types";
import { omit } from "lodash-es";
import { UploadcareSync } from "@main/services/uploadcare-sync";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const patchUserProfile = async (updateProfile: UpdateProfileRequest) => {
  return HydraApi.patch<UserProfile>("/profile", updateProfile);
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

  if (updateProfile.profileImageUrl !== undefined) {
    if (updateProfile.profileImageUrl === null) {
      payload["profileImageUrl"] = null;
      prefUpdates.localProfileImageUrl = null;
    } else {
      // Upload to Uploadcare; store locally so the app always shows the image
      // even if HydraAPI rejects the ucarecdn.com domain.
      const uploadcareUrl = await UploadcareSync.uploadImage(
        updateProfile.profileImageUrl
      ).catch(() => undefined);
      payload["profileImageUrl"] = uploadcareUrl ?? null;
      prefUpdates.localProfileImageUrl = uploadcareUrl ?? null;
    }
  }

  if (updateProfile.backgroundImageUrl !== undefined) {
    if (updateProfile.backgroundImageUrl === null) {
      payload["backgroundImageUrl"] = null;
      prefUpdates.localBackgroundImageUrl = null;
    } else {
      // Tag with the Hydra account id so any install can restore the banner
      const me = await HydraApi.get<UserProfile>("/profile/me").catch(
        () => null
      );
      const uploadcareUrl = await UploadcareSync.uploadImage(
        updateProfile.backgroundImageUrl,
        me?.id
          ? { kind: "profile-banner", hydraUserId: me.id }
          : { kind: "profile-banner" }
      ).catch(() => undefined);
      payload["backgroundImageUrl"] = uploadcareUrl ?? null;
      prefUpdates.localBackgroundImageUrl = uploadcareUrl ?? null;
    }
  }

  // Persist URLs locally so they survive even if HydraAPI rejects them.
  if (Object.keys(prefUpdates).length > 0) {
    const prefs = await db
      .get<string, UserPreferences>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => ({}) as UserPreferences);
    await db.put(
      levelKeys.userPreferences,
      { ...prefs, ...prefUpdates },
      { valueEncoding: "json" }
    );
  }

  // Best-effort HydraAPI sync — ignore errors (backend may reject ucarecdn.com).
  // Fall back to current profile from server to avoid corrupting Redux state.
  return patchUserProfile(payload).catch(async () => {
    return HydraApi.get<UserProfile>("/profile/me").catch(() => ({}) as UserProfile);
  }) as Promise<UserProfile>;
};

registerEvent("updateProfile", updateProfile);
