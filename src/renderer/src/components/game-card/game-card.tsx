import { DownloadIcon, PeopleIcon } from "@primer/octicons-react";
import type { GameStats, ShopAssets } from "@types";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import BattleNetLogo from "@renderer/assets/battlenet-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";
import RiotLogo from "@renderer/assets/riot-logo.svg?react";
import UbisoftLogo from "@renderer/assets/ubisoft-logo.svg?react";
import EaLogo from "@renderer/assets/ea-logo.svg?react";
import GameHubLogo from "@renderer/assets/gamehub-logo.svg?react";

import "./game-card.scss";

import { useTranslation } from "react-i18next";
import { Badge } from "../badge/badge";
import { StarRating } from "../star-rating/star-rating";
import { useCallback, useState } from "react";
import { useFormat, useAppSelector } from "@renderer/hooks";
import { getGameOrigin } from "@renderer/helpers/game-origin";

export interface GameCardProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  game: ShopAssets;
}

const shopIcon: Record<string, JSX.Element> = {
  steam: <SteamLogo className="game-card__shop-icon" />,
  epic: <EpicLogo className="game-card__shop-icon" />,
  gog: <GogLogo className="game-card__shop-icon" />,
  battlenet: <BattleNetLogo className="game-card__shop-icon" />,
  xbox: <XboxLogo className="game-card__shop-icon" />,
  riot: <RiotLogo className="game-card__shop-icon" />,
  ubisoft: <UbisoftLogo className="game-card__shop-icon" />,
  ea: <EaLogo className="game-card__shop-icon" />,
};

export function GameCard({ game, ...props }: GameCardProps) {
  const { t } = useTranslation("game_card");

  const [stats, setStats] = useState<GameStats | null>(null);

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((stats) => {
        setStats(stats);
      });
    }
  }, [game, stats]);

  const { numberFormatter } = useFormat();

  const library = useAppSelector((state) => state.library.value);
  // Only show platform icons for games actually synced from a platform (not catalog-added)
  const ownedShops = library
    .filter((g) => g.objectId === game.objectId && getGameOrigin(g) === "sync")
    .map((g) => g.shop);

  return (
    <button
      {...props}
      type="button"
      className="game-card"
      onMouseEnter={handleHover}
    >
      <div className="game-card__backdrop">
        <img
          src={game.libraryImageUrl ?? undefined}
          alt={game.title}
          className="game-card__cover"
          loading="lazy"
        />

        <div className="game-card__content">
          <div className="game-card__title-container">
            <div className="game-card__shop-icons">
              <GameHubLogo className="game-card__shop-icon game-card__shop-icon--gamehub" />
              {ownedShops.map(
                (s) =>
                  shopIcon[s] && (
                    <span key={s} className="game-card__shop-icon-wrap">
                      {shopIcon[s]}
                    </span>
                  )
              )}
            </div>
            <p className="game-card__title">{game.title}</p>
          </div>

          {game.downloadSources.length > 0 ? (
            <ul className="game-card__download-options">
              {game.downloadSources.slice(0, 3).map((sourceName) => (
                <li key={sourceName}>
                  <Badge>{sourceName}</Badge>
                </li>
              ))}
              {game.downloadSources.length > 3 && (
                <li>
                  <Badge>
                    +{game.downloadSources.length - 3}{" "}
                    {t("game_card:available", {
                      count: game.downloadSources.length - 3,
                    })}
                  </Badge>
                </li>
              )}
            </ul>
          ) : (
            <p className="game-card__no-download-label">{t("no_downloads")}</p>
          )}

          <div className="game-card__specifics">
            <div className="game-card__specifics-item">
              <DownloadIcon />
              <span>
                {stats ? numberFormatter.format(stats.downloadCount) : "…"}
              </span>
            </div>
            <div className="game-card__specifics-item">
              <PeopleIcon />
              <span>
                {stats ? numberFormatter.format(stats.playerCount) : "…"}
              </span>
            </div>
            <div className="game-card__specifics-item">
              <StarRating rating={stats?.averageScore || null} size={14} />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
