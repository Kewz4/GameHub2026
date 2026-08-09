import { darkenColor, ensureArray } from "@renderer/helpers";
import { mergeResolvedProfileImages } from "@shared";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { Badge, UserProfile, UserStats, UserGame } from "@types";
import { average } from "color.js";

import { createContext, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  mergeProfileGameCollections,
  type ProfileGameSort,
} from "@renderer/pages/profile/profile-content/profile-library-data";

export interface UserProfileContext {
  userProfile: UserProfile | null;
  heroBackground: string;
  /* Indicates if the current user is viewing their own profile */
  isMe: boolean;
  userStats: UserStats | null;
  getUserProfile: () => Promise<void>;
  getUserLibraryGames: (sortBy?: string, reset?: boolean) => Promise<void>;
  loadMoreLibraryGames: (sortBy?: string) => Promise<boolean>;
  setSelectedBackgroundImage: React.Dispatch<React.SetStateAction<string>>;
  backgroundImage: string;
  badges: Badge[];
  libraryGames: UserGame[];
  pinnedGames: UserGame[];
  hasMoreLibraryGames: boolean;
  isLoadingLibraryGames: boolean;
  /** Total local library count — accurate for own profile, null otherwise */
  localLibraryCount: number | null;
  /** Total unlocked achievements across ALL local games — accurate for own profile, null otherwise */
  localAchievementSum: number | null;
}

export const DEFAULT_USER_PROFILE_BACKGROUND = "#151515B3";

export const userProfileContext = createContext<UserProfileContext>({
  userProfile: null,
  heroBackground: DEFAULT_USER_PROFILE_BACKGROUND,
  isMe: false,
  userStats: null,
  getUserProfile: async () => {},
  getUserLibraryGames: async (_sortBy?: string, _reset?: boolean) => {},
  loadMoreLibraryGames: async (_sortBy?: string) => false,
  setSelectedBackgroundImage: () => {},
  backgroundImage: "",
  badges: [],
  libraryGames: [],
  pinnedGames: [],
  hasMoreLibraryGames: false,
  isLoadingLibraryGames: false,
  localLibraryCount: null,
  localAchievementSum: null,
});

const { Provider } = userProfileContext;
export const { Consumer: UserProfileContextConsumer } = userProfileContext;

export interface UserProfileContextProviderProps {
  children: React.ReactNode;
  userId: string;
}

