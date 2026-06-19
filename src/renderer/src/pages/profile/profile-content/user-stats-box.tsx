import { useCallback, useContext, useMemo } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import { ClockIcon, TrophyIcon } from "@primer/octicons-react";
import { Award } from "lucide-react";
import "./user-stats-box.scss";

export function UserStatsBox() {
  const { userStats, isMe, userProfile, libraryGames, pinnedGames } =
    useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  const formatPlayTime = useCallback(
    (playTimeInSeconds: number) => {
      const seconds = playTimeInSeconds;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  // When the server withholds subscription-gated fields, compute them locally
  // from the library games we already fetched (available to all GameHub users).
  const allGames = useMemo(
    () => [...libraryGames, ...pinnedGames],
    [libraryGames, pinnedGames]
  );

  const localUnlockedSum = useMemo(
    () => allGames.reduce((acc, g) => acc + (g.unlockedAchievementCount ?? 0), 0),
    [allGames]
  );

  const localPointsSum = useMemo(
    () => allGames.reduce((acc, g) => acc + (g.achievementsPointsEarnedSum ?? 0), 0),
    [allGames]
  );

  if (!userStats) return null;

  const karma = isMe ? userDetails?.karma : userProfile?.karma;
  const hasKarma = karma !== undefined && karma !== null;

  // Use server value when available; fall back to local sum for own profile.
  const achievementSum =
    userStats.unlockedAchievementSum !== undefined
      ? userStats.unlockedAchievementSum
      : isMe
        ? localUnlockedSum
        : undefined;

  const pointsSum =
    userStats.achievementsPointsEarnedSum !== undefined
      ? userStats.achievementsPointsEarnedSum
      : isMe && localPointsSum > 0
        ? ({ value: localPointsSum, topPercentile: null } as any)
        : undefined;

  return (
    <div className="user-stats__box">
      <ul className="user-stats__list">
        {(isMe || achievementSum !== undefined) && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">
              {t("achievements_unlocked")}
            </h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <TrophyIcon /> {achievementSum ?? 0}{" "}
                {t("achievements")}
              </p>
            </div>
          </li>
        )}

        {(isMe || pointsSum !== undefined) && pointsSum !== undefined && (
          <li className="user-stats__list-item">
            <h3 className="user-stats__list-title">{t("earned_points")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <GameHubIcon width={20} height={20} />
                {numberFormatter.format(pointsSum.value)}
              </p>
              {pointsSum.topPercentile !== null && (
                <p title={t("ranking_updated_weekly")}>
                  {t("top_percentile", {
                    percentile: pointsSum.topPercentile,
                  })}
                </p>
              )}
            </div>
          </li>
        )}

        <li className="user-stats__list-item">
          <h3 className="user-stats__list-title">{t("total_play_time")}</h3>
          <div className="user-stats__stats-row">
            <p className="user-stats__list-description">
              <ClockIcon />
              {formatPlayTime(userStats.totalPlayTimeInSeconds.value)}
            </p>
            <p title={t("ranking_updated_weekly")}>
              {t("top_percentile", {
                percentile: userStats.totalPlayTimeInSeconds.topPercentile,
              })}
            </p>
          </div>
        </li>

        {hasKarma && karma !== undefined && karma !== null && (
          <li className="user-stats__list-item user-stats__list-item--karma">
            <h3 className="user-stats__list-title">{t("karma")}</h3>
            <div className="user-stats__stats-row">
              <p className="user-stats__list-description">
                <Award size={20} /> {numberFormatter.format(karma)}{" "}
                {t("karma_count")}
              </p>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
