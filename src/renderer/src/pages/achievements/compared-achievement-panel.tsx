import { useTranslation } from "react-i18next";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import type { ComparedAchievements, UserAchievement } from "@types";
import { summarizeAchievementPoints } from "./achievement-presentation";
import "./achievement-panel.scss";

export interface ComparedAchievementPanelProps {
  achievements: ComparedAchievements;
  ownerAchievements: UserAchievement[];
}

export function ComparedAchievementPanel({
  achievements,
  ownerAchievements,
}: ComparedAchievementPanelProps) {
  const { t } = useTranslation("achievement");
  const ownerPoints = summarizeAchievementPoints(ownerAchievements);
  const availablePoints = ownerPoints.hasPointData
    ? ownerPoints.total
    : achievements.achievementsPointsTotal;

  return (
    <div className="achievement-panel achievement-panel__grid">
      <div className="achievement-panel__points-container">
        {t("available_points")}{" "}
        <GameHubIcon className="achievement-panel__content-icon" />{" "}
        {availablePoints}
      </div>
      <div className="achievement-panel__content">
        <GameHubIcon className="achievement-panel__content-icon" />
        {ownerPoints.hasPointData
          ? ownerPoints.earned
          : (achievements.owner.achievementsPointsEarnedSum ?? 0)}
      </div>
      <div className="achievement-panel__content">
        <GameHubIcon className="achievement-panel__content-icon" />
        {achievements.target.achievementsPointsEarnedSum}
      </div>
    </div>
  );
}
