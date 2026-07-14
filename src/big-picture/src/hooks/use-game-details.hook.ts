import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type {
  GameShop,
  GameStats,
  HowLongToBeatCategory,
  LibraryGame,
  ProtonDBData,
  ShopDetailsWithAssets,
  UserAchievement,
} from "@types";
import {
  buildFavoriteToastOptions,
  buildGameToastVisualOptions,
  getSteamLanguage,
} from "../helpers";
import { useBigPictureToast } from "./use-big-picture-toast.hook";

export function useGameDetails(objectId: string, shop: GameShop) {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [shopDetails, setShopDetails] = useState<ShopDetailsWithAssets | null>(
    null
  );
  const [stats, setStats] = useState<GameStats | null>(null);
  const [game, setGame] = useState<LibraryGame | null>(null);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [howLongToBeat, setHowLongToBeat] = useState<
    HowLongToBeatCategory[] | null
  >(null);
  const [protonDBData, setProtonDBData] = useState<ProtonDBData | null>(null);
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const result = await globalThis.window.electron.getGameByObjectId(
      shop,
      objectId
    );
    setGame(result);
  }, [objectId, shop]);

  const fetchGameDetails = useCallback(async () => {
    if (!IS_DESKTOP) return;

    setIsLoading(true);

    try {
      // getUserPreferences is a fast local read; await it first so we know the
      // language before firing getGameShopDetails, then kick off every remaining
      // call in a single parallel batch. This avoids the ~1-2s stall that
      // occurred when getGameShopDetails was awaited sequentially after the
      // first batch.
      const userPreferences = await globalThis.window.electron
        .getUserPreferences()
        .catch(() => ({ language: "en" as const }));

      const language = getSteamLanguage(userPreferences?.language ?? "en");

      const [statsResult, assets, currentGame, shopDetailsResult] =
        await Promise.all([
          shop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron
                .getGameStats(objectId, shop)
                .catch(() => null),
          globalThis.window.electron
            .getGameAssets(objectId, shop)
            .catch(() => null),
          globalThis.window.electron
            .getGameByObjectId(shop, objectId)
            .catch(() => null),
          shop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron
                .getGameShopDetails(objectId, shop, language)
                .catch(() => null),
        ]);

      // Always build a usable minimal ShopDetailsWithAssets so the game page
      // can render. Priority: full shopDetails > cached assets > game record.
      const fallbackTitle = assets?.title ?? currentGame?.title ?? objectId;

      if (shopDetailsResult) {
        shopDetailsResult.assets = assets ?? shopDetailsResult.assets;
        setShopDetails(shopDetailsResult);
      } else {
        // Custom games, integration stores whose API details failed, etc.
        setShopDetails({
          objectId,
          name: fallbackTitle,
          steam_appid: 0,
          detailed_description: "",
          about_the_game: "",
          short_description: "",
          developers: [],
          publishers: [],
          genres: [],
          supported_languages: "",
          pc_requirements: { minimum: "", recommended: "" },
          mac_requirements: { minimum: "", recommended: "" },
          linux_requirements: { minimum: "", recommended: "" },
          release_date: { coming_soon: false, date: "" },
          content_descriptors: { ids: [] },
          assets: assets ?? {
            objectId,
            shop,
            title: fallbackTitle,
            iconUrl: currentGame?.iconUrl ?? null,
            libraryHeroImageUrl: currentGame?.libraryHeroImageUrl ?? null,
            libraryImageUrl: currentGame?.libraryImageUrl ?? null,
            logoImageUrl: currentGame?.logoImageUrl ?? null,
            logoPosition: currentGame?.logoPosition ?? null,
            coverImageUrl: currentGame?.coverImageUrl ?? null,
            downloadSources: [],
            updatedAt: Date.now(),
          },
        } as ShopDetailsWithAssets);
      }
      setStats(statsResult);
    } catch {
      // Last-resort fallback so the page never gets stuck on "Loading…".
      setShopDetails({
        objectId,
        name: objectId,
        steam_appid: 0,
        detailed_description: "",
        about_the_game: "",
        short_description: "",
        developers: [],
        publishers: [],
        genres: [],
        supported_languages: "",
        pc_requirements: { minimum: "", recommended: "" },
        mac_requirements: { minimum: "", recommended: "" },
        linux_requirements: { minimum: "", recommended: "" },
        release_date: { coming_soon: false, date: "" },
        content_descriptors: { ids: [] },
        assets: {
          objectId,
          shop,
          title: objectId,
          iconUrl: null,
          libraryHeroImageUrl: null,
          libraryImageUrl: null,
          logoImageUrl: null,
          logoPosition: null,
          coverImageUrl: null,
          downloadSources: [],
          updatedAt: Date.now(),
        },
      } as ShopDetailsWithAssets);
    } finally {
      setIsLoading(false);
    }
  }, [objectId, shop]);

  useEffect(() => {
    fetchGameDetails();
    updateGame();

    if (IS_DESKTOP && shop !== "custom") {
      if (shop !== "launchbox") {
        globalThis.window.electron.hydraApi
          .get<HowLongToBeatCategory[] | null>(
            `/games/${shop}/${objectId}/how-long-to-beat`,
            { needsAuth: false }
          )
          .then(setHowLongToBeat)
          .catch(() => setHowLongToBeat(null));
      }

      globalThis.window.electron.hydraApi
        .get<ProtonDBData | null>(`/games/${shop}/${objectId}/protondb`, {
          needsAuth: false,
        })
        .then(setProtonDBData)
        .catch(() => setProtonDBData(null));

      globalThis.window.electron
        .getUnlockedAchievements(objectId, shop)
        .then((result) => {
          if (result) {
            setAchievements(result);
          }
        })
        .catch(() => setAchievements([]));
    } else {
      setHowLongToBeat(null);
      setProtonDBData(null);
      setAchievements([]);
    }
  }, [fetchGameDetails, updateGame, objectId, shop]);

  // HLTB for console/emulated games — separate effect because the title
  // arrives asynchronously (from game record or shop details) and the main
  // effect above doesn't depend on those values.
  useEffect(() => {
    if (!IS_DESKTOP || shop !== "launchbox") return;
    const title = game?.title ?? shopDetails?.name ?? "";
    if (!title) return;
    setHowLongToBeat(null);
    globalThis.window.electron
      .getConsoleHowLongToBeat(title)
      .then(setHowLongToBeat)
      .catch(() => setHowLongToBeat(null));
  }, [shop, game?.title, shopDetails?.name]);

  useEffect(() => {
    if (!IS_DESKTOP || !game?.id) return;

    const gameId = game.id;
    const unsubscribe = globalThis.window.electron.onGamesRunning(
      (gamesRunning) => {
        setIsGameRunning(gamesRunning.some((g) => g.id == gameId));
      }
    );

    return () => {
      unsubscribe();
    };
  }, [game?.id]);

  const openGame = useCallback(
    async (discPath?: string, force?: boolean) => {
      if (!game) return;
      // Console/emulated games launch through the emulator, not an executable.
      if (game.shop === "launchbox") {
        await globalThis.window.electron.openClassicsGame(
          game.shop,
          game.objectId,
          discPath,
          force
        );
        return;
      }
      if (!game.executablePath) return;
      globalThis.window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath,
        game.launchOptions
      );
    },
    [game]
  );

  const closeGame = useCallback(() => {
    if (!game) return;
    globalThis.window.electron.closeGame(game.shop, game.objectId);
  }, [game]);

  const toggleFavorite = useCallback(async () => {
    if (!game) return;

    const toastSource = {
      title: shopDetails?.assets?.title ?? game.title,
      iconUrl: shopDetails?.assets?.iconUrl ?? game.iconUrl ?? null,
      coverImageUrl:
        shopDetails?.assets?.coverImageUrl ?? game.coverImageUrl ?? null,
      libraryImageUrl:
        shopDetails?.assets?.libraryImageUrl ?? game.libraryImageUrl ?? null,
      libraryHeroImageUrl:
        shopDetails?.assets?.libraryHeroImageUrl ??
        game.libraryHeroImageUrl ??
        null,
    };

    try {
      if (game.favorite) {
        await globalThis.window.electron.removeGameFromFavorites(
          shop,
          objectId
        );
      } else {
        await globalThis.window.electron.addGameToFavorites(shop, objectId);
      }

      await updateGame();
      globalThis.window.dispatchEvent(new Event("library-update"));
      const { title, ...toastOptions } = await buildFavoriteToastOptions(
        toastSource,
        game.favorite ? "removed" : "added"
      );
      showSuccessToast(title, toastOptions);
    } catch {
      const toastOptions = await buildGameToastVisualOptions(toastSource);
      showErrorToast("Failed to update favorites", {
        ...toastOptions,
        message: `${toastSource.title} couldn't be updated right now.`,
      });
    }
  }, [
    game,
    objectId,
    shop,
    shopDetails?.assets,
    showErrorToast,
    showSuccessToast,
    updateGame,
  ]);

  const refreshGameDetails = useCallback(async () => {
    await fetchGameDetails();
  }, [fetchGameDetails]);

  const iconUrl = game?.iconUrl ?? shopDetails?.assets?.iconUrl ?? null;
  const heroSrc =
    game?.libraryHeroImageUrl ??
    shopDetails?.assets?.libraryHeroImageUrl ??
    null;
  const logoSrc =
    game?.logoImageUrl ?? shopDetails?.assets?.logoImageUrl ?? null;
  const libraryImageUrl =
    game?.libraryHeroImageUrl ?? shopDetails?.assets?.libraryImageUrl ?? null;
  const coverImageUrl =
    game?.libraryHeroImageUrl ?? shopDetails?.assets?.coverImageUrl ?? null;
  const preferredAssets = {
    iconUrl,
    iconSrc: iconUrl,
    heroSrc,
    heroImageUrl: heroSrc,
    libraryHeroImageUrl: heroSrc,
    logoSrc,
    logoImageUrl: logoSrc,
    title: game?.title ?? "",
    downloadSources: shopDetails?.assets?.downloadSources ?? [],
    coverImageUrl,
    coverSrc: coverImageUrl,
    landscapeSrc: heroSrc,
    libraryImageUrl,
    logoPosition: null as string | null,
  };

  return {
    shopDetails,
    stats,
    game,
    isGameRunning,
    runningSessionDurationInMillis: 0,
    isLoading,
    howLongToBeat,
    protonDBData,
    achievements,
    preferredAssets,
    openGame,
    closeGame,
    toggleFavorite,
    updateGame,
    refreshGameDetails,
  };
}
