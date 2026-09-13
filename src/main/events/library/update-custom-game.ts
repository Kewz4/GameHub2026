import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopAssetsSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import fs from "node:fs";
import { logger } from "@main/services";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { normalizeExplicitSteamAppId } from "./custom-game-catalogue-match";

interface UpdateCustomGameParams {
  shop: GameShop;
  objectId: string;
  title: string;
  iconUrl?: string;
  logoImageUrl?: string;
  libraryHeroImageUrl?: string;
  coverImageUrl?: string;
  libraryImageUrl?: string;
  originalIconPath?: string;
  originalLogoPath?: string;
  originalHeroPath?: string;
  matchedSteamObjectId?: string | null;
}

const updateCustomGame = async (
  _event: Electron.IpcMainInvokeEvent,
  params: UpdateCustomGameParams
) => {
  const {
    shop,
    objectId,
    title,
    iconUrl,
    logoImageUrl,
    libraryHeroImageUrl,
    coverImageUrl,
    libraryImageUrl,
    originalIconPath,
    originalLogoPath,
    originalHeroPath,
    matchedSteamObjectId,
  } = params;
  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) {
    throw new Error("Game not found");
  }

  const explicitSteamObjectId =
    normalizeExplicitSteamAppId(matchedSteamObjectId);

  if (explicitSteamObjectId) {
    if (shop !== "custom") {
      throw new Error("Only custom games can be matched to Steam");
    }

    const steamKey = levelKeys.game("steam", explicitSteamObjectId);
    const [existingSteamGame, sourceAssets, existingSteamAssets] =
      await Promise.all([
        gamesSublevel.get(steamKey).catch(() => null),
        gamesShopAssetsSublevel.get(gameKey).catch(() => null),
        gamesShopAssetsSublevel.get(steamKey).catch(() => null),
      ]);

    const matchedGame = {
      ...existingGame,
      ...existingSteamGame,
      objectId: explicitSteamObjectId,
      shop: "steam" as const,
      title,
      isDeleted: false,
      isInstalledLocally: true,
      // This record still represents a manually supplied executable. Keeping
      // custom origin is what makes offline-play setup eligibility accurate.
      libraryOrigin: "custom" as const,
      executablePath:
        existingGame.executablePath ??
        existingSteamGame?.executablePath ??
        null,
      launchOptions:
        existingGame.launchOptions ?? existingSteamGame?.launchOptions ?? null,
      iconUrl: iconUrl || existingSteamGame?.iconUrl || null,
      logoImageUrl: logoImageUrl || existingSteamGame?.logoImageUrl || null,
      libraryHeroImageUrl:
        libraryHeroImageUrl || existingSteamGame?.libraryHeroImageUrl || null,
    };

    const matchedAssets = {
      ...sourceAssets,
      ...existingSteamAssets,
      updatedAt: Date.now(),
      objectId: explicitSteamObjectId,
      shop: "steam" as const,
      title,
      iconUrl:
        iconUrl ||
        existingSteamAssets?.iconUrl ||
        sourceAssets?.iconUrl ||
        null,
      logoImageUrl:
        logoImageUrl ||
        existingSteamAssets?.logoImageUrl ||
        sourceAssets?.logoImageUrl ||
        "",
      libraryHeroImageUrl:
        libraryHeroImageUrl ||
        existingSteamAssets?.libraryHeroImageUrl ||
        sourceAssets?.libraryHeroImageUrl ||
        "",
      libraryImageUrl:
        libraryImageUrl ||
        existingSteamAssets?.libraryImageUrl ||
        sourceAssets?.libraryImageUrl ||
        iconUrl ||
        "",
      coverImageUrl:
        coverImageUrl ||
        existingSteamAssets?.coverImageUrl ||
        sourceAssets?.coverImageUrl ||
        iconUrl ||
        "",
      logoPosition:
        existingSteamAssets?.logoPosition || sourceAssets?.logoPosition || null,
      downloadSources:
        existingSteamAssets?.downloadSources ||
        sourceAssets?.downloadSources ||
        [],
    };

    await Promise.all([
      gamesSublevel.put(steamKey, matchedGame),
      gamesShopAssetsSublevel.put(steamKey, matchedAssets),
      // Give the source the chosen title so deduplicateTitle can atomically
      // select the Steam-keyed canonical record and fold local achievements.
      gamesSublevel.put(gameKey, { ...existingGame, title }),
    ]);
    await deduplicateTitle(title);

    return (await gamesSublevel.get(steamKey)) ?? matchedGame;
  }

  const oldAssetPaths: string[] = [];

  const assetPairs = [
    { existing: existingGame.iconUrl, new: iconUrl },
    { existing: existingGame.logoImageUrl, new: logoImageUrl },
    { existing: existingGame.libraryHeroImageUrl, new: libraryHeroImageUrl },
  ];

  for (const { existing, new: newUrl } of assetPairs) {
    if (existing?.startsWith("local:") && (!newUrl || existing !== newUrl)) {
      oldAssetPaths.push(existing.replace("local:", ""));
    }
  }

  const updatedGame = {
    ...existingGame,
    title,
    iconUrl: iconUrl || null,
    logoImageUrl: logoImageUrl || null,
    libraryHeroImageUrl: libraryHeroImageUrl || null,
    originalIconPath: originalIconPath || existingGame.originalIconPath || null,
    originalLogoPath: originalLogoPath || existingGame.originalLogoPath || null,
    originalHeroPath: originalHeroPath || existingGame.originalHeroPath || null,
  };

  await gamesSublevel.put(gameKey, updatedGame);

  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    const updatedAssets = {
      ...existingAssets,
      title,
      iconUrl: iconUrl || null,
      libraryHeroImageUrl: libraryHeroImageUrl || "",
      libraryImageUrl: libraryImageUrl || iconUrl || "",
      logoImageUrl: logoImageUrl || "",
      coverImageUrl: coverImageUrl || iconUrl || "",
    };

    await gamesShopAssetsSublevel.put(gameKey, updatedAssets);
  }

  if (oldAssetPaths.length > 0) {
    for (const assetPath of oldAssetPaths) {
      try {
        if (fs.existsSync(assetPath)) {
          await fs.promises.unlink(assetPath);
        }
      } catch (error) {
        logger.warn(`Failed to delete old asset ${assetPath}:`, error);
      }
    }
  }

  return updatedGame;
};

registerEvent("updateCustomGame", updateCustomGame);
