import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { ASSETS_PATH } from "@main/constants";
import {
  getSteamGridDbArtworkOptions,
  type ArtworkAssetType,
  type ArtworkOption,
} from "@main/services/steamgriddb";
import { igdb, IGDB_PLATFORM_IDS } from "@main/services/igdb";
import { logger } from "@main/services";
import type { GameShop } from "@types";
import axios from "axios";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ArtworkSource = "steamgriddb" | "igdb";

const ARTWORK_DIR = path.join(ASSETS_PATH, "library-artwork");

/** The Steam app id, when this is a Steam game (SGDB can match by it directly). */
const steamAppIdOf = (shop: GameShop, objectId: string): string | null =>
  shop === "steam" ? objectId : null;

/** IGDB platform id for an emulated (launchbox) game, from its system tag. */
const igdbPlatformFor = (objectId: string): number | undefined => {
  // launchbox objectIds look like "minerva:n3ds:..." or "launchbox:ps2:...".
  const parts = objectId.split(":");
  const system = parts.find((p) => p in IGDB_PLATFORM_IDS);
  return system ? IGDB_PLATFORM_IDS[system] : undefined;
};

interface SearchGameArtworkParams {
  shop: GameShop;
  objectId: string;
  title: string;
  assetType: ArtworkAssetType;
  source: ArtworkSource;
}

const searchGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  params: SearchGameArtworkParams
): Promise<ArtworkOption[]> => {
  const { shop, objectId, title, assetType, source } = params;

  if (source === "steamgriddb") {
    return getSteamGridDbArtworkOptions(
      title,
      assetType,
      steamAppIdOf(shop, objectId)
    );
  }

  // IGDB — covers + landscape artwork only (no logos/icons).
  const options = await igdb.getArtworkOptions(
    title,
    assetType,
    igdbPlatformFor(objectId)
  );
  return options.map((o) => ({
    url: o.url,
    thumbnailUrl: o.thumbnailUrl,
    width: null,
    height: null,
  }));
};

const CUSTOM_FIELD: Record<
  ArtworkAssetType,
  { url: keyof CustomAssetFields; path: keyof CustomAssetFields }
> = {
  icon: { url: "customIconUrl", path: "customOriginalIconPath" },
  logo: { url: "customLogoImageUrl", path: "customOriginalLogoPath" },
  hero: { url: "customHeroImageUrl", path: "customOriginalHeroPath" },
  cover: { url: "customLibraryImageUrl", path: "customOriginalLibraryPath" },
};

interface CustomAssetFields {
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customLibraryImageUrl?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalLibraryPath?: string | null;
}

interface ApplyGameArtworkParams {
  shop: GameShop;
  objectId: string;
  assetType: ArtworkAssetType;
  url: string;
}

/**
 * Download the chosen artwork into the app's library-artwork folder and set it
 * as the game's custom override for that asset type. Storing locally (rather
 * than hotlinking) keeps the pick working offline and immune to the source CDN
 * changing or removing the image later.
 */
const applyGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  params: ApplyGameArtworkParams
) => {
  const { shop, objectId, assetType, url } = params;
  const gameKey = levelKeys.game(shop, objectId);

  const existingGame = await gamesSublevel.get(gameKey);
  if (!existingGame) throw new Error("Game not found");

  await fs.promises.mkdir(ARTWORK_DIR, { recursive: true });

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: "arraybuffer",
    timeout: 30_000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const buffer = Buffer.from(response.data);

  const contentType = String(
    response.headers["content-type"] ?? "image/png"
  ).toLowerCase();
  const ext = contentType.includes("jpeg")
    ? "jpg"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
        ? "gif"
        : "png";
  const hash = crypto
    .createHash("sha1")
    .update(`${gameKey}:${assetType}:${url}`)
    .digest("hex")
    .slice(0, 16);
  const filePath = path.join(ARTWORK_DIR, `${hash}.${ext}`);
  await fs.promises.writeFile(filePath, buffer);

  const field = CUSTOM_FIELD[assetType];
  const game = existingGame as typeof existingGame & CustomAssetFields;

  // Remove the previously cached file for this asset type (if it was ours).
  const previous = game[field.url];
  if (
    previous &&
    typeof previous === "string" &&
    previous.startsWith("local:")
  ) {
    const prevPath = previous.replace("local:", "");
    if (prevPath.startsWith(ARTWORK_DIR) && prevPath !== filePath) {
      await fs.promises.unlink(prevPath).catch(() => {});
    }
  }

  const updatedGame = {
    ...existingGame,
    [field.url]: `local:${filePath}`,
    [field.path]: filePath,
  };
  await gamesSublevel.put(gameKey, updatedGame);
  logger.log(`[artwork] applied ${assetType} for ${gameKey} from ${url}`);
  return updatedGame;
};

registerEvent("searchGameArtwork", searchGameArtwork);
registerEvent("applyGameArtwork", applyGameArtwork);
