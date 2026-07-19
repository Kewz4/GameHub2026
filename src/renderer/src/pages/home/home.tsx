import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components";
import type { Steam250Game } from "@types";

import flameIconAnimated from "@renderer/assets/icons/flame-animated.gif";
import starsIconAnimated from "@renderer/assets/icons/stars-animated.gif";
import { CalendarIcon } from "@primer/octicons-react";
import TrophyIcon from "@renderer/assets/icons/trophy.svg?react";
import GamepadIcon from "@renderer/assets/icons/gamepad.svg?react";

import { buildGameDetailsPath } from "@renderer/helpers";
import { HeroCarousel } from "./components/hero-carousel/hero-carousel";
import { CategoryRow } from "./components/category-row/category-row";
import { useHomeCatalogue } from "./use-home-catalogue";
import "./home.scss";

export default function Home() {
  const { t, i18n } = useTranslation("home");
  const navigate = useNavigate();
  const language = i18n.language.split("-")[0];

  const { catalogue, isLoading } = useHomeCatalogue(language);
  const [randomGame, setRandomGame] = useState<Steam250Game | null>(null);

  const getRandomGame = useCallback(() => {
    window.electron.getRandomGame().then((game) => {
      if (game) setRandomGame(game);
    });
  }, []);

  useEffect(() => {
    getRandomGame();
  }, [getRandomGame]);

  const handleRandomizerClick = () => {
    if (randomGame) {
      navigate(
        buildGameDetailsPath(
          { ...randomGame, shop: "steam" },
          { fromRandomizer: "1" }
        )
      );
    }
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="home__content">
        <HeroCarousel games={catalogue.featured} isLoading={isLoading} />

        <div className="home__toolbar">
          <Button
            onClick={handleRandomizerClick}
            theme="outline"
            disabled={!randomGame}
          >
            <div className="home__icon-wrapper">
              <img
                src={starsIconAnimated}
                alt=""
                className="home__stars-icon"
              />
            </div>
            {t("surprise_me")}
          </Button>
        </div>

        <div className="home__rows">
          <CategoryRow
            title={t("recommended", { defaultValue: "Recommended for you" })}
            icon={
              <img src={starsIconAnimated} alt="" className="home__row-flame" />
            }
            games={catalogue.recommended}
            isLoading={isLoading}
            enableFeedback
          />
          {catalogue.becauseYouPlayed.map((row) => (
            <CategoryRow
              key={`because-${row.anchorTitle}`}
              title={t("because_you_played", {
                defaultValue: "Because you played {{title}}",
                title: row.anchorTitle,
              })}
              games={row.games}
              isLoading={isLoading}
              enableFeedback
            />
          ))}
          <CategoryRow
            title={t("recommended_classics", {
              defaultValue: "Recommended classics",
            })}
            icon={<GamepadIcon className="home__row-icon" />}
            games={catalogue.recommendedClassics}
            isLoading={isLoading}
            enableFeedback
          />
          <CategoryRow
            title={t("hot")}
            icon={
              <img src={flameIconAnimated} alt="" className="home__row-flame" />
            }
            games={catalogue.hot}
            isLoading={isLoading}
          />
          <CategoryRow
            title={t("weekly")}
            icon={<CalendarIcon size={20} className="home__row-icon" />}
            games={catalogue.weekly}
            isLoading={isLoading}
          />
          <CategoryRow
            title={t("achievements")}
            icon={<TrophyIcon className="home__row-icon" />}
            games={catalogue.achievements}
            isLoading={isLoading}
          />
          <CategoryRow
            title={t("classics", { defaultValue: "Classics" })}
            icon={<GamepadIcon className="home__row-icon" />}
            games={catalogue.classics}
            isLoading={isLoading}
          />
        </div>
      </section>
    </SkeletonTheme>
  );
}
