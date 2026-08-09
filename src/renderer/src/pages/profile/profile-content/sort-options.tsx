import { TrophyIcon, ClockIcon, HistoryIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./sort-options.scss";
import type { ProfileGameSort } from "./profile-library-data";

interface SortOptionsProps {
  sortBy: ProfileGameSort;
  onSortChange: (sortBy: ProfileGameSort) => void;
}

export function SortOptions({ sortBy, onSortChange }: SortOptionsProps) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="sort-options__container">
      <span className="sort-options__label">{t("sort_by")}</span>
      <div className="sort-options__options">
        <button
          type="button"
          className={`sort-options__option ${sortBy === "achievementCount" ? "active" : ""}`}
          onClick={() => onSortChange("achievementCount")}
          aria-pressed={sortBy === "achievementCount"}
        >
          <TrophyIcon size={16} />
          <span>{t("achievements_earned")}</span>
        </button>
        <span className="sort-options__separator">|</span>
        <button
          type="button"
          className={`sort-options__option ${sortBy === "playedRecently" ? "active" : ""}`}
          onClick={() => onSortChange("playedRecently")}
          aria-pressed={sortBy === "playedRecently"}
        >
          <HistoryIcon size={16} />
          <span>{t("played_recently")}</span>
        </button>
        <span className="sort-options__separator">|</span>
        <button
          type="button"
          className={`sort-options__option ${sortBy === "playtime" ? "active" : ""}`}
          onClick={() => onSortChange("playtime")}
          aria-pressed={sortBy === "playtime"}
        >
          <ClockIcon size={16} />
          <span>{t("playtime")}</span>
        </button>
      </div>
    </div>
  );
}
