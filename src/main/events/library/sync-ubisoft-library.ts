import axios from "axios";
import { registerEvent } from "../register-event";
import {
  db,
  gamesSublevel,
  gamesShopAssetsSublevel,
  levelKeys,
} from "@main/level";
import type { UserPreferences } from "@types";
import { createGame } from "@main/services/library-sync";
import { logger } from "@main/services";
import { fetchBestAssets } from "@main/helpers/fetch-best-assets";
import { deduplicateTitle } from "@main/helpers/deduplicate-title";
import { detectInstalledUbisoftGames } from "@main/services/ubisoft";
import {
  getExcludedGames,
  isGameExcluded,
} from "@main/helpers/exclusion-list";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";

const UBI_APP_ID = "f68a4c21-3006-47f3-b676-e2badf904de8";

interface UbiAssociation {
  spaceId: string;
  name?: string;
  spaceName?: string;
}

const syncUbisoftLibrary = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ total: number; added: number; error?: string }> => {
  try {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!prefs?.ubisoftTicket || !prefs?.ubisoftProfileId) {
      throw new Error("Ubisoft account not connected");
    }

    const headers = {
      Authorization: `Ubi_v1 t=${prefs.ubisoftTicket}`,
      "Ubi-AppId": UBI_APP_ID,
      "Content-Type": "application/json",
    };

    const res = await axios.get(
      `https://public-ubiservices.ubi.com/v2/profiles/${prefs.ubisoftProfileId}/clubs/associations?limit=100`,
      { headers, timeout: 20_000 }
    );

    const associations: UbiAssociation[] = res.data?.associations ?? [];
    if (associations.length === 0) {
      return { total: 0, added: 0 };
    }

    // Locally installed games for matching (have launch URIs)
    const installedGames = await detectInstalledUbisoftGames().catch(() => []);
    const excludedGames = await getExcludedGames();
    let added = 0;

    for (const assoc of associations) {
      const title = assoc.name ?? assoc.spaceName ?? "";
      if (!title) continue;

      const objectId = assoc.spaceId;

      if (isGameExcluded(excludedGames, "ubisoft", objectId, title)) continue;

      const gameKey = levelKeys.game("ubisoft", objectId);
      const existing = await gamesSublevel.get(gameKey).catch(() => null);

      // Match to a locally installed game to get the launch URI
      const titleNorm = normalizeGameTitle(title);
      const localMatch = installedGames.find(
        (g) => normalizeGameTitle(g.title) === titleNorm
      );
      const executablePath = localMatch?.launchUri ?? null;

      if (existing && !existing.isDeleted) {
        // Stamp as synced and update executablePath if client is now installed
        const updates: Partial<typeof existing> = {};
        if (existing.libraryOrigin !== "sync") updates.libraryOrigin = "sync";
        if (!existing.executablePath && executablePath) {
          updates.executablePath = executablePath;
        }
        if (Object.keys(updates).length > 0) {
          await gamesSublevel.put(gameKey, { ...existing, ...updates });
        }
        continue;
      }

      const assets = await fetchBestAssets("ubisoft", objectId, title, {});

      const game = {
        title,
        iconUrl: assets.iconUrl,
        libraryHeroImageUrl: assets.libraryHeroImageUrl,
        logoImageUrl: assets.logoImageUrl,
        objectId,
        shop: "ubisoft" as const,
        remoteId: null,
        isDeleted: false,
        playTimeInMilliseconds: 0,
        lastTimePlayed: null,
        addedToLibraryAt: new Date(),
        automaticCloudSync: true,
        libraryOrigin: "sync" as const,
        executablePath,
      };

      await gamesSublevel.put(gameKey, game);
      await gamesShopAssetsSublevel
        .put(gameKey, {
          objectId,
          shop: "ubisoft" as const,
          title,
          iconUrl: assets.iconUrl,
          coverImageUrl: assets.coverImageUrl,
          libraryImageUrl: assets.libraryImageUrl,
          libraryHeroImageUrl: assets.libraryHeroImageUrl,
          logoImageUrl: assets.logoImageUrl,
          logoPosition: assets.logoPosition,
          downloadSources: assets.downloadSources ?? [],
          updatedAt: Date.now(),
        })
        .catch(() => {});
      await createGame(game).catch(() => {});
      await deduplicateTitle(title).catch(() => {});
      added++;
    }

    logger.log(
      `Ubisoft library sync: ${added} added from ${associations.length} owned`
    );
    return { total: associations.length, added };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("Ubisoft library sync failed", err);
    return { total: 0, added: 0, error: message };
  }
};

registerEvent("syncUbisoftLibrary", syncUbisoftLibrary);

export const syncUbisoftLibraryInternal = () =>
  syncUbisoftLibrary({} as Electron.IpcMainInvokeEvent);
