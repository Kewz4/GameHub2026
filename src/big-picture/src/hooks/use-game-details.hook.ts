import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  isCurrentGameDetailsRequest,
  type GameDetailsRequestToken,
} from "./game-details-request";

function buildFallbackShopDetails(
  objectId: string,
  shop: GameShop,
  assets: ShopDetailsWithAssets["assets"],
  currentGame: LibraryGame | null
): ShopDetailsWithAssets {
  const fallbackTitle = assets?.title ?? currentGame?.title ?? objectId;

  return {
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
  } as ShopDetailsWithAssets;
}

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
  const [hasDetailsFetchError, setHasDetailsFetchError] = useState(false);
  const [resolvedIdentity, setResolvedIdentity] = useState<string | null>(null);
  const requestIdentity = `${shop}:${objectId}`;
  const currentIdentityRef = useRef(requestIdentity);
  const latestDetailsRequestIdRef = useRef(0);
  const latestGameRequestIdRef = useRef(0);

  // Update during render so an old promise cannot commit in the interval
  // between a route change rendering and its replacement effect starting.
  currentIdentityRef.current = requestIdentity;

  const canCommitDetailsRequest = useCallback(
    (request: GameDetailsRequestToken) =>
      isCurrentGameDetailsRequest(
        latestDetailsRequestIdRef.current,
        currentIdentityRef.current,
        request
      ),
    []
  );

  const updateGame = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const requestId = ++latestGameRequestIdRef.current;
    const identity = requestIdentity;
    const result = await globalThis.window.electron.getGameByObjectId(
      shop,
      objectId
    );

    if (
      requestId !== latestGameRequestIdRef.current ||
      currentIdentityRef.current !== identity
    ) {
      return;
    }

    setGame(result);
  }, [objectId, requestIdentity, shop]);

  const fetchGameDetails = useCallback(async () => {
    const request: GameDetailsRequestToken = {
      id: ++latestDetailsRequestIdRef.current,
      identity: requestIdentity,
    };

    if (!IS_DESKTOP) {
      if (canCommitDetailsRequest(request)) {
        setHasDetailsFetchError(true);
        setResolvedIdentity(requestIdentity);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setHasDetailsFetchError(false);

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

      const [statsResult, assetsResult, currentGameResult, detailsResult] =
        await Promise.allSettled([
          shop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron.getGameStats(objectId, shop),
          globalThis.window.electron.getGameAssets(objectId, shop),
          globalThis.window.electron.getGameByObjectId(shop, objectId),
          shop === "custom"
            ? Promise.resolve(null)
            : globalThis.window.electron.getGameShopDetails(
                objectId,
                shop,
                language
              ),
        ]);

      if (!canCommitDetailsRequest(request)) return;

      const statsValue =
        statsResult.status === "fulfilled" ? statsResult.value : null;
      const assets =
        assetsResult.status === "fulfilled" ? assetsResult.value : null;
      const currentGame =
        currentGameResult.status === "fulfilled"
          ? currentGameResult.value
          : null;
      const details =
        detailsResult.status === "fulfilled" ? detailsResult.value : null;
      const detailsFailed =
        shop !== "custom" &&
        (detailsResult.status === "rejected" || details === null);
      const fallbackAvailable =
        shop === "custom" || currentGame !== null || assets !== null;
      const nextShopDetails = details
        ? { ...details, assets: assets ?? details.assets }
        : fallbackAvailable
          ? buildFallbackShopDetails(objectId, shop, assets, currentGame)
          : null;

      setShopDetails(nextShopDetails);
      setStats(statsValue);
      setGame(currentGame);
      setHasDetailsFetchError(detailsFailed);
    } catch {
      if (!canCommitDetailsRequest(request)) return;

      setShopDetails(null);
      setStats(null);
      setGame(null);
      setHasDetailsFetchError(true);
    } finally {
      if (canCommitDetailsRequest(request)) {
        setResolvedIdentity(requestIdentity);
        setIsLoading(false);
      }
    }
  }, [canCommitDetailsRequest, objectId, requestIdentity, shop]);

  useEffect(() => {
    void fetchGameDetails();

    return () => {
      latestDetailsRequestIdRef.current += 1;
      latestGameRequestIdRef.current += 1;
    };
  }, [fetchGameDetails]);

  useEffect(() => {
    let active = true;
    setHowLongToBeat(null);
    setProtonDBData(null);
    setAchievements([]);

    if (!IS_DESKTOP || shop === "custom") {
      return () => {
        active = false;
      };
    }

    if (shop !== "launchbox") {
      globalThis.window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${shop}/${objectId}/how-long-to-beat`,
          { needsAuth: false }
        )
        .then((result) => {
          if (active) setHowLongToBeat(result);
        })
        .catch(() => {
          if (active) setHowLongToBeat(null);
        });
    }

    globalThis.window.electron.hydraApi
      .get<ProtonDBData | null>(`/games/${shop}/${objectId}/protondb`, {
        needsAuth: false,
      })
      .then((result) => {
        if (active) setProtonDBData(result);
      })
      .catch(() => {
        if (active) setProtonDBData(null);
      });

    globalThis.window.electron
      .getUnlockedAchievements(objectId, shop)
      .then((result) => {
        if (active) setAchievements(result ?? []);
      })
      .catch(() => {
        if (active) setAchievements([]);
      });

    return () => {
      active = false;
    };
  }, [objectId, shop]);

  // HLTB for console/emulated games — separate effect because the title
  // arrives asynchronously (from game record or shop details) and the main
  // effect above doesn't depend on those values.
  useEffect(() => {
    if (!IS_DESKTOP || shop !== "launchbox") return;
    const title = game?.title ?? shopDetails?.name ?? "";
    if (!title) return;
    let active = true;
    setHowLongToBeat(null);
    globalThis.window.electron
      .getConsoleHowLongToBeat(title)
      .then((result) => {
        if (active) setHowLongToBeat(result);
      })
      .catch(() => {
        if (active) setHowLongToBeat(null);
      });

    return () => {
      active = false;
    };
  }, [objectId, shop, game?.title, shopDetails?.name]);

  useEffect(() => {
    setIsGameRunning(false);
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

  const hasResolvedCurrentIdentity = resolvedIdentity === requestIdentity;
  const currentGame = hasResolvedCurrentIdentity ? game : null;
  const currentShopDetails = hasResolvedCurrentIdentity ? shopDetails : null;
  const iconUrl =
    currentGame?.iconUrl ?? currentShopDetails?.assets?.iconUrl ?? null;
  const heroSrc =
    currentGame?.libraryHeroImageUrl ??
    currentShopDetails?.assets?.libraryHeroImageUrl ??
    null;
  const logoSrc =
    currentGame?.logoImageUrl ??
    currentShopDetails?.assets?.logoImageUrl ??
    null;
  const libraryImageUrl =
    currentGame?.libraryHeroImageUrl ??
    currentShopDetails?.assets?.libraryImageUrl ??
    null;
  const coverImageUrl =
    currentGame?.libraryHeroImageUrl ??
    currentShopDetails?.assets?.coverImageUrl ??
    null;
  const preferredAssets = {
    iconUrl,
    iconSrc: iconUrl,
    heroSrc,
    heroImageUrl: heroSrc,
    libraryHeroImageUrl: heroSrc,
    logoSrc,
    logoImageUrl: logoSrc,
    title: currentGame?.title ?? currentShopDetails?.name ?? "",
    downloadSources: currentShopDetails?.assets?.downloadSources ?? [],
    coverImageUrl,
    coverSrc: coverImageUrl,
    landscapeSrc: heroSrc,
    libraryImageUrl,
    logoPosition: null as string | null,
  };

  return {
    shopDetails: currentShopDetails,
    stats: hasResolvedCurrentIdentity ? stats : null,
    game: currentGame,
    isGameRunning: hasResolvedCurrentIdentity ? isGameRunning : false,
    runningSessionDurationInMillis: 0,
    isLoading: isLoading || !hasResolvedCurrentIdentity,
    hasDetailsFetchError: hasResolvedCurrentIdentity && hasDetailsFetchError,
    howLongToBeat: hasResolvedCurrentIdentity ? howLongToBeat : null,
    protonDBData: hasResolvedCurrentIdentity ? protonDBData : null,
    achievements: hasResolvedCurrentIdentity ? achievements : [],
    preferredAssets,
    openGame,
    closeGame,
    toggleFavorite,
    updateGame,
    refreshGameDetails,
  };
}
