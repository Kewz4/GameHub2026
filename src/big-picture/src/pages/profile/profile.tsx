import "./styles.scss";

import {
  UsersIcon,
  TrophyIcon,
  GameControllerIcon,
} from "@phosphor-icons/react";
import type {
  AchievementGameStat,
  UserGame,
  UserLibraryResponse,
  UserProfile,
  UserStats,
} from "@types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  GridFocusGroup,
  Tabs,
  Typography,
  VerticalFocusGroup,
} from "../../components";
import { IS_DESKTOP } from "../../constants";
import {
  useFormat,
  useHeaderTitle,
  useNavigationScreenActions,
  useUserDetails,
} from "../../hooks";
import {
  PROFILE_ACHIEVEMENTS_TAB_ID,
  PROFILE_FRIENDS_BUTTON_ID,
  PROFILE_GAMES_TAB_ID,
  PROFILE_PAGE_ACTIONS_REGION_ID,
  PROFILE_PAGE_GAMES_REGION_ID,
  PROFILE_PAGE_REGION_ID,
  PROFILE_PAGE_SORT_REGION_ID,
  PROFILE_PAGE_TABS_REGION_ID,
  PROFILE_RETRY_BUTTON_ID,
  getProfileGameFocusId,
  getProfileSortFocusId,
} from "./navigation";
import {
  type BigPictureProfileSort,
  type BigPictureProfileView,
  getProfileLibraryPageOffsets,
  mergeAchievementStatsIntoProfileGames,
  mergeUniqueProfileGames,
  profileGameHasAchievements,
  sortProfileGames,
} from "./profile-data";

const PROFILE_LIBRARY_PAGE_SIZE = 100;

interface ProfileStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
}

interface CompleteProfileLibrary {
  library: UserGame[];
  pinnedGames: UserGame[];
}

function ProfileStatCard({
  icon,
  label,
  value,
}: Readonly<ProfileStatCardProps>) {
  return (
    <div className="bp-profile__stat-card">
      <div className="bp-profile__stat-card__icon">{icon}</div>
      <div className="bp-profile__stat-card__body">
        <Typography className="bp-profile__stat-card__value">
          {value}
        </Typography>
        <Typography className="bp-profile__stat-card__label">
          {label}
        </Typography>
      </div>
    </div>
  );
}

async function getCompleteProfileLibrary(
  userId: string
): Promise<CompleteProfileLibrary> {
  const api = globalThis.window.electron.hydraApi;
  const getPage = (skip: number) =>
    api.get<UserLibraryResponse>(`/users/${userId}/library`, {
      params: {
        take: PROFILE_LIBRARY_PAGE_SIZE,
        skip,
        sortBy: "playedRecently",
      },
    });

  const firstPage = await getPage(0);
  const effectivePageSize =
    firstPage.library?.length > 0
      ? Math.min(PROFILE_LIBRARY_PAGE_SIZE, firstPage.library.length)
      : PROFILE_LIBRARY_PAGE_SIZE;
  const remainingOffsets = getProfileLibraryPageOffsets(
    firstPage.totalCount ?? firstPage.library?.length ?? 0,
    effectivePageSize
  );
  const remainingPages = await Promise.all(
    remainingOffsets.map((skip) => getPage(skip))
  );
  const pages = [firstPage, ...remainingPages];

  return {
    library: pages.flatMap((page) => page.library ?? []),
    pinnedGames: pages.flatMap((page) => page.pinnedGames ?? []),
  };
}

function privacyLabel(profile: UserProfile | null) {
  if (!profile) return null;
  if (profile.profileVisibility === "PRIVATE") return "Private profile";
  if (profile.profileVisibility === "FRIENDS") return "Friends-only profile";
  return "Public profile";
}

