import { darkenColor } from "@renderer/helpers";
import { useAppSelector, useToast } from "@renderer/hooks";
import type { Badge, UserProfile, UserStats, UserGame } from "@types";
import { average } from "color.js";

import { createContext, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

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
              unlockedAchievementCount: 0,
              achievementCount: 0,
              achievementsPointsEarnedSum: 0,
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

        if (response) {
          const serverIds = new Set(response.library.map((g) => g.objectId));
          const localUnique = localCustom.library.filter(
            (g) => !serverIds.has(g.objectId)
          );
          const serverPinnedIds = new Set(
            response.pinnedGames.map((g) => g.objectId)
          );
          const localPinnedUnique = localCustom.pinned.filter(
            (g) => !serverPinnedIds.has(g.objectId)
          );
          setLibraryGames([...localUnique, ...response.library]);
          setPinnedGames([...localPinnedUnique, ...response.pinnedGames]);
          setHasMoreLibraryGames(response.library.length === 12);
        } else {
          setLibraryGames(localCustom.library);
          setPinnedGames(localCustom.pinned);
          setHasMoreLibraryGames(false);
        }
      } catch (error) {
        setLibraryGames([]);
        setPinnedGames([]);
        setHasMoreLibraryGames(false);
      } finally {
        setIsLoadingLibraryGames(false);
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

        if (response && response.library.length > 0) {
          setLibraryGames((prev) => {
            const existingIds = new Set(prev.map((game) => game.objectId));
            const newGames = response.library.filter(
              (game) => !existingIds.has(game.objectId)
            );
            return [...prev, ...newGames];
          });
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
    [userId, libraryPage, hasMoreLibraryGames, isLoadingLibraryGames]
  );

  const getUserProfile = useCallback(async () => {
    getUserStats();
    getUserLibraryGames();

    return window.electron.hydraApi
      .get<UserProfile>(`/users/${userId}`)
      .then(async (userProfile) => {
        // HydraAPI rejects ucarecdn.com image URLs, so the user's own images
        // live in userPreferences — overlay them when viewing own profile.
        if (userDetails?.id === userProfile.id) {
          const prefs = await window.electron
            .getUserPreferences()
            .catch(() => null);
          const localBg = prefs?.localBackgroundImageUrl;
          // Normalize Windows backslashes to forward slashes so the local:
          // protocol handler receives a valid URL on all platforms.
          const localBgNorm = localBg?.replace(/\\/g, "/");
          const resolvedBg = localBg
            ? localBgNorm!.startsWith("http") || localBgNorm!.startsWith("file:")
              ? localBgNorm!
              : `local:${localBgNorm!}`
            : userProfile.backgroundImageUrl;
          userProfile = {
            ...userProfile,
            profileImageUrl:
              prefs?.localProfileImageUrl ?? userProfile.profileImageUrl,
            backgroundImageUrl: resolvedBg,
          };
        }

        setUserProfile(userProfile);

        if (userProfile.profileImageUrl) {
          getHeroBackgroundFromImageUrl(userProfile.profileImageUrl).then(
            (color) => setHeroBackground(color)
          );
        }
      })
      .catch(() => {
        showErrorToast(t("user_not_found"));
        navigate(-1);
      });
  }, [
    navigate,
    getUserStats,
    getUserLibraryGames,
    showErrorToast,
    userId,
    userDetails?.id,
    t,
  ]);

  const getBadges = useCallback(async () => {
    const language = i18n.language.split("-")[0];
    const params = new URLSearchParams({ locale: language });

    const badges = await window.electron.hydraApi.get<Badge[]>(
      `/badges?${params.toString()}`,
      { needsAuth: false }
    );
    setBadges(badges);
  }, [i18n]);

  useEffect(() => {
    setUserProfile(null);
    setLibraryGames([]);
    setPinnedGames([]);
    setHeroBackground(DEFAULT_USER_PROFILE_BACKGROUND);
    setLibraryPage(0);
    setHasMoreLibraryGames(true);

    getUserProfile();
    getBadges();
  }, [getUserProfile, getBadges]);

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
      }}
    >
      {children}
    </Provider>
  );
}
