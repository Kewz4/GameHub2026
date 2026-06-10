import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { UpdateProfileRequest, UserProfile } from "@types";
import { omit } from "lodash-es";
import { UploadcareSync } from "@main/services/uploadcare-sync";

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

  if (updateProfile.profileImageUrl !== undefined) {
    if (updateProfile.profileImageUrl === null) {
      payload["profileImageUrl"] = null;
    } else {
      const profileImageUrl = await UploadcareSync.uploadImage(
        updateProfile.profileImageUrl
      ).catch(() => undefined);
      payload["profileImageUrl"] = profileImageUrl;
    }
  }

  if (updateProfile.backgroundImageUrl !== undefined) {
    if (updateProfile.backgroundImageUrl === null) {
      payload["backgroundImageUrl"] = null;
    } else {
      const backgroundImageUrl = await UploadcareSync.uploadImage(
        updateProfile.backgroundImageUrl
      ).catch(() => undefined);
      payload["backgroundImageUrl"] = backgroundImageUrl;
    }
  }

  return patchUserProfile(payload);
};

registerEvent("updateProfile", updateProfile);
