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
import { detectInstalledEaGames, getEaLaunchUri } from "@main/services/ea";
import {
  getExcludedGames,
  isGameExcluded,
} from "@main/helpers/exclusion-list";
import { normalizeGameTitle } from "@main/helpers/normalize-game-title";

/** EA offer ids contain characters unsafe for level keys — sanitize them. */
const toObjectId = (offerId: string): string =>
  offerId.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase();

interface EaEntitlement {
  offerId?: string;
  masterTitleId?: string;
  displayProductName?: string;
  productName?: string;
  offerType?: string;
  status?: string;
}

const syncEaLibrary = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ total: number; added: number; error?: string }> => {
  try {
    const prefs = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);

    if (!prefs?.eaAccessToken) {
      throw new Error("EA account not connected");
    }

    let accessToken = prefs.eaAccessToken;

    // Access tokens only live ~1h — silently re-acquire from the persisted
    // browser session cookies instead of failing the sync.
    const expired = prefs.eaTokenExpiry
      ? Date.parse(prefs.eaTokenExpiry) < Date.now()
      : false;
    if (expired) {
      const { refreshEaTokenSilently } = await import(
        "@main/services/ea-auth"
      );
      const refreshed = await refreshEaTokenSilently();
      if (refreshed) {
        accessToken = refreshed.accessToken;
        await db.put<string, UserPreferences>(
          levelKeys.userPreferences,
          {
            ...prefs,
            eaAccessToken: refreshed.accessToken,
            eaTokenExpiry: new Date(
              Date.now() + refreshed.expiresIn * 1000
            ).toISOString(),
          },
          { valueEncoding: "json" }
        );
      }
    }

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "X-AuthToken": accessToken,
      "Content-Type": "application/json",
    };

    const res = await axios.get(
      "https://gateway.ea.com/proxy/entitlements/pids/me/entitlements?status=ACTIVE",
      { headers, timeout: 20_000 }
    );

    const raw =
      res.data?.entitlements?.entitlement ?? res.data?.entitlements ?? [];
    const entitlements: EaEntitlement[] = Array.isArray(raw) ? raw : [raw];

    // Keep only actual game entitlements
    const gameEntitlements = entitlements.filter(
      (e) =>
        e.status === "ACTIVE" &&
        e.offerId &&
        (!e.offerType ||
          ["DEFAULT", "ONLINE_SERVICE", "ONLINE_OFFLINE_SERVICE"].includes(
            e.offerType
          ))
    );

    if (gameEntitlements.length === 0) {
      return { total: 0, added: 0 };
    }

    const installedGames = await detectInstalledEaGames().catch(() => []);
    const excludedGames = await getExcludedGames();
    let added = 0;

    for (const ent of gameEntitlements) {
      const rawTitle =
        ent.displayProductName ?? ent.productName ?? ent.offerId ?? "";
      if (!rawTitle) continue;

      const objectId = toObjectId(ent.offerId!);

      if (isGameExcluded(excludedGames, "ea", objectId, rawTitle)) continue;

      const gameKey = levelKeys.game("ea", objectId);
      const existing = await gamesSublevel.get(gameKey).catch(() => null);

      // Match to a locally installed game to get the proper launch URI
      const titleNorm = normalizeGameTitle(rawTitle);
      const localMatch =
        installedGames.find(
          (g) =>
            g.offerId === ent.offerId ||
            normalizeGameTitle(g.title) === titleNorm
        ) ?? null;

      // If we have the offerId we can always construct a launch URI;
      // the EA app will handle download/launch if the game isn't installed.
      const executablePath = localMatch
        ? getEaLaunchUri(localMatch)
        : ent.offerId
          ? `origin2://game/launch?offerIds=${encodeURIComponent(ent.offerId)}&autoDownload=1`
          : null;

      if (existing && !existing.isDeleted) {
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

      const assets = await fetchBestAssets("ea", objectId, rawTitle, {});

      const game = {
        title: rawTitle,
        iconUrl: assets.iconUrl,
        libraryHeroImageUrl: assets.libraryHeroImageUrl,
        logoImageUrl: assets.logoImageUrl,
        objectId,
        shop: "ea" as const,
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
          shop: "ea" as const,
          title: rawTitle,
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
      await deduplicateTitle(rawTitle).catch(() => {});
      added++;
    }

    logger.log(
      `EA library sync: ${added} added from ${gameEntitlements.length} entitlements`
    );
    return { total: gameEntitlements.length, added };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("EA library sync failed", err);
    return { total: 0, added: 0, error: message };
  }
};

registerEvent("syncEaLibrary", syncEaLibrary);

export const syncEaLibraryInternal = () =>
  syncEaLibrary({} as Electron.IpcMainInvokeEvent);
