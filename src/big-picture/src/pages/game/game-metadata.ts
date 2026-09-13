import type {
  ConsoleGameMetadata,
  EmulatorSystem,
  GameShop,
  GameStats,
  LibraryGame,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";
import { mergeMetadataCredits } from "@shared";

const SYSTEM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Wii U",
  wii: "Wii",
  gc: "GameCube",
  switch: "Nintendo Switch",
};

const EMULATOR_LABELS: Record<EmulatorSystem, string> = {
  ps1: "RALibretro",
  ps2: "PCSX2",
  ps3: "RPCS3",
  psp: "RALibretro",
  n3ds: "Azahar",
  nds: "RALibretro",
  dsi: "RALibretro",
  n64: "RALibretro",
  gb: "RALibretro",
  gbc: "RALibretro",
  gba: "RALibretro",
  wiiu: "Cemu",
  wii: "Dolphin",
  gc: "Dolphin",
  switch: "Eden",
};

const SYSTEMS = Object.keys(SYSTEM_LABELS) as EmulatorSystem[];

const nonEmpty = (value: string | null | undefined) => value?.trim() || null;

function normalizeGenres(
  genres: ShopDetailsWithAssets["genres"] | string[] | null | undefined
) {
  return (genres ?? [])
    .map((genre) => (typeof genre === "string" ? genre : genre?.name))
    .map((genre) => genre?.trim() ?? "")
    .filter(Boolean);
}

function systemFromPlatform(platform: string | null | undefined) {
  const value = platform?.trim().toLowerCase();
  if (!value) return null;

  return (
    SYSTEMS.find(
      (system) =>
        system === value || SYSTEM_LABELS[system].toLowerCase() === value
    ) ?? (value.includes("3ds") ? "n3ds" : null)
  );
}

export function getLaunchboxSystem(
  objectId: string,
  platform?: string | null
): EmulatorSystem | null {
  const encoded = objectId.startsWith("minerva:")
    ? objectId.split(":")[1]
    : objectId.match(/^local-([a-z0-9]+)-/i)?.[1];

  return systemFromPlatform(encoded) ?? systemFromPlatform(platform);
}

export interface BigPictureGameMetadataPresentation {
  isEmulatorGame: boolean;
  title: string;
  consoleMetadataTitle: string;
  descriptionHtml: string;
  system: EmulatorSystem | null;
  systemLabel: string | null;
  emulatorLabel: string | null;
  genres: string[];
  developers: string[];
  publishers: string[];
  releaseDate: string | null;
  ageRating: string | null;
  showHydraStats: boolean;
  showHydraCommunity: boolean;
  showAchievements: boolean;
  achievementProgress: string | null;
  showPlaytime: boolean;
}

export function buildBigPictureGameMetadata(input: {
  objectId: string;
  shop: GameShop;
  game: LibraryGame | null;
  shopDetails: ShopDetailsWithAssets | null;
  consoleMetadata: ConsoleGameMetadata | null;
  stats: GameStats | null;
  achievements: UserAchievement[];
}): BigPictureGameMetadataPresentation {
  const {
    objectId,
    shop,
    game,
    shopDetails,
    consoleMetadata,
    stats,
    achievements,
  } = input;
  const isEmulatorGame = shop === "launchbox";
  const title =
    nonEmpty(shopDetails?.name) ??
    nonEmpty(shopDetails?.assets?.title) ??
    nonEmpty(game?.title) ??
    objectId;
  const system = isEmulatorGame
    ? getLaunchboxSystem(
        objectId,
        shopDetails?.platform ?? game?.platform ?? null
      )
    : null;
  const platform =
    nonEmpty(shopDetails?.platform) ?? nonEmpty(game?.platform) ?? null;
  const releaseDate =
    nonEmpty(shopDetails?.release_date?.date) ??
    (game?.releaseDate
      ? String(new Date(game.releaseDate).getUTCFullYear())
      : null);
  const ageRating = consoleMetadata?.ageRating
    ? [consoleMetadata.ageRating.system, consoleMetadata.ageRating.name]
        .filter(Boolean)
        .join(" ")
    : null;
  const unlocked = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  return {
    isEmulatorGame,
    title,
    consoleMetadataTitle: title,
    descriptionHtml:
      nonEmpty(shopDetails?.detailed_description) ??
      nonEmpty(game?.description) ??
      "",
    system,
    systemLabel: system ? SYSTEM_LABELS[system] : platform,
    emulatorLabel: system ? EMULATOR_LABELS[system] : null,
    genres: normalizeGenres(
      shopDetails?.genres?.length ? shopDetails.genres : game?.genres
    ),
    developers: mergeMetadataCredits(shopDetails?.developers, game?.developers),
    publishers: mergeMetadataCredits(shopDetails?.publishers),
    releaseDate,
    ageRating,
    // Null means the Hydra endpoint did not return real store statistics. Do
    // not turn that absence into visually authoritative zeroes.
    showHydraStats: !isEmulatorGame && shop !== "custom" && stats !== null,
    showHydraCommunity: !isEmulatorGame && shop !== "custom",
    showAchievements: achievements.length > 0,
    achievementProgress:
      achievements.length > 0 ? `${unlocked} / ${achievements.length}` : null,
    showPlaytime: game !== null,
  };
}
