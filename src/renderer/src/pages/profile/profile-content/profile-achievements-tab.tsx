import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftIcon,
  CheckCircleFillIcon,
  SearchIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import type { AchievementGameStat, UserAchievement } from "@types";
import { AchievementList } from "@renderer/pages/achievements/achievement-list";
import "./profile-achievements-tab.scss";

type ProgressFilter = "all" | "inProgress" | "completed";
type AchievementSort = "unlocked" | "completion" | "name";

const gameKey = (game: AchievementGameStat) => `${game.shop}:${game.objectId}`;

export function ProfileAchievementsTab() {
  const { t } = useTranslation("user_profile");
  const [games, setGames] = useState<AchievementGameStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedGame, setSelectedGame] = useState<AchievementGameStat | null>(
    null
  );
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);
  const [isLoadingAchievements, setIsLoadingAchievements] = useState(false);
  const [query, setQuery] = useState("");
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>("all");
  const [sortBy, setSortBy] = useState<AchievementSort>("unlocked");
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    window.electron
      .getAchievementGames()
      .then((result) => {
        if (!cancelled) setGames(result);
      })
      .catch(() => {
        if (!cancelled) setGames([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedGame) {
      setAchievements([]);
      return;
    }

    let cancelled = false;
    setIsLoadingAchievements(true);
    setShowHidden(false);
    window.electron
      .getUnlockedAchievements(selectedGame.objectId, selectedGame.shop)
      .then((result) => {
        if (!cancelled) setAchievements(result);
      })
      .catch(() => {
        if (!cancelled) setAchievements([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAchievements(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedGame]);

  const totals = useMemo(() => {
    const unlocked = games.reduce(
      (sum, game) => sum + (game.unlockedAchievementCount ?? 0),
      0
    );
    const available = games.reduce(
      (sum, game) => sum + (game.achievementCount ?? 0),
      0
    );
    const completed = games.filter(
      (game) =>
        (game.achievementCount ?? 0) > 0 &&
        game.unlockedAchievementCount >= game.achievementCount
    ).length;

    return { unlocked, available, completed };
  }, [games]);

  const filteredGames = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return games
      .filter((game) => {
        if (
          normalizedQuery &&
          !game.title.toLocaleLowerCase().includes(normalizedQuery)
        ) {
          return false;
        }

        const unlocked = game.unlockedAchievementCount ?? 0;
        const total = game.achievementCount ?? 0;
        if (progressFilter === "completed") {
          return total > 0 && unlocked >= total;
        }
        if (progressFilter === "inProgress") {
          return unlocked > 0 && (total === 0 || unlocked < total);
        }
        return true;
      })
      .toSorted((left, right) => {
        if (sortBy === "name") return left.title.localeCompare(right.title);
        if (sortBy === "completion") {
          const leftProgress = left.achievementCount
            ? left.unlockedAchievementCount / left.achievementCount
            : 0;
          const rightProgress = right.achievementCount
            ? right.unlockedAchievementCount / right.achievementCount
            : 0;
          return (
            rightProgress - leftProgress ||
            left.title.localeCompare(right.title)
          );
        }
        return (
          right.unlockedAchievementCount - left.unlockedAchievementCount ||
          left.title.localeCompare(right.title)
        );
      });
  }, [games, progressFilter, query, sortBy]);

  const visibleAchievements = useMemo(
    () =>
      achievements.filter(
        (achievement) =>
          showHidden || !achievement.hidden || achievement.unlocked
      ),
    [achievements, showHidden]
  );

  if (selectedGame) {
    const unlocked = selectedGame.unlockedAchievementCount ?? 0;
    const total = selectedGame.achievementCount ?? 0;
    const percentage = total > 0 ? Math.round((unlocked / total) * 100) : 0;

    return (
      <section className="profile-achievements" aria-label={selectedGame.title}>
        <header className="profile-achievements__detail-header">
          <button
            type="button"
            className="profile-achievements__back"
            onClick={() => setSelectedGame(null)}
          >
            <ArrowLeftIcon size={16} />
            {t("back", { defaultValue: "Back to achievement games" })}
          </button>
          <div className="profile-achievements__detail-title">
            {selectedGame.iconUrl ? (
              <img src={selectedGame.iconUrl} alt="" />
            ) : (
              <span className="profile-achievements__icon-placeholder">
                <TrophyIcon size={22} />
              </span>
            )}
            <div>
              <h2>{selectedGame.title}</h2>
              <p>
                {unlocked} / {total} · {percentage}%
              </p>
            </div>
          </div>
          {achievements.some((achievement) => achievement.hidden) && (
            <button
              type="button"
              className={`profile-achievements__filter ${showHidden ? "profile-achievements__filter--active" : ""}`}
              aria-pressed={showHidden}
              onClick={() => setShowHidden((current) => !current)}
            >
              {t("show_hidden_achievements", {
                defaultValue: "Show hidden",
              })}
            </button>
          )}
        </header>

        {isLoadingAchievements ? (
          <div className="profile-achievements__state">
            {t("loading", { defaultValue: "Loading achievements…" })}
          </div>
        ) : visibleAchievements.length > 0 ? (
          <AchievementList achievements={visibleAchievements} />
        ) : (
          <div className="profile-achievements__state">
            {t("no_achievements_yet", {
              defaultValue: "No achievement data found.",
            })}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="profile-achievements" aria-label={t("achievements")}>
      <div className="profile-achievements__summary">
        <div className="profile-achievements__summary-copy">
          <span className="profile-achievements__eyebrow">
            {t("achievement_collection", {
              defaultValue: "Achievement collection",
            })}
          </span>
          <h2>
            {t("your_achievements", { defaultValue: "Your achievements" })}
          </h2>
          <p>
            {t("achievements_across_games", {
              defaultValue: "{{count}} unlocked across {{games}} games",
              count: totals.unlocked,
              games: games.length,
            })}
          </p>
        </div>
        <div className="profile-achievements__summary-stats">
          <div>
            <TrophyIcon size={18} />
            <strong>{totals.unlocked.toLocaleString()}</strong>
            <span>{t("unlocked", { defaultValue: "Unlocked" })}</span>
          </div>
          <div>
            <CheckCircleFillIcon size={18} />
            <strong>{totals.completed.toLocaleString()}</strong>
            <span>{t("completed", { defaultValue: "Completed" })}</span>
          </div>
          <div>
            <strong>{totals.available.toLocaleString()}</strong>
            <span>{t("available", { defaultValue: "Available" })}</span>
          </div>
        </div>
      </div>

      <div className="profile-achievements__toolbar">
        <label className="profile-achievements__search">
          <SearchIcon size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search_achievement_games", {
              defaultValue: "Search achievement games",
            })}
          />
        </label>
        <div className="profile-achievements__filters" role="group">
          {(["all", "inProgress", "completed"] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              className={`profile-achievements__filter ${progressFilter === filter ? "profile-achievements__filter--active" : ""}`}
              aria-pressed={progressFilter === filter}
              onClick={() => setProgressFilter(filter)}
            >
              {filter === "all"
                ? t("all", { defaultValue: "All" })
                : filter === "inProgress"
                  ? t("in_progress", { defaultValue: "In progress" })
                  : t("completed", { defaultValue: "Completed" })}
            </button>
          ))}
        </div>
        <select
          className="profile-achievements__sort"
          value={sortBy}
          aria-label={t("sort_by")}
          onChange={(event) => setSortBy(event.target.value as AchievementSort)}
        >
          <option value="unlocked">
            {t("achievements_earned", { defaultValue: "Achievements earned" })}
          </option>
          <option value="completion">
            {t("completion", { defaultValue: "Completion" })}
          </option>
          <option value="name">{t("name", { defaultValue: "Name" })}</option>
        </select>
      </div>

      {isLoading ? (
        <div className="profile-achievements__state">
          {t("loading", { defaultValue: "Loading achievements…" })}
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="profile-achievements__state">
          {t("no_achievements_yet", {
            defaultValue: "No achievement games match these filters.",
          })}
        </div>
      ) : (
        <ul className="profile-achievements__games">
          {filteredGames.map((game) => {
            const unlocked = game.unlockedAchievementCount ?? 0;
            const total = game.achievementCount ?? 0;
            const percentage = total
              ? Math.min(100, Math.round((unlocked / total) * 100))
              : 0;
            return (
              <li key={gameKey(game)}>
                <button type="button" onClick={() => setSelectedGame(game)}>
                  <span className="profile-achievements__game-icon">
                    {game.iconUrl ? (
                      <img src={game.iconUrl} alt="" loading="lazy" />
                    ) : (
                      <TrophyIcon size={20} />
                    )}
                  </span>
                  <span className="profile-achievements__game-copy">
                    <strong>{game.title}</strong>
                    <span>
                      {unlocked} / {total} achievements
                    </span>
                    <span className="profile-achievements__progress">
                      <span style={{ width: `${percentage}%` }} />
                    </span>
                  </span>
                  <span className="profile-achievements__percentage">
                    {percentage}%
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
