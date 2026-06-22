import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrophyIcon, ArrowLeftIcon } from "@primer/octicons-react";

import { Modal } from "@renderer/components";
import type { AchievementGameStat, UserAchievement } from "@types";
import { AchievementList } from "@renderer/pages/achievements/achievement-list";
import "./achievements-breakdown-modal.scss";

interface AchievementsBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AchievementsBreakdownModal({
  visible,
  onClose,
}: Readonly<AchievementsBreakdownModalProps>) {
  const { t } = useTranslation("user_profile");
  const [games, setGames] = useState<AchievementGameStat[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedGame, setSelectedGame] = useState<AchievementGameStat | null>(
    null
  );
  const [gameAchievements, setGameAchievements] = useState<
    UserAchievement[] | null
  >(null);
  const [loadingAchievements, setLoadingAchievements] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setSelectedGame(null);
    setGameAchievements(null);
    window.electron
      .getAchievementGames()
      .then((all) => {
        setGames(
          all.filter((game) => (game.unlockedAchievementCount ?? 0) > 0)
        );
      })
      .catch(() => setGames([]))
      .finally(() => setLoading(false));
  }, [visible]);

  useEffect(() => {
    if (!selectedGame) {
      setGameAchievements(null);
      return;
    }
    setLoadingAchievements(true);
    window.electron
      .getUnlockedAchievements(selectedGame.objectId, selectedGame.shop)
      .then((list) => setGameAchievements(list))
      .catch(() => setGameAchievements([]))
      .finally(() => setLoadingAchievements(false));
  }, [selectedGame]);

  const sortedGames = useMemo(
    () =>
      [...games].sort(
        (a, b) =>
          (b.unlockedAchievementCount ?? 0) - (a.unlockedAchievementCount ?? 0)
      ),
    [games]
  );

  const totalUnlocked = useMemo(
    () =>
      sortedGames.reduce(
        (acc, game) => acc + (game.unlockedAchievementCount ?? 0),
        0
      ),
    [sortedGames]
  );

  const handleGameClick = (game: AchievementGameStat) => {
    setSelectedGame(game);
  };

  const handleBack = () => {
    setSelectedGame(null);
    setGameAchievements(null);
  };

  const handleClose = () => {
    setSelectedGame(null);
    setGameAchievements(null);
    onClose();
  };

  const modalTitle = selectedGame
    ? selectedGame.title
    : t("achievements_unlocked");

  const modalDescription = selectedGame
    ? (() => {
        const unlocked = selectedGame.unlockedAchievementCount ?? 0;
        const total = selectedGame.achievementCount ?? 0;
        return total > 0 ? `${unlocked} / ${total}` : String(unlocked);
      })()
    : loading
      ? undefined
      : t("achievements_across_games", {
          defaultValue: "{{count}} unlocked across {{games}} games",
          count: totalUnlocked,
          games: sortedGames.length,
        });

  return (
    <Modal
      visible={visible}
      title={modalTitle}
      description={modalDescription}
      onClose={handleClose}
      large
    >
      <div className="achievements-breakdown">
        {selectedGame ? (
          <div className="achievements-breakdown__drilldown">
            <button
              type="button"
              className="achievements-breakdown__back"
              onClick={handleBack}
            >
              <ArrowLeftIcon size={14} />
              {t("back", { defaultValue: "Back" })}
            </button>
            {loadingAchievements ? (
              <p className="achievements-breakdown__empty">
                {t("loading", { defaultValue: "Loading…" })}
              </p>
            ) : !gameAchievements || gameAchievements.length === 0 ? (
              <p className="achievements-breakdown__empty">
                {t("no_achievements_yet", {
                  defaultValue: "No achievement data found.",
                })}
              </p>
            ) : (
              <AchievementList achievements={gameAchievements} />
            )}
          </div>
        ) : loading ? (
          <p className="achievements-breakdown__empty">
            {t("loading", { defaultValue: "Loading…" })}
          </p>
        ) : sortedGames.length === 0 ? (
          <p className="achievements-breakdown__empty">
            {t("no_achievements_yet", {
              defaultValue: "No unlocked achievements found in your library.",
            })}
          </p>
        ) : (
          <ul className="achievements-breakdown__list">
            {sortedGames.map((game) => {
              const unlocked = game.unlockedAchievementCount ?? 0;
              const total = game.achievementCount ?? 0;
              const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
              return (
                <li key={`${game.shop}:${game.objectId}`}>
                  <button
                    type="button"
                    className="achievements-breakdown__row"
                    onClick={() => handleGameClick(game)}
                  >
                    {game.iconUrl ? (
                      <img
                        src={game.iconUrl}
                        alt=""
                        className="achievements-breakdown__icon"
                        loading="lazy"
                      />
                    ) : (
                      <div className="achievements-breakdown__icon achievements-breakdown__icon--placeholder" />
                    )}
                    <span className="achievements-breakdown__title">
                      {game.title}
                    </span>
                    <span className="achievements-breakdown__count">
                      <TrophyIcon size={14} />
                      {unlocked}
                      {total > 0 ? `/${total}` : ""}
                      {total > 0 && (
                        <span className="achievements-breakdown__pct">
                          {pct}%
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
