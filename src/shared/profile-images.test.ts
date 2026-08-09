import assert from "node:assert/strict";
import test from "node:test";
import { mergeResolvedProfileImages } from "./profile-images";

const profile = {
  id: "current-user",
  profileImageUrl: "https://fallback.example/avatar.webp",
  backgroundImageUrl: "local:C:/GameHub/banner.webp",
};

test("empty profile-image hydration preserves valid rendered fallbacks", () => {
  const merged = mergeResolvedProfileImages(profile, profile.id, {
    profileImageUrl: null,
    backgroundImageUrl: null,
  });

  assert.strictEqual(merged, profile);
});

test("stale profile-image hydration is ignored after a route/account change", () => {
  const merged = mergeResolvedProfileImages(profile, "previous-user", {
    profileImageUrl: "local:C:/stale-avatar.webp",
    backgroundImageUrl: "local:C:/stale-banner.webp",
  });

  assert.strictEqual(merged, profile);
});

test("successful partial hydration only replaces the available image", () => {
  const merged = mergeResolvedProfileImages(profile, profile.id, {
    profileImageUrl: null,
    backgroundImageUrl: "local:C:/R2/banner-v2.webp",
  });

  assert.equal(merged?.profileImageUrl, profile.profileImageUrl);
  assert.equal(merged?.backgroundImageUrl, "local:C:/R2/banner-v2.webp");
});
