import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UploadcareSync } from "@main/services/uploadcare-sync";
import { db, levelKeys } from "@main/level";
import type { UserPreferences, UserProfile } from "@types";
import fs from "node:fs";

export interface ProfileImages {
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

// All GameHub installs share the same Uploadcare project, so any client can
// look up another user's banner/avatar by the hydraUserId metadata tag.
// Cache lookups per user for the session — the Uploadcare list endpoint is
// paginated and slow.
const lookupCache = new Map<string, { value: ProfileImages; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export const invalidateProfileImagesCache = (userId?: string) => {
  if (userId) lookupCache.delete(userId);
  else lookupCache.clear();
};

let ownIdCache: string | null = null;

const getOwnId = async (): Promise<string | null> => {
  if (ownIdCache) return ownIdCache;
  const me = await HydraApi.get<UserProfile>("/profile/me").catch(() => null);
  ownIdCache = me?.id ?? null;
  return ownIdCache;
};

const toRendererUrl = (value: string | null): string | null => {
  if (!value) return null;
  if (value.startsWith("http") || value.startsWith("file:")) return value;
  // Local filesystem path (possibly already local:-prefixed by an older
  // version) — only usable if the file still exists; a missing file here is
  // what used to leave a broken image after relaunch
  const rawPath = value.startsWith("local:")
    ? value.slice("local:".length)
    : value;
  if (!fs.existsSync(rawPath)) return null;
  return `local:${rawPath.replace(/\\/g, "/")}`;
};

const getProfileImages = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<ProfileImages> => {
  const cached = lookupCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const result: ProfileImages = {
    profileImageUrl: null,
    backgroundImageUrl: null,
  };

  const ownId = await getOwnId();

  if (ownId && userId === ownId) {
    // Own profile: prefer the locally cached copies (instant, offline-safe)
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    result.profileImageUrl = toRendererUrl(
      prefs?.localProfileImageUrl ?? null
    );
    result.backgroundImageUrl = toRendererUrl(
      prefs?.localBackgroundImageUrl ?? null
    );
  }

  // Fill gaps from Uploadcare by metadata — covers other users' profiles and
  // restores our own images when the local copy is gone (reinstall, cleanup)
  if (!result.backgroundImageUrl) {
    result.backgroundImageUrl = await UploadcareSync.findLatestImageByKind(
      "profile-banner",
      userId
    );
  }
  if (!result.profileImageUrl) {
    result.profileImageUrl = await UploadcareSync.findLatestImageByKind(
      "profile-avatar",
      userId
    );
  }

  lookupCache.set(userId, { value: result, at: Date.now() });
  return result;
};

registerEvent("getProfileImages", getProfileImages);
