import assert from "node:assert/strict";
import test from "node:test";
import {
  getProfileImageCacheFileName,
  planLegacyProfileImageOwnerMigration,
  resolvePersistedProfileImageUrl,
  resolveOwnedProfileImagePreference,
  selectLatestProfileImageObject,
} from "./profile-image-helpers";

test("selects the newest exact profile image kind across extensions", () => {
  const prefix = "users/me/images/";
  const selected = selectLatestProfileImageObject(
    [
      {
        Key: `${prefix}profile-banner.png`,
        LastModified: new Date("2026-01-01T00:00:00Z"),
      },
      {
        Key: `${prefix}profile-banner.webp`,
        LastModified: new Date("2026-02-01T00:00:00Z"),
      },
      {
        Key: `${prefix}profile-banner-thumbnail.webp`,
        LastModified: new Date("2026-03-01T00:00:00Z"),
      },
      {
        Key: `${prefix}profile-avatar.webp`,
        LastModified: new Date("2026-04-01T00:00:00Z"),
      },
      {
        Key: `${prefix}profile-banner.webp.partial`,
        LastModified: new Date("2026-05-01T00:00:00Z"),
      },
    ],
    prefix,
    "profile-banner"
  );

  assert.equal(selected?.Key, `${prefix}profile-banner.webp`);
});

test("creates a versioned traversal-safe image cache filename", () => {
  const name = getProfileImageCacheFileName(
    "../user/id",
    "profile-banner",
    { ETag: '"abc/123"' },
    "webp"
  );

  assert.equal(name, "user-id-profile-banner-abc-123.webp");
  assert.equal(name.includes(".."), false);
  assert.equal(name.includes("/"), false);
});

test("normalizes local preferences once and rejects missing files", () => {
  const exists = (filePath: string) => filePath === "C:/GameHub/banner.webp";

  assert.equal(
    resolvePersistedProfileImageUrl("local:C:/GameHub/banner.webp", exists),
    "local:C:/GameHub/banner.webp"
  );
  assert.equal(
    resolvePersistedProfileImageUrl("C:\\GameHub\\banner.webp", exists),
    "local:C:/GameHub/banner.webp"
  );
  assert.equal(
    resolvePersistedProfileImageUrl("C:/GameHub/missing.webp", exists),
    null
  );
  assert.equal(
    resolvePersistedProfileImageUrl(
      "https://images.example/banner.webp",
      exists
    ),
    "https://images.example/banner.webp"
  );
});

test("account B never receives account A's local images or tombstones", () => {
  const preferences = {
    localProfileImageUrl: "C:/GameHub/accounts/a/avatar.webp",
    localProfileImageUserId: "account-a",
    profileAvatarRemoved: false,
    localBackgroundImageUrl: null,
    localBackgroundImageUserId: "account-a",
    profileBannerRemoved: true,
  };

  assert.deepEqual(
    resolveOwnedProfileImagePreference(
      preferences,
      "avatar",
      "account-b",
      () => true
    ),
    { isOwned: false, removed: false, url: null }
  );
  assert.deepEqual(
    resolveOwnedProfileImagePreference(
      preferences,
      "banner",
      "account-b",
      () => true
    ),
    { isOwned: false, removed: false, url: null }
  );
});

test("unknown unowned legacy profile state remains quarantined", () => {
  const preferences = {
    // This path belonged to A, but an old launcher already switched its global
    // cloud-save account marker to B. The marker is not ownership evidence.
    cloudSyncAccountUserId: "account-b",
    localBackgroundImageUrl: "C:/GameHub/profile-assets/account-a-banner.webp",
    profileAvatarRemoved: true,
  };

  const firstMigration = planLegacyProfileImageOwnerMigration(preferences);
  assert.deepEqual(firstMigration, {
    profileImageOwnershipMigrationVersion: 1,
  });
  assert.deepEqual(
    planLegacyProfileImageOwnerMigration({
      ...preferences,
      ...firstMigration,
      cloudSyncAccountUserId: "account-b",
    }),
    {}
  );
  assert.deepEqual(
    resolveOwnedProfileImagePreference(
      preferences,
      "banner",
      "account-b",
      () => true
    ),
    { isOwned: false, removed: false, url: null }
  );
});

test("known legacy account ownership migrates paths and tombstones", () => {
  const preferences = {
    cloudSyncAccountUserId: "account-b",
    localProfileImageUrl: "users/account-a/images/profile-avatar.webp",
    localBackgroundImageUrl: "users/account-a/images/profile-banner.webp",
    profileBannerRemoved: true,
  };
  const migration = planLegacyProfileImageOwnerMigration(preferences);

  assert.deepEqual(migration, {
    profileImageOwnershipMigrationVersion: 1,
    localProfileImageUserId: "account-a",
    localBackgroundImageUserId: "account-a",
  });
  assert.deepEqual(
    resolveOwnedProfileImagePreference(
      { ...preferences, ...migration },
      "avatar",
      "account-a",
      () => false
    ),
    {
      isOwned: true,
      removed: false,
      url: null,
    }
  );
  assert.deepEqual(
    resolveOwnedProfileImagePreference(
      { ...preferences, ...migration },
      "banner",
      "account-a",
      () => true
    ),
    { isOwned: true, removed: true, url: null }
  );
});

test("avatar and banner ownership stay independent", () => {
  const preferences = {
    localProfileImageUrl: "C:/GameHub/accounts/a/avatar.webp",
    localProfileImageUserId: "account-a",
    localBackgroundImageUrl: "C:/GameHub/accounts/b/banner.webp",
    localBackgroundImageUserId: "account-b",
  };

  assert.equal(
    resolveOwnedProfileImagePreference(
      preferences,
      "avatar",
      "account-a",
      () => true
    ).url,
    "local:C:/GameHub/accounts/a/avatar.webp"
  );
  assert.equal(
    resolveOwnedProfileImagePreference(
      preferences,
      "banner",
      "account-a",
      () => true
    ).url,
    null
  );
  assert.equal(
    resolveOwnedProfileImagePreference(
      preferences,
      "banner",
      "account-b",
      () => true
    ).url,
    "local:C:/GameHub/accounts/b/banner.webp"
  );
});

test("a raw legacy R2 object key carries strong owner provenance", () => {
  assert.deepEqual(
    planLegacyProfileImageOwnerMigration({
      localProfileImageUrl:
        "users/account%2Fwith%2Fslashes/images/profile-avatar.webp",
    }),
    {
      profileImageOwnershipMigrationVersion: 1,
      localProfileImageUserId: "account/with/slashes",
    }
  );
  assert.deepEqual(
    planLegacyProfileImageOwnerMigration({
      localProfileImageUrl: "C:/Users/account-b/images/profile-avatar.webp",
    }),
    { profileImageOwnershipMigrationVersion: 1 }
  );
  assert.deepEqual(
    planLegacyProfileImageOwnerMigration({
      localProfileImageUrl:
        "https://images.invalid/users/account-b/images/profile-avatar.webp",
    }),
    { profileImageOwnershipMigrationVersion: 1 }
  );
});
