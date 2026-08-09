import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { R2Sync } from "@main/services/r2-sync";
import { db, levelKeys } from "@main/level";
import type { User, UserPreferences, UserProfile } from "@types";
import fs from "node:fs";
import { resolveOwnedProfileImagePreference } from "@main/services/profile-image-helpers";
import { registerR2CredentialSessionInvalidator } from "@main/services/r2-credential-session";

export interface ProfileImages {
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
}

// All GameHub installs use the same private R2 bucket and resolve images inside
// the authenticated user's permitted namespace. Cache successful lookups per
// user while allowing incomplete/transient results to retry quickly.
const lookupCache = new Map<string, { value: ProfileImages; at: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const INCOMPLETE_CACHE_TTL_MS = 10 * 1000;
const lookupInFlight = new Map<string, Promise<ProfileImages>>();
let cacheGeneration = 0;

export const invalidateProfileImagesCache = (userId?: string) => {
  cacheGeneration += 1;
  if (userId) lookupCache.delete(userId);
  else {
    lookupCache.clear();
    ownIdCache = null;
  }
  if (userId) lookupInFlight.delete(userId);
  else lookupInFlight.clear();
};

// The auth layer fires this shared invalidator for sign-out, a new external
// sign-in/account switch, and expired credentials. Keep account-scoped profile
// results aligned with the R2 client's own in-flight/cache invalidation.
registerR2CredentialSessionInvalidator(() => invalidateProfileImagesCache());

let ownIdCache: string | null = null;

const getOwnId = async (): Promise<string | null> => {
  // Read the tiny local account record first on every profile lookup. This is
  // faster than the API and prevents a cached account id surviving sign-out or
  // an account switch in the same GameHub process.
  const localUser = await db
    .get<string, User>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  if (localUser?.id) {
    ownIdCache = localUser.id;
    return ownIdCache;
  }

  ownIdCache = null;
  const me = await HydraApi.get<UserProfile>("/profile/me").catch(() => null);
  ownIdCache = me?.id ?? null;
  return ownIdCache;
};

const loadProfileImages = async (userId: string): Promise<ProfileImages> => {
  const cached = lookupCache.get(userId);
  if (cached) {
    const isComplete = Boolean(
      cached.value.profileImageUrl && cached.value.backgroundImageUrl
    );
    const ttl = isComplete ? CACHE_TTL_MS : INCOMPLETE_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.value;
  }

  const existingLookup = lookupInFlight.get(userId);
  if (existingLookup) return existingLookup;

  const generation = cacheGeneration;
  const lookup = (async () => {
    const result: ProfileImages = {
      profileImageUrl: null,
      backgroundImageUrl: null,
    };
    let allowRemoteAvatar = true;
    let allowRemoteBanner = true;

    const ownId = await getOwnId();

    // Production R2 credentials are intentionally scoped to the signed-in
    // account's prefix. Other users keep using the canonical URLs returned by
    // Hydra API; attempting their private prefixes only creates slow 403s.
    if (!ownId || userId !== ownId) {
      if (generation === cacheGeneration) {
        lookupCache.set(userId, { value: result, at: Date.now() });
      }
      return result;
    }

    // Own profile: prefer only copies explicitly owned by this account. Legacy
    // ownerless values are migrated at session bootstrap or ignored.
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    const avatarPreference = resolveOwnedProfileImagePreference(
      prefs ?? {},
      "avatar",
      ownId,
      fs.existsSync
    );
    const bannerPreference = resolveOwnedProfileImagePreference(
      prefs ?? {},
      "banner",
      ownId,
      fs.existsSync
    );
    allowRemoteAvatar = !avatarPreference.removed;
    allowRemoteBanner = !bannerPreference.removed;
    result.profileImageUrl = avatarPreference.url;
    result.backgroundImageUrl = bannerPreference.url;

    // Fill gaps in parallel from R2. A null result is only a fallback signal;
    // the renderer keeps any valid server/local image it already has.
    const [backgroundImageUrl, profileImageUrl] = await Promise.all([
      result.backgroundImageUrl || !allowRemoteBanner
        ? Promise.resolve(result.backgroundImageUrl)
        : R2Sync.findLatestImageByKind("profile-banner", userId),
      result.profileImageUrl || !allowRemoteAvatar
        ? Promise.resolve(result.profileImageUrl)
        : R2Sync.findLatestImageByKind("profile-avatar", userId),
    ]);

    result.backgroundImageUrl = backgroundImageUrl;
    result.profileImageUrl = profileImageUrl;

    if (generation === cacheGeneration) {
      lookupCache.set(userId, { value: result, at: Date.now() });
      return result;
    }

    // An upload/delete invalidated this lookup while it was running. Never let
    // a stale local preference overwrite the freshly returned profile state.
    return { profileImageUrl: null, backgroundImageUrl: null };
  })().finally(() => {
    if (lookupInFlight.get(userId) === lookup) {
      lookupInFlight.delete(userId);
    }
  });

  lookupInFlight.set(userId, lookup);
  return lookup;
};

const getProfileImages = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string
): Promise<ProfileImages> => {
  return loadProfileImages(userId);
};

registerEvent("getProfileImages", getProfileImages);
