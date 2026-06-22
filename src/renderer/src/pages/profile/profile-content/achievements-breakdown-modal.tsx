import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { TrophyIcon } from "@primer/octicons-react";

import { Modal } from "@renderer/components";
import type { AchievementGameStat } from "@types";
import "./achievements-breakdown-modal.scss";

interface AchievementsBreakdownModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Lists every game that has at least one unlocked achievement — including games
 * that aren't in the local library (Exophase/PSN catalogue imports) — sorted by
 * unlocked count. Clicking a row opens that game's details page (where the full
 * achievement list lives). Opened from the achievement count on the logged-in
 * user's own profile.
 */
export function AchievementsBreakdownModal({
  visible,
  onClose,
}: Readonly<AchievementsBreakdownModalProps>) {
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();
  const [games, setGames] = useState<AchievementGameStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
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
    onClose();
    navigate(`/game/${game.shop}/${game.objectId}`);
  };

  return (
    <Modal
      visible={visible}
      title={t("achievements_unlocked")}
      description={
        loading
          ? undefined
          : t("achievements_across_games", {
              defaultValue: "{{count}} unlocked across {{games}} games",
              count: totalUnlocked,
              games: sortedGames.length,
            })
      }
      onClose={onClose}
      large
    >
      <div className="achievements-breakdown">
        {loading ? (
          <p className="achievements-breakdown__empty">{t("loading", { defaultValue: "Loading…" })}</p>
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
