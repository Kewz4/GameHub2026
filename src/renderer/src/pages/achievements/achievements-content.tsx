import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import {
  AlertIcon,
  EyeClosedIcon,
  PersonIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context";
import type { ComparedAchievements } from "@types";
import { Link } from "@renderer/components";
import { ComparedAchievementList } from "./compared-achievement-list";
import { AchievementList } from "./achievement-list";
import { AchievementPanel } from "./achievement-panel";
import { ComparedAchievementPanel } from "./compared-achievement-panel";
import "./achievements-content.scss";

interface UserInfo {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  totalAchievementCount: number;
  unlockedAchievementCount: number;
}

interface AchievementsContentProps {
  otherUser: UserInfo | null;
  comparedAchievements: ComparedAchievements | null;
}

interface AchievementSummaryProps {
  user: UserInfo;
}

function AchievementSummary({ user }: AchievementSummaryProps) {
  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
    return (
      <div className="achievements-content__profile-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements-content__profile-avatar"
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  return (
    <div className="achievements-content__user-summary">
      {getProfileImage(user)}
      <div className="achievements-content__user-summary__container">
        <h1>{user.displayName}</h1>
        <div className="achievements-content__user-summary__container__stats">
          <div className="achievements-content__user-summary__container__stats__trophy-count">
            <TrophyIcon size={13} />
            <span>
              {user.unlockedAchievementCount} / {user.totalAchievementCount}
            </span>
          </div>

          <span>
            {formatDownloadProgress(
              user.unlockedAchievementCount / user.totalAchievementCount
            )}
          </span>
        </div>
        <progress
          max={1}
          value={user.unlockedAchievementCount / user.totalAchievementCount}
          className="achievements-content__user-summary__container__stats__progress-bar"
        />
      </div>
    </div>
  );
}

export function AchievementsContent({
  otherUser,
  comparedAchievements,
}: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { t } = useTranslation("achievement");
  const { gameTitle, objectId, shop, shopDetails, achievements } =
    useContext(gameDetailsContext);

  // Filter tabs — only meaningful when the set actually carries the category.
  // "Missable" comes from RetroAchievements (emulated games); "Hidden" is the
  // pre-existing per-row category. The tab row is hidden entirely when neither
  // applies (e.g. a Steam game with no missable/hidden achievements).
  const [achievementFilter, setAchievementFilter] = useState<
    "all" | "missable" | "hidden"
  >("all");

  const hasMissable = useMemo(
    () => !!achievements?.some((a) => a.missable),
    [achievements]
  );
  const hasHidden = useMemo(
    () => !!achievements?.some((a) => a.hidden),
    [achievements]
  );

  const filteredAchievements = useMemo(() => {
    if (!achievements) return achievements;
    if (achievementFilter === "missable")
      return achievements.filter((a) => a.missable);
    if (achievementFilter === "hidden")
      return achievements.filter((a) => a.hidden);
    return achievements;
  }, [achievements, achievementFilter]);

  const dispatch = useAppDispatch();

  const { userDetails } = useUserDetails();
  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
  }, [dispatch, gameTitle]);

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const heroHeight = heroRef.current?.clientHeight ?? 150;

    const scrollY = (event.target as HTMLDivElement).scrollTop;
    if (scrollY >= heroHeight && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= heroHeight && isHeaderStuck) {
      setIsHeaderStuck(false);
    }
  };

  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
    return (
      <div className="achievements-content__comparison__small-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements-content__comparison__small-avatar"
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className="achievements-content__achievements-list">
      <img
        src={shopDetails?.assets?.libraryHeroImageUrl ?? ""}
        className="achievements-content__achievements-list__image"
        alt={gameTitle}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className="achievements-content__achievements-list__section"
      >
        <div className="achievements-content__achievements-list__section__container">
          <div
            ref={heroRef}
            className="achievements-content__achievements-list__section__container__hero"
          >
            <div className="achievements-content__achievements-list__section__container__hero__content">
              <Link
                to={buildGameDetailsPath({ shop, objectId, title: gameTitle })}
              >
                <img
                  src={shopDetails?.assets?.logoImageUrl ?? ""}
                  className="achievements-content__achievements-list__section__container__hero__content__game-logo"
                  alt={gameTitle}
                />
              </Link>
            </div>
          </div>

          <div className="achievements-content__achievements-list__section__container__achievements-summary-wrapper">
            <AchievementSummary
              user={{
                ...userDetails,
                totalAchievementCount: achievements!.length,
                unlockedAchievementCount: achievements!.filter(
                  (achievement) => achievement.unlocked
                ).length,
              }}
            />

            {otherUser && <AchievementSummary user={otherUser} />}
          </div>
        </div>

        {otherUser && (
          <div
            className={`achievements-content__achievements-list__section__table-header ${isHeaderStuck ? "achievements-content__achievements-list__section__table-header--stuck" : ""}`}
          >
            <div className="achievements-content__achievements-list__section__table-header__container">
              <div></div>
              <div className="achievements-content__achievements-list__section__table-header__container__user-avatar">
                {getProfileImage({ ...userDetails })}
              </div>
              <div className="achievements-content__achievements-list__section__table-header__container__other-user-avatar">
                {getProfileImage(otherUser)}
              </div>
            </div>
          </div>
        )}

        {otherUser ? (
          <>
            <ComparedAchievementPanel
              achievements={comparedAchievements!}
              ownerAchievements={achievements!}
            />
            <ComparedAchievementList
              achievements={comparedAchievements!}
              ownerAchievements={achievements!}
            />
          </>
        ) : (
          <>
            <AchievementPanel achievements={achievements!} />
            {(hasMissable || hasHidden) && (
              <div
                className="achievements-content__filter-tabs"
                role="tablist"
                aria-label={t("filter_achievements", {
                  defaultValue: "Filter achievements",
                })}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={achievementFilter === "all"}
                  className={`achievements-content__filter-tab ${achievementFilter === "all" ? "achievements-content__filter-tab--active" : ""}`}
                  onClick={() => setAchievementFilter("all")}
                >
                  {t("filter_all", { defaultValue: "All" })} (
                  {achievements!.length})
                </button>
                {hasMissable && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={achievementFilter === "missable"}
                    className={`achievements-content__filter-tab ${achievementFilter === "missable" ? "achievements-content__filter-tab--active" : ""}`}
                    onClick={() => setAchievementFilter("missable")}
                  >
                    <AlertIcon size={12} />
                    {t("filter_missable", { defaultValue: "Missable" })} (
                    {achievements!.filter((a) => a.missable).length})
                  </button>
                )}
                {hasHidden && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={achievementFilter === "hidden"}
                    className={`achievements-content__filter-tab ${achievementFilter === "hidden" ? "achievements-content__filter-tab--active" : ""}`}
                    onClick={() => setAchievementFilter("hidden")}
                  >
                    <EyeClosedIcon size={12} />
                    {t("filter_hidden", { defaultValue: "Hidden" })} (
                    {achievements!.filter((a) => a.hidden).length})
                  </button>
                )}
              </div>
            )}
            <AchievementList achievements={filteredAchievements!} />
          </>
        )}
      </section>
    </div>
  );
}