export function UserProfileContextProvider({
  children,
  userId,
}: Readonly<UserProfileContextProviderProps>) {
  const { userDetails } = useAppSelector((state) => state.userDetails);

  const [userStats, setUserStats] = useState<UserStats | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [libraryGames, setLibraryGames] = useState<UserGame[]>([]);
  const [pinnedGames, setPinnedGames] = useState<UserGame[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [heroBackground, setHeroBackground] = useState(
    DEFAULT_USER_PROFILE_BACKGROUND
  );
  const [selectedBackgroundImage, setSelectedBackgroundImage] = useState("");
  const [libraryPage, setLibraryPage] = useState(0);
  const [hasMoreLibraryGames, setHasMoreLibraryGames] = useState(true);
  const [isLoadingLibraryGames, setIsLoadingLibraryGames] = useState(false);
  const [localLibraryCount, setLocalLibraryCount] = useState<number | null>(
    null
  );
  const [localAchievementSum, setLocalAchievementSum] = useState<number | null>(
    null
  );
  const profileRequestRef = useRef(0);
  const libraryRequestRef = useRef(0);

  const isMe = userDetails?.id === userProfile?.id;

  const getHeroBackgroundFromImageUrl = async (imageUrl: string) => {
    const output = await average(imageUrl, { amount: 1, format: "hex" });

    return `linear-gradient(135deg, ${darkenColor(output as string, 0.5)}, ${darkenColor(output as string, 0.6, 0.5)})`;
  };

  const getBackgroundImageUrl = () => {
    if (selectedBackgroundImage && isMe)
      return `local:${selectedBackgroundImage}`;
    if (userProfile?.backgroundImageUrl) return userProfile.backgroundImageUrl;

    return "";
  };

  const { t, i18n } = useTranslation("user_profile");

  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const getUserStats = useCallback(async () => {
    window.electron.hydraApi
      .get<UserStats>(`/users/${userId}/stats`)
      .then((stats) => {
        setUserStats(stats);
      });
  }, [userId]);

  // Local games (including custom, Steam, GOG, Epic synced) only exist locally —
  // when viewing your own profile, merge them in so they show up alongside the server-known library
  const getLocalLibraryGames = useCallback(async (): Promise<{
    library: UserGame[];
    pinned: UserGame[];
  }> => {
    try {
      const localLibrary = await window.electron.getLibrary();
      const customGames = localLibrary
        .filter((g) => !g.isDeleted)
        .map(
          (g) =>
            ({
              objectId: g.objectId,
              shop: g.shop,
              title: g.title,
              playTimeInSeconds: Math.floor(
                (g.playTimeInMilliseconds ?? 0) / 1000
              ),
              lastTimePlayed: g.lastTimePlayed ?? null,
              unlockedAchievementCount: g.unlockedAchievementCount ?? 0,
              achievementCount: g.achievementCount ?? 0,
              achievementsPointsEarnedSum: g.achievementsPointsEarnedSum ?? 0,
              hasManuallyUpdatedPlaytime: g.hasManuallyUpdatedPlaytime ?? false,
              isFavorite: g.favorite ?? false,
              isPinned: g.isPinned ?? false,
              pinnedDate: g.pinnedDate ?? null,
              iconUrl: g.iconUrl ?? null,
              libraryImageUrl: g.libraryImageUrl ?? g.iconUrl ?? "",
              libraryHeroImageUrl: g.libraryHeroImageUrl ?? "",
              logoImageUrl: g.logoImageUrl ?? "",
              coverImageUrl: g.coverImageUrl ?? g.libraryImageUrl ?? "",
            }) as unknown as UserGame
        );
      return {
        library: customGames.filter((g) => !g.isPinned),
        pinned: customGames.filter((g) => g.isPinned),
      };
    } catch {
      return { library: [], pinned: [] };
    }
  }, []);

  const getUserLibraryGames = useCallback(
    async (sortBy?: string, reset = true) => {
      const requestedSort = (sortBy ?? "playedRecently") as ProfileGameSort;
      const requestId = ++libraryRequestRef.current;
      if (reset) {
        setLibraryPage(0);
        setHasMoreLibraryGames(true);
        setIsLoadingLibraryGames(true);
      }

      try {
        const params = new URLSearchParams();
        params.append("take", "12");
        params.append("skip", "0");
        if (sortBy) {
          params.append("sortBy", sortBy);
        }

        const queryString = params.toString();
        const url = queryString
          ? `/users/${userId}/library?${queryString}`
          : `/users/${userId}/library`;

        const response = await window.electron.hydraApi.get<{
          library: UserGame[];
          pinnedGames: UserGame[];
        }>(url);

        const isOwnProfile = userDetails?.id === userId;
        const localCustom = isOwnProfile
          ? await getLocalLibraryGames()
          : { library: [], pinned: [] };

        if (isOwnProfile) {
          const allLocal = await window.electron.getLibrary().catch(() => []);
          const activeLocal = allLocal.filter((g) => !g.isDeleted);
          setLocalAchievementSum(
            activeLocal.reduce(
              (acc, g) => acc + (g.unlockedAchievementCount ?? 0),
              0
            )
          );
        }

        if (requestId !== libraryRequestRef.current) return;

        if (response) {
          const merged = mergeProfileGameCollections({
            serverLibrary: response.library,
            serverPinned: response.pinnedGames,
            localLibrary: localCustom.library,
            localPinned: localCustom.pinned,
            sortBy: requestedSort,
          });
          setLibraryGames(merged.library);
          setPinnedGames(merged.pinned);
          setHasMoreLibraryGames(response.library.length === 12);
        } else {
          const merged = mergeProfileGameCollections({
            serverLibrary: [],
            serverPinned: [],
            localLibrary: localCustom.library,
            localPinned: localCustom.pinned,
            sortBy: requestedSort,
          });
          setLibraryGames(merged.library);
          setPinnedGames(merged.pinned);
          setHasMoreLibraryGames(false);
        }
      } catch (error) {
        if (requestId !== libraryRequestRef.current) return;
        setLibraryGames([]);
        setPinnedGames([]);
        setHasMoreLibraryGames(false);
      } finally {
        if (requestId === libraryRequestRef.current) {
          setIsLoadingLibraryGames(false);
        }
      }
    },
    [userId, userDetails?.id, getLocalLibraryGames]
  );

  const loadMoreLibraryGames = useCallback(
    async (sortBy?: string): Promise<boolean> => {
      if (isLoadingLibraryGames || !hasMoreLibraryGames) {
        return false;
      }

      setIsLoadingLibraryGames(true);
      try {
        const requestId = libraryRequestRef.current;
        const nextPage = libraryPage + 1;
        const params = new URLSearchParams();
        params.append("take", "12");
        params.append("skip", String(nextPage * 12));
        if (sortBy) {
          params.append("sortBy", sortBy);
        }

        const queryString = params.toString();
        const url = queryString
          ? `/users/${userId}/library?${queryString}`
          : `/users/${userId}/library`;

        const response = await window.electron.hydraApi.get<{
          library: UserGame[];
          pinnedGames: UserGame[];
        }>(url);

        if (requestId !== libraryRequestRef.current) return false;

        if (response && response.library.length > 0) {
          const local =
            userDetails?.id === userId
              ? await getLocalLibraryGames()
              : { library: [], pinned: [] };
          const requestedSort = (sortBy ?? "playedRecently") as ProfileGameSort;
          const nextPinned = mergeProfileGameCollections({
            serverLibrary: [],
            serverPinned: [...pinnedGames, ...response.pinnedGames],
            localLibrary: [],
            localPinned: local.pinned,
            sortBy: requestedSort,
          }).pinned;

          setPinnedGames(nextPinned);
          setLibraryGames(
            (previous) =>
              mergeProfileGameCollections({
                serverLibrary: [...previous, ...response.library],
                serverPinned: nextPinned,
                localLibrary: local.library,
                localPinned: local.pinned,
                sortBy: requestedSort,
              }).library
          );
          setLibraryPage(nextPage);
          setHasMoreLibraryGames(response.library.length === 12);
          return true;
        } else {
          setHasMoreLibraryGames(false);
          return false;
        }
      } catch (error) {
        setHasMoreLibraryGames(false);
        return false;
      } finally {
        setIsLoadingLibraryGames(false);
      }
    },
    [
      userId,
      userDetails?.id,
      libraryPage,
      hasMoreLibraryGames,
      isLoadingLibraryGames,
      getLocalLibraryGames,
      pinnedGames,
    ]
  );

  const getUserProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    getUserStats();

    // Start the R2/local image lookup alongside the API request. It must never
    // block the profile itself, and null results must preserve a valid fallback.
    const profileImagesPromise = window.electron
      .getProfileImages(userId)
      .catch(() => null);

    return window.electron.hydraApi
      .get<UserProfile>(`/users/${userId}`)
      .then(async (userProfile) => {
        if (requestId !== profileRequestRef.current) return;

        // getMe is overlaid in the main process with account-owned local/R2
        // images. Reuse it instead of reading unscoped preferences here.
        if (userDetails?.id === userProfile.id) {
          userProfile = {
            ...userProfile,
            profileImageUrl: userDetails.profileImageUrl,
            backgroundImageUrl: userDetails.backgroundImageUrl,
          };
        }

        setUserProfile(userProfile);

        void profileImagesPromise.then((images) => {
          if (!images || requestId !== profileRequestRef.current) return;
          if (!images.profileImageUrl && !images.backgroundImageUrl) return;

          setUserProfile((current) => {
            return mergeResolvedProfileImages(current, userProfile.id, images);
          });
        });

        if (userProfile.profileImageUrl) {
          getHeroBackgroundFromImageUrl(userProfile.profileImageUrl).then(
            (color) => {
              if (requestId === profileRequestRef.current) {
                setHeroBackground(color);
              }
            }
          );
        }
      })
      .catch(() => {
        if (requestId !== profileRequestRef.current) return;
        showErrorToast(t("user_not_found"));
        navigate(-1);
      });
  }, [
    navigate,
    getUserStats,
    showErrorToast,
    userId,
    userDetails?.backgroundImageUrl,
    userDetails?.id,
    userDetails?.profileImageUrl,
    t,
  ]);

  const getBadges = useCallback(async () => {
    const language = i18n.language.split("-")[0];
    const params = new URLSearchParams({ locale: language });

    const badges = await window.electron.hydraApi.get<Badge[]>(
      `/badges?${params.toString()}`,
      { needsAuth: false }
    );
    setBadges(ensureArray<Badge>(badges, "/badges"));
  }, [i18n]);

  useEffect(() => {
    setUserProfile(null);
    setLibraryGames([]);
    setPinnedGames([]);
    setHeroBackground(DEFAULT_USER_PROFILE_BACKGROUND);
    setLibraryPage(0);
    setHasMoreLibraryGames(true);

    void getUserProfile();
    void getBadges();

    return () => {
      profileRequestRef.current += 1;
    };
  }, [getUserProfile, getBadges]);

  useEffect(() => {
    if (userDetails?.id === userId) {
      setLocalLibraryCount(libraryGames.length + pinnedGames.length);
    }
  }, [libraryGames.length, pinnedGames.length, userDetails?.id, userId]);

  return (
    <Provider
      value={{
        userProfile,
        heroBackground,
        isMe,
        getUserProfile,
        getUserLibraryGames,
        loadMoreLibraryGames,
        setSelectedBackgroundImage,
        backgroundImage: getBackgroundImageUrl(),
        userStats,
        badges,
        libraryGames,
        pinnedGames,
        hasMoreLibraryGames,
        isLoadingLibraryGames,
        localLibraryCount,
        localAchievementSum,
      }}
    >
      {children}
    </Provider>
  );
}
