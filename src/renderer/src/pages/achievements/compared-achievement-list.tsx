import type { ComparedAchievements, UserAchievement } from "@types";
import "./achievements.scss";
import {
  CheckCircleIcon,
  EyeClosedIcon,
  LockIcon,
} from "@primer/octicons-react";
import { useDate } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { resolveComparedOwnerStat } from "./achievement-presentation";

export interface ComparedAchievementListProps {
  achievements: ComparedAchievements;
  ownerAchievements: UserAchievement[];
}

export function ComparedAchievementList({
  achievements,
  ownerAchievements,
}: ComparedAchievementListProps) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  return (
    <ul className="achievements__list">
      {achievements.achievements.map((achievement, index) => {
        const ownerStat = resolveComparedOwnerStat(
          achievement,
          ownerAchievements
        );

        return (
          <li
            key={index}
            className="achievements__item achievements__item-compared"
          >
            <div className="achievements__item-main">
              <img
                className="achievements__item-image"
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
                  {achievement.displayName}
                </h4>
                <p>{achievement.description}</p>
              </div>
            </div>

            {ownerStat?.unlocked ? (
              <div
                className="achievements__item-status achievements__item-status--unlocked"
                title={formatDateTime(ownerStat.unlockTime)}
              >
                <CheckCircleIcon />
              </div>
            ) : (
              <div className="achievements__item-status">
                <LockIcon />
              </div>
            )}

            {achievement.targetStat.unlocked ? (
              <div
                className="achievements__item-status achievements__item-status--unlocked"
                title={formatDateTime(achievement.targetStat.unlockTime!)}
              >
                <CheckCircleIcon />
              </div>
            ) : (
              <div className="achievements__item-status">
                <LockIcon />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
