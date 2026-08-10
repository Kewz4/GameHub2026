import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConsoleGameMetadata,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";
import {
  buildBigPictureGameMetadata,
  getLaunchboxSystem,
} from "./game-metadata";

const ocarinaGame = {
  id: "launchbox:local-n3ds-228e2f92cd0941e4",
  objectId: "local-n3ds-228e2f92cd0941e4",
  shop: "launchbox",
  title: "The Legend of Zelda - Ocarina of Time 3D",
  platform: "Nintendo 3DS",
  playTimeInMilliseconds: 7_200_000,
  lastTimePlayed: null,
  remoteId: null,
  isDeleted: false,
  iconUrl: null,
  libraryHeroImageUrl: "hero.png",
  logoImageUrl: "logo.png",
  download: null,
} as LibraryGame;

const ocarinaDetails = {
  objectId: ocarinaGame.objectId,
  name: "The Legend of Zelda: Ocarina of Time 3D",
  platform: "n3ds",
  detailed_description: "A remastered adventure through Hyrule.",
  developers: ["Nintendo EAD", "Grezzo"],
  publishers: ["Nintendo"],
  genres: [
    { id: "1", name: "Puzzle" },
    { id: "2", name: "Adventure" },
  ],
  release_date: { coming_soon: false, date: "2011" },
  assets: null,
} as ShopDetailsWithAssets;

const consoleMetadata = {
  criticScore: 95,
  userScore: null,
  ratingCount: null,
  gameModes: ["Single player"],
  maxLocalPlayers: 1,
  languages: ["English"],
  series: null,
  boxArtUrls: [],
  ageRating: { name: "RP", system: "CERO" },
} as ConsoleGameMetadata;

test("resolves local and catalogue LaunchBox systems", () => {
  assert.equal(getLaunchboxSystem("local-n3ds-228e2f92cd0941e4"), "n3ds");
  assert.equal(getLaunchboxSystem("minerva:wiiu:legendofzelda"), "wiiu");
});

test("presents Ocarina metadata without fabricated Hydra social stats", () => {
  const result = buildBigPictureGameMetadata({
    objectId: ocarinaGame.objectId,
    shop: "launchbox",
    game: ocarinaGame,
    shopDetails: ocarinaDetails,
    consoleMetadata,
    stats: null,
    achievements: [],
  });

  assert.equal(result.title, "The Legend of Zelda: Ocarina of Time 3D");
  assert.equal(result.systemLabel, "Nintendo 3DS");
  assert.equal(result.emulatorLabel, "Azahar");
  assert.equal(result.descriptionHtml, ocarinaDetails.detailed_description);
  assert.deepEqual(result.genres, ["Puzzle", "Adventure"]);
  assert.deepEqual(result.developers, ["Nintendo EAD", "Grezzo"]);
  assert.equal(result.ageRating, "CERO RP");
  assert.equal(result.showHydraStats, false);
  assert.equal(result.showHydraCommunity, false);
  assert.equal(result.showAchievements, false);
  assert.equal(result.showPlaytime, true);
});

test("merges and deduplicates every available emulator developer credit", () => {
  const result = buildBigPictureGameMetadata({
    objectId: ocarinaGame.objectId,
    shop: "launchbox",
    game: {
      ...ocarinaGame,
      developers: [
        "Nintendo Entertainment Analysis & Development (EAD)",
        "Grezzo",
      ],
    },
    shopDetails: {
      ...ocarinaDetails,
      developers: ["Grezzo", " GREZZO "],
    },
    consoleMetadata,
    stats: null,
    achievements: [],
  });

  assert.deepEqual(result.developers, ["Grezzo", "Nintendo EAD"]);
});

test("shows real local achievement progress for supported emulator games", () => {
  const achievements = [
    { name: "first", unlocked: true },
    { name: "second", unlocked: false },
  ] as UserAchievement[];
  const result = buildBigPictureGameMetadata({
    objectId: "local-ps2-aabbccdd",
    shop: "launchbox",
    game: { ...ocarinaGame, objectId: "local-ps2-aabbccdd" },
    shopDetails: { ...ocarinaDetails, platform: "ps2" },
    consoleMetadata: null,
    stats: null,
    achievements,
  });

  assert.equal(result.showAchievements, true);
  assert.equal(result.achievementProgress, "1 / 2");
  assert.equal(result.emulatorLabel, "PCSX2");
});

test("does not render unavailable store stats as zeroes", () => {
  const missing = buildBigPictureGameMetadata({
    objectId: "123",
    shop: "steam",
    game: null,
    shopDetails: ocarinaDetails,
    consoleMetadata: null,
    stats: null,
    achievements: [],
  });
  const loaded = buildBigPictureGameMetadata({
    objectId: "123",
    shop: "steam",
    game: null,
    shopDetails: ocarinaDetails,
    consoleMetadata: null,
    stats: {
      averageScore: 0,
      downloadCount: 0,
      playerCount: 0,
      reviewCount: 0,
    },
    achievements: [],
  });

  assert.equal(missing.showHydraStats, false);
  assert.equal(loaded.showHydraStats, true);
});