export default function Profile() {
  const navigate = useNavigate();
  const { userId: routeUserId } = useParams<{ userId: string }>();
  const { userDetails } = useUserDetails();
  const { formatNumber, formatPlayTime } = useFormat();

  const userId = routeUserId ?? userDetails?.id ?? null;
  const isOwnProfile = Boolean(userId && userId === userDetails?.id);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [games, setGames] = useState<UserGame[]>([]);
  const [activeView, setActiveView] = useState<BigPictureProfileView>("games");
  const [sortBy, setSortBy] = useState<BigPictureProfileSort>("playedRecently");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [failedBannerSrc, setFailedBannerSrc] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);

  const basePath = IS_DESKTOP ? "/big-picture" : "";

  const loadProfile = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;

    if (!IS_DESKTOP || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);

    const api = globalThis.window.electron.hydraApi;
    const achievementStatsRequest: Promise<AchievementGameStat[]> = isOwnProfile
      ? globalThis.window.electron.getAchievementGames()
      : Promise.resolve([]);

    const [profileResult, statsResult, libraryResult, achievementsResult] =
      await Promise.allSettled([
        api.get<UserProfile>(`/users/${userId}`),
        api.get<UserStats>(`/users/${userId}/stats`),
        getCompleteProfileLibrary(userId),
        achievementStatsRequest,
      ]);

    if (requestId !== loadRequestIdRef.current) return;

    const nextProfile =
      profileResult.status === "fulfilled" ? profileResult.value : null;
    const nextLibrary =
      libraryResult.status === "fulfilled"
        ? libraryResult.value
        : { library: [], pinnedGames: [] };
    const profileGames = [
      ...(nextProfile?.libraryGames ?? []),
      ...(nextProfile?.recentGames ?? []),
    ];
    const completeGames = mergeUniqueProfileGames(nextLibrary.pinnedGames, [
      ...nextLibrary.library,
      ...profileGames,
    ]);
    const nextGames =
      achievementsResult.status === "fulfilled"
        ? mergeAchievementStatsIntoProfileGames(
            completeGames,
            achievementsResult.value
          )
        : completeGames;

    if (nextProfile) setProfile(nextProfile);
    if (statsResult.status === "fulfilled") setStats(statsResult.value);
    setGames(nextGames);
    setLoadError(
      [profileResult, statsResult, libraryResult, achievementsResult].some(
        (result) => result.status === "rejected"
      )
    );
    setLoading(false);
  }, [isOwnProfile, userId]);

  useEffect(() => {
    setProfile(null);
    setStats(null);
    setGames([]);
    setActiveView("games");
    setSortBy("playedRecently");
    setLoading(true);
    setLoadError(false);
    setFailedBannerSrc(null);
  }, [userId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useHeaderTitle(
    profile?.displayName ??
      (isOwnProfile ? userDetails?.displayName : null) ??
      "Profile"
  );

  useNavigationScreenActions({
    press: {
      b: () => {
        navigate(-1);
      },
    },
  });

  const fallbackUserDetails = isOwnProfile ? userDetails : null;
  const displayName =
    profile?.displayName ?? fallbackUserDetails?.displayName ?? "Player";
  const avatarUrl =
    profile?.profileImageUrl ?? fallbackUserDetails?.profileImageUrl ?? null;
  const bannerUrl =
    profile?.backgroundImageUrl &&
    profile.backgroundImageUrl !== failedBannerSrc
      ? profile.backgroundImageUrl
      : null;

  const achievementTotal = useMemo(() => {
    if (typeof stats?.unlockedAchievementSum === "number") {
      return stats.unlockedAchievementSum;
    }
    return games.reduce(
      (sum, game) => sum + (game.unlockedAchievementCount ?? 0),
      0
    );
  }, [stats, games]);

  const displayedGames = useMemo(() => {
    const selectedGames =
      activeView === "achievements"
        ? games.filter(profileGameHasAchievements)
        : games;
    return sortProfileGames(selectedGames, sortBy);
  }, [activeView, games, sortBy]);

  const libraryCount = stats?.libraryCount ?? games.length;
  const friendsCount = stats?.friendsCount ?? profile?.totalFriends ?? 0;
  const totalPlayTime = stats?.totalPlayTimeInSeconds?.value ?? 0;
  const visibility = privacyLabel(profile);

  const viewTabs = useMemo(
    () => [
      {
        id: PROFILE_GAMES_TAB_ID,
        value: "games" as const,
        label: (
          <span className="bp-profile__tab-label">
            <GameControllerIcon size={18} />
            Games
          </span>
        ),
      },
      {
        id: PROFILE_ACHIEVEMENTS_TAB_ID,
        value: "achievements" as const,
        label: (
          <span className="bp-profile__tab-label">
            <TrophyIcon size={18} />
            Achievements
          </span>
        ),
      },
    ],
    []
  );

  const sortTabs = useMemo(
    () => [
      {
        id: getProfileSortFocusId("playedRecently"),
        value: "playedRecently" as const,
        label: "Recent",
      },
      {
        id: getProfileSortFocusId("playtime"),
        value: "playtime" as const,
        label: "Time played",
      },
      {
        id: getProfileSortFocusId("achievementCount"),
        value: "achievementCount" as const,
        label: "Achievements earned",
      },
      {
        id: getProfileSortFocusId("title"),
        value: "title" as const,
        label: "Title",
      },
    ],
    []
  );

  if (!IS_DESKTOP) {
    return (
      <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
        <div className="bp-profile">
          <Typography className="bp-profile__status">
            Profile is only available in the desktop app.
          </Typography>
        </div>
      </VerticalFocusGroup>
    );
  }

  if (loading && !profile) {
    return (
      <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
        <div
          className="bp-profile bp-profile--loading"
          data-profile-ready="false"
        >
          <div className="bp-profile__loading-card" role="status">
            <span className="bp-profile__loading-mark" aria-hidden="true" />
            <Typography>Loading profile…</Typography>
          </div>
        </div>
      </VerticalFocusGroup>
    );
  }

  if (loadError && !profile && games.length === 0) {
    return (
      <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
        <div className="bp-profile" data-profile-ready="error">
          <Typography className="bp-profile__status" role="alert">
            This profile could not be loaded.
          </Typography>
          <Button
            focusId={PROFILE_RETRY_BUTTON_ID}
            variant="secondary"
            loading={loading}
            onClick={() => void loadProfile()}
          >
            Retry
          </Button>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
      <section
        className="bp-profile"
        data-profile-ready="true"
        data-profile-owner={isOwnProfile ? "self" : "remote"}
        data-profile-view={activeView}
        data-profile-sort={sortBy}
      >
        {loadError ? (
          <div
            className="bp-profile__status bp-profile__status--warning"
            role="alert"
          >
            <Typography>
              Some profile details could not be refreshed. Cached results are
              still shown.
            </Typography>
            <Button
              focusId={PROFILE_RETRY_BUTTON_ID}
              variant="secondary"
              loading={loading}
              onClick={() => void loadProfile()}
            >
              Retry
            </Button>
          </div>
        ) : null}

        <header
          className="bp-profile__hero"
          data-has-banner={Boolean(bannerUrl)}
        >
          {bannerUrl ? (
            <img
              src={bannerUrl}
              alt=""
              className="bp-profile__hero__banner"
              draggable={false}
              onError={() => setFailedBannerSrc(bannerUrl)}
            />
          ) : null}
          <div className="bp-profile__hero__scrim" aria-hidden="true" />

          <div className="bp-profile__hero__content">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="bp-profile__hero__avatar"
                draggable={false}
              />
            ) : (
              <div className="bp-profile__hero__avatar bp-profile__hero__avatar--placeholder">
                {displayName.slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="bp-profile__hero__info">
              <div className="bp-profile__hero__identity">
                <Typography className="bp-profile__hero__name">
                  {displayName}
                </Typography>
                {visibility ? (
                  <span className="bp-profile__privacy">{visibility}</span>
                ) : null}
              </div>
              {profile?.bio ? (
                <Typography className="bp-profile__hero__bio">
                  {profile.bio}
                </Typography>
              ) : null}

              {isOwnProfile ? (
                <VerticalFocusGroup
                  regionId={PROFILE_PAGE_ACTIONS_REGION_ID}
                  asChild
                >
                  <div className="bp-profile__hero__actions">
                    <Button
                      focusId={PROFILE_FRIENDS_BUTTON_ID}
                      variant="secondary"
                      icon={<UsersIcon size={20} />}
                      onClick={() => navigate(`${basePath}/friends`)}
                    >
                      {formatNumber(friendsCount)} friends
                    </Button>
                  </div>
                </VerticalFocusGroup>
              ) : null}
            </div>
          </div>
        </header>

        <div className="bp-profile__stats">
          <ProfileStatCard
            icon={<GameControllerIcon size={28} />}
            label="Games"
            value={formatNumber(libraryCount)}
          />
          <ProfileStatCard
            icon={<TrophyIcon size={28} />}
            label="Achievements"
            value={formatNumber(achievementTotal)}
          />
          <ProfileStatCard
            icon={<UsersIcon size={28} />}
            label="Friends"
            value={formatNumber(friendsCount)}
          />
          <ProfileStatCard
            icon={<GameControllerIcon size={28} />}
            label="Play time"
            value={formatPlayTime(totalPlayTime)}
          />
        </div>

        <section className="bp-profile__section">
          <div className="bp-profile__section__toolbar">
            <Tabs
              items={viewTabs}
              value={activeView}
              onValueChange={setActiveView}
              regionId={PROFILE_PAGE_TABS_REGION_ID}
              ariaLabel="Profile content"
              className="bp-profile__view-tabs"
            />
            <Tabs
              items={sortTabs}
              value={sortBy}
              onValueChange={setSortBy}
              variant="segmented"
              regionId={PROFILE_PAGE_SORT_REGION_ID}
              ariaLabel="Sort profile games"
              className="bp-profile__sort-tabs"
            />
          </div>

          <div className="bp-profile__section__heading">
            <Typography className="bp-profile__section__title">
              {activeView === "achievements" ? "Achievements" : "Games"}
            </Typography>
            <Typography className="bp-profile__section__count">
              {formatNumber(displayedGames.length)} shown
            </Typography>
          </div>

          {displayedGames.length === 0 ? (
            <div className="bp-profile__empty" role="status">
              {activeView === "achievements" ? (
                <TrophyIcon size={34} aria-hidden="true" />
              ) : (
                <GameControllerIcon size={34} aria-hidden="true" />
              )}
              <div>
                <Typography className="bp-profile__empty__title">
                  {activeView === "achievements"
                    ? "No achievement progress yet"
                    : "No games to show yet"}
                </Typography>
                <Typography className="bp-profile__empty__description">
                  {activeView === "achievements"
                    ? "Games with achievement progress will appear here."
                    : "Games will appear here after they are added to this profile."}
                </Typography>
              </div>
            </div>
          ) : (
            <GridFocusGroup
              regionId={PROFILE_PAGE_GAMES_REGION_ID}
              className="bp-profile__games"
            >
              {displayedGames.map((game) => {
                const unlocked = game.unlockedAchievementCount ?? 0;
                const total = Math.max(game.achievementCount ?? 0, unlocked);
                const completion = total
                  ? Math.min(100, Math.round((unlocked / total) * 100))
                  : 0;

                return (
                  <Button
                    key={`${game.shop}:${game.objectId}`}
                    focusId={getProfileGameFocusId(game.shop, game.objectId)}
                    variant="tertiary"
                    className="bp-profile__game"
                    aria-label={`${game.title}, ${formatPlayTime(
                      game.playTimeInSeconds ?? 0
                    )}, ${formatNumber(unlocked)} of ${formatNumber(
                      total
                    )} achievements`}
                    onClick={() =>
                      navigate(
                        `${basePath}/game/${game.shop}/${game.objectId}${
                          activeView === "achievements" ? "/achievements" : ""
                        }`
                      )
                    }
                  >
                    <span className="bp-profile__game__inner">
                      {game.libraryImageUrl || game.iconUrl ? (
                        <img
                          src={game.libraryImageUrl || game.iconUrl || ""}
                          alt=""
                          className="bp-profile__game__image"
                          draggable={false}
                        />
                      ) : (
                        <span className="bp-profile__game__image bp-profile__game__image--placeholder">
                          <GameControllerIcon size={32} aria-hidden="true" />
                        </span>
                      )}
                      <span className="bp-profile__game__title">
                        {game.title}
                      </span>
                      <span className="bp-profile__game__meta">
                        {activeView === "achievements"
                          ? `${formatNumber(unlocked)}/${formatNumber(
                              total
                            )} achievements · ${formatNumber(completion)}%`
                          : `${formatPlayTime(
                              game.playTimeInSeconds ?? 0
                            )} · ${formatNumber(unlocked)}/${formatNumber(
                              total
                            )}`}
                      </span>
                      {activeView === "achievements" ? (
                        <span
                          className="bp-profile__game__progress"
                          aria-hidden="true"
                        >
                          <span
                            className="bp-profile__game__progress-fill"
                            style={{ width: `${completion}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                  </Button>
                );
              })}
            </GridFocusGroup>
          )}
        </section>
      </section>
    </VerticalFocusGroup>
  );
}
