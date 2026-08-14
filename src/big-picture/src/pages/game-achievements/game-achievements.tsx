import type { GameShop, UserAchievement } from "@types";
import { TrophyIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FocusItem, ImageLightbox, VerticalFocusGroup } from "../../components";
import {
  AchievementRow,
  AvailablePointsBar,
  GAME_ACHIEVEMENTS_EMPTY_STATE_ID,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GameAchievementsHero,
  UserAchievementsSummary,
} from "../../components/pages/game-achievements";
import {
  useGameDetails,
  useHeaderTitle,
  useNavigationScreenActions,
  useUserDetails,
} from "../../hooks";
import "./styles.scss";

export default function GameAchievements() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const { shopDetails, achievements, isLoading } = useGameDetails(
    objectId!,
    shop!
  );
  const { userDetails } = useUserDetails();
  const [selectedSouvenir, setSelectedSouvenir] =
    useState<UserAchievement | null>(null);

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements]
  );

  const totalPoints = useMemo(
    () => achievements.reduce((sum, a) => sum + (a.points ?? 0), 0),
    [achievements]
  );

  const earnedPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, a) => sum + (a.unlocked ? (a.points ?? 0) : 0),
        0
      ),
    [achievements]
  );

  useHeaderTitle(shopDetails?.assets?.title);

  useNavigationScreenActions({
    press: {
      b: () => {
        navigate(-1);
      },
    },
  });

  if (isLoading || !shopDetails) {
    return (
      <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
        <div className="game-achievements-page">
          <p style={{ color: "white", padding: 24 }}>Loading...</p>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
      <div className="game-achievements-page">
        <GameAchievementsHero shopDetails={shopDetails} />

        <div className="game-achievements-page__content">
          <UserAchievementsSummary
            userDetails={userDetails}
            unlockedCount={unlockedCount}
            totalCount={achievements.length}
          />

          <section className="game-achievements-page__list-section">
            <AvailablePointsBar
              earnedPoints={earnedPoints}
              totalPoints={totalPoints}
            />

            {achievements.length === 0 ? (
              <FocusItem
                id={GAME_ACHIEVEMENTS_EMPTY_STATE_ID}
                actions={{ primary: "off" }}
                asChild
              >
                <div className="game-achievements-page__empty" role="status">
                  <TrophyIcon
                    className="game-achievements-page__empty-icon"
                    size={38}
                    aria-hidden="true"
                  />
                  <div className="game-achievements-page__empty-copy">
                    <p className="game-achievements-page__empty-title">
                      No achievements available
                    </p>
                    <p className="game-achievements-page__empty-description">
                      This game does not have achievement data to show yet.
                    </p>
                  </div>
                </div>
              </FocusItem>
            ) : (
              <VerticalFocusGroup
                regionId={GAME_ACHIEVEMENTS_LIST_REGION_ID}
                asChild
              >
                <ul className="game-achievements-page__list">
                  {achievements.map((achievement) => (
                    <AchievementRow
                      key={achievement.name}
                      achievement={achievement}
                      onOpenSouvenir={setSelectedSouvenir}
                    />
                  ))}
                </ul>
              </VerticalFocusGroup>
            )}
          </section>
        </div>

        {selectedSouvenir?.imageUrl ? (
          <ImageLightbox
            src={selectedSouvenir.imageUrl}
            alt={`${selectedSouvenir.displayName} achievement souvenir`}
            onClose={() => setSelectedSouvenir(null)}
          />
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}
