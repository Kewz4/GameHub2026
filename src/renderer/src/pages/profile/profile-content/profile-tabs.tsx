import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import "./profile-content.scss";

export type ProfileTabType =
  | "library"
  | "achievements"
  | "souvenirs"
  | "reviews";

interface ProfileTabsProps {
  activeTab: ProfileTabType;
  reviewsTotalCount: number;
  achievementsTotalCount?: number;
  showAchievements?: boolean;
  souvenirsTotalCount?: number;
  showSouvenirs?: boolean;
  onTabChange: (tab: ProfileTabType) => void;
}

export function ProfileTabs({
  activeTab,
  reviewsTotalCount,
  achievementsTotalCount = 0,
  showAchievements = false,
  souvenirsTotalCount = 0,
  showSouvenirs = false,
  onTabChange,
}: Readonly<ProfileTabsProps>) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="profile-content__tabs">
      <div className="profile-content__tab-wrapper">
        <button
          type="button"
          className={`profile-content__tab ${activeTab === "library" ? "profile-content__tab--active" : ""}`}
          onClick={() => onTabChange("library")}
        >
          {t("library")}
        </button>
        {activeTab === "library" && (
          <motion.div
            className="profile-content__tab-underline"
            layoutId="tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
      {showAchievements && (
        <div className="profile-content__tab-wrapper">
          <button
            type="button"
            className={`profile-content__tab ${activeTab === "achievements" ? "profile-content__tab--active" : ""}`}
            onClick={() => onTabChange("achievements")}
          >
            {t("achievements")}
            {achievementsTotalCount > 0 && (
              <span className="profile-content__tab-badge">
                {achievementsTotalCount.toLocaleString()}
              </span>
            )}
          </button>
          {activeTab === "achievements" && (
            <motion.div
              className="profile-content__tab-underline"
              layoutId="tab-underline"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
        </div>
      )}
      {showSouvenirs && (
        <div className="profile-content__tab-wrapper">
          <button
            type="button"
            className={`profile-content__tab ${activeTab === "souvenirs" ? "profile-content__tab--active" : ""}`}
            onClick={() => onTabChange("souvenirs")}
          >
            {t("souvenirs")}
            {souvenirsTotalCount > 0 && (
              <span className="profile-content__tab-badge">
                {souvenirsTotalCount.toLocaleString()}
              </span>
            )}
          </button>
          {activeTab === "souvenirs" && (
            <motion.div
              className="profile-content__tab-underline"
              layoutId="tab-underline"
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
        </div>
      )}
      <div className="profile-content__tab-wrapper">
        <button
          type="button"
          className={`profile-content__tab ${activeTab === "reviews" ? "profile-content__tab--active" : ""}`}
          onClick={() => onTabChange("reviews")}
        >
          {t("user_reviews")}
          {reviewsTotalCount > 0 && (
            <span className="profile-content__tab-badge">
              {reviewsTotalCount}
            </span>
          )}
        </button>
        {activeTab === "reviews" && (
          <motion.div
            className="profile-content__tab-underline"
            layoutId="tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
    </div>
  );
}
