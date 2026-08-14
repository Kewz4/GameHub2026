import { useDate } from "@renderer/hooks";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import { AlertIcon, EyeClosedIcon } from "@primer/octicons-react";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import { FullscreenMediaModal } from "@renderer/components";
import { useState } from "react";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({
  achievements,
}: Readonly<AchievementListProps>) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();
  const [selectedSouvenir, setSelectedSouvenir] =
    useState<UserAchievement | null>(null);

  return (
    <>
      <ul className="achievements__list">
        {achievements.map((achievement) => (
          <li key={achievement.name} className="achievements__item">
            <img
              className={`achievements__item-image ${!achievement.unlocked ? "achievements__item-image--locked" : ""}`}
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />

            <div className="achievements__item-content">
              <h4 className="achievements__item-title">
                {achievement.hidden && (
                  <span
                    className="achievements__item-hidden-icon"
                    title={t("hidden_achievement_tooltip")}
                  >
                    <EyeClosedIcon size={12} />
                  </span>
                )}
                {achievement.missable && (
                  <span
                    className="achievements__item-missable-icon"
                    title={t("missable_achievement_tooltip", {
                      defaultValue:
                        "Missable — can be permanently missed in a normal playthrough",
                    })}
                  >
                    <AlertIcon size={12} />
                  </span>
                )}
                {achievement.displayName}
              </h4>
              <p>{achievement.description}</p>

              {!achievement.unlocked &&
                achievement.progress &&
                achievement.progress.max > 0 && (
                  <div
                    className="achievements__item-progress"
                    title={`${achievement.progress.current} / ${achievement.progress.max}`}
                  >
                    <div className="achievements__item-progress-track">
                      <div
                        className="achievements__item-progress-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.round(
                              (achievement.progress.current /
                                achievement.progress.max) *
                                100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                    <small className="achievements__item-progress-label">
                      {achievement.progress.current} /{" "}
                      {achievement.progress.max}
                    </small>
                  </div>
                )}
            </div>

            {achievement.imageUrl && (
              <button
                type="button"
                className="achievements__item-souvenir"
                onClick={() => setSelectedSouvenir(achievement)}
                aria-label={t("view_souvenir", {
                  defaultValue: "View achievement souvenir for {{name}}",
                  name: achievement.displayName,
                })}
              >
                <img
                  src={achievement.imageUrl}
                  alt=""
                  loading="lazy"
                  draggable={false}
                />
              </button>
            )}

            <div className="achievements__item-meta">
              {achievement.points != undefined ? (
                <div
                  className="achievements__item-points"
                  title={t("achievement_earn_points", {
                    points: achievement.points,
                  })}
                >
                  <GameHubIcon className="achievements__item-points-icon" />
                  <p className="achievements__item-points-value">
                    {achievement.points}
                  </p>
                </div>
              ) : (
                <div
                  className="achievements__item-points"
                  title={t("points_not_available", {
                    defaultValue:
                      "Points are not available for this achievement",
                  })}
                >
                  <GameHubIcon className="achievements__item-points-icon" />
                  <p className="achievements__item-points-value">—</p>
                </div>
              )}
              {achievement.unlockTime != null && (
                <div
                  className="achievements__item-unlock-time"
                  title={t("unlocked_at", {
                    date: formatDateTime(achievement.unlockTime),
                  })}
                >
                  <small>{formatDateTime(achievement.unlockTime)}</small>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <FullscreenMediaModal
        visible={selectedSouvenir != null}
        onClose={() => setSelectedSouvenir(null)}
        src={selectedSouvenir?.imageUrl}
        alt={t("souvenir_alt", {
          defaultValue: "{{name}} achievement souvenir",
          name: selectedSouvenir?.displayName ?? "",
        })}
      />
    </>
  );
}
