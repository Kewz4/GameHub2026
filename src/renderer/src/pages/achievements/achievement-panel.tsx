import { useTranslation } from "react-i18next";
import GameHubIcon from "@renderer/assets/icons/gamehub.svg?react";
import { UserAchievement } from "@types";
import { summarizeAchievementPoints } from "./achievement-presentation";
import "./achievement-panel.scss";

export interface AchievementPanelProps {
  achievements: UserAchievement[];
}

export function AchievementPanel({ achievements }: AchievementPanelProps) {
  const { t } = useTranslation("achievement");
  const points = summarizeAchievementPoints(achievements);

  return (
    <div className="achievement-panel">
      <div className="achievement-panel__content">
        {t("earned_points")}{" "}
        <GameHubIcon className="achievement-panel__content-icon" />
        {points.hasPointData ? `${points.earned} / ${points.total}` : "—"}
      </div>
    </div>
  );
}
