import "./styles.scss";

import {
  UsersIcon,
  TrophyIcon,
  GameControllerIcon,
} from "@phosphor-icons/react";
import type { UserGame, UserProfile, UserStats } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  GridFocusGroup,
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
  PROFILE_FRIENDS_BUTTON_ID,
  PROFILE_PAGE_ACTIONS_REGION_ID,
  PROFILE_PAGE_GAMES_REGION_ID,
  PROFILE_PAGE_REGION_ID,
  getProfileGameFocusId,
} from "./navigation";

interface ProfileStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
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

export default function Profile() {
  const navigate = useNavigate();
  const { userId: routeUserId } = useParams<{ userId: string }>();
  const { userDetails } = useUserDetails();
  const { formatNumber, formatPlayTime } = useFormat();

  const userId = routeUserId ?? userDetails?.id ?? null;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [games, setGames] = useState<UserGame[]>([]);
  const [loading, setLoading] = useState(true);

  const basePath = IS_DESKTOP ? "/big-picture" : "";

  const loadProfile = useCallback(async () => {
    if (!IS_DESKTOP || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const api = globalThis.window.electron.hydraApi;

    const [profileResult, statsResult, libraryResult] =
      await Promise.allSettled([
        api.get<UserProfile>(`/users/${userId}`),
        api.get<UserStats>(`/users/${userId}/stats`),
        api.get<{ library: UserGame[]; pinnedGames: UserGame[] }>(
          `/users/${userId}/library?take=12&skip=0&sortBy=playedRecently`
        ),
      ]);

    if (profileResult.status === "fulfilled") {
      setProfile(profileResult.value);
    }
    if (statsResult.status === "fulfilled") {
      setStats(statsResult.value);
    }
    if (libraryResult.status === "fulfilled" && libraryResult.value) {
      const { library, pinnedGames } = libraryResult.value;
      setGames([...(pinnedGames ?? []), ...(library ?? [])].slice(0, 12));
    }

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useHeaderTitle(profile?.displayName ?? userDetails?.displayName ?? "Profile");

  useNavigationScreenActions({
    press: {
      b: () => {
        navigate(-1);
      },
    },
  });

  const displayName = profile?.displayName ?? userDetails?.displayName ?? "You";
  const avatarUrl =
    profile?.profileImageUrl ?? userDetails?.profileImageUrl ?? null;

  const achievementTotal = useMemo(() => {
    if (typeof stats?.unlockedAchievementSum === "number") {
      return stats.unlockedAchievementSum;
    }
    return games.reduce((sum, g) => sum + (g.unlockedAchievementCount ?? 0), 0);
  }, [stats, games]);

  const libraryCount = stats?.libraryCount ?? games.length;
  const friendsCount = stats?.friendsCount ?? profile?.totalFriends ?? 0;
  const totalPlayTime = stats?.totalPlayTimeInSeconds?.value ?? 0;

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
        <div className="bp-profile">
          <Typography className="bp-profile__status">
            Loading your profile…
          </Typography>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={PROFILE_PAGE_REGION_ID} asChild>
      <section className="bp-profile">
        <header className="bp-profile__hero">
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
            <Typography className="bp-profile__hero__name">
              {displayName}
            </Typography>
            {profile?.bio ? (
              <Typography className="bp-profile__hero__bio">
                {profile.bio}
              </Typography>
            ) : null}

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
          <Typography className="bp-profile__section__title">
            Recent games
          </Typography>

          {games.length === 0 ? (
            <Typography className="bp-profile__status">
              No games to show yet.
            </Typography>
          ) : (
            <GridFocusGroup
              regionId={PROFILE_PAGE_GAMES_REGION_ID}
              className="bp-profile__games"
            >
              {games.map((game) => (
                <Button
                  key={`${game.shop}:${game.objectId}`}
                  focusId={getProfileGameFocusId(game.shop, game.objectId)}
                  variant="tertiary"
                  className="bp-profile__game"
                  onClick={() =>
                    navigate(`${basePath}/game/${game.shop}/${game.objectId}`)
                  }
                >
                  <span className="bp-profile__game__inner">
                    {game.libraryImageUrl || game.iconUrl ? (
                      <img
                        src={game.libraryImageUrl || game.iconUrl || ""}
                        alt={game.title}
                        className="bp-profile__game__image"
                        draggable={false}
                      />
                    ) : (
                      <span className="bp-profile__game__image bp-profile__game__image--placeholder" />
                    )}
                    <span className="bp-profile__game__title">
                      {game.title}
                    </span>
                    <span className="bp-profile__game__meta">
                      {formatPlayTime(game.playTimeInSeconds ?? 0)} ·{" "}
                      {formatNumber(game.unlockedAchievementCount ?? 0)}/
                      {formatNumber(game.achievementCount ?? 0)}
                    </span>
                  </span>
                </Button>
              ))}
            </GridFocusGroup>
          )}
        </section>
      </section>
    </VerticalFocusGroup>
  );
}
