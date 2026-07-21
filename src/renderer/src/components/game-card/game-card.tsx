import {
  DownloadIcon,
  EyeClosedIcon,
  InfoIcon,
  PeopleIcon,
  ThumbsdownIcon,
  ThumbsupIcon,
} from "@primer/octicons-react";
import type { GameStats, ShopAssets } from "@types";
import type { FeedbackKind } from "@renderer/pages/home/recommendation-feedback";

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
import { memo, useCallback, useState } from "react";
import { useFormat } from "@renderer/hooks";

export interface GameCardProps
  extends React.DetailedHTMLProps<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  game: ShopAssets;
  /**
   * Shops this game is owned/synced on (for the platform icons). Passed down
   * from the row so the card does NOT each subscribe to the whole Redux library
   * — with 200+ home cards, per-card library subscriptions caused a re-render
   * storm on every library update. Computed once per row instead.
   */
  ownedShops?: string[];
  /** Current thumbs up/down state (recommended row only). */
  feedback?: FeedbackKind | null;
  /** When provided, renders like/dislike controls that report the tapped kind. */
  onFeedback?: (kind: FeedbackKind) => void;
  /** Stable click handler that receives the game — preferred over onClick for memoization. */
  onCardClick?: (game: ShopAssets) => void;
  /** Stable feedback handler that receives the game + kind — preferred over onFeedback for memoization. */
  onCardFeedback?: (game: ShopAssets, kind: FeedbackKind) => void;
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

export const GameCard = memo(function GameCard({
  game,
  className,
  ownedShops = [],
  feedback,
  onFeedback,
  onCardClick,
  onCardFeedback,
  onClick,
  ...props
}: GameCardProps) {
  const { t } = useTranslation("game_card");

  const [stats, setStats] = useState<GameStats | null>(null);
  const [showReason, setShowReason] = useState(false);

  const handleFeedback = useCallback(
    (event: React.SyntheticEvent, kind: FeedbackKind) => {
      event.stopPropagation();
      event.preventDefault();
      if (onCardFeedback) onCardFeedback(game, kind);
      else onFeedback?.(kind);
    },
    [game, onCardFeedback, onFeedback]
  );

  const handleHover = useCallback(() => {
    if (!stats) {
      window.electron.getGameStats(game.objectId, game.shop).then((stats) => {
        setStats(stats);
      });
    }
  }, [game, stats]);

  const { numberFormatter } = useFormat();

  const showFeedbackControls = onFeedback || onCardFeedback;

  return (
    <button
      {...props}
      type="button"
      className={className ? `game-card ${className}` : "game-card"}
      onClick={onClick ?? (onCardClick ? () => onCardClick(game) : undefined)}
      onMouseEnter={handleHover}
    >
      <div className="game-card__backdrop">
        <img
          src={game.libraryImageUrl ?? undefined}
          alt={game.title}
          className="game-card__cover"
          loading="lazy"
        />

        {showFeedbackControls && (
          <div className="game-card__feedback">
            <span
              role="button"
              tabIndex={0}
              className={`game-card__feedback-button${
                feedback === "like" ? " game-card__feedback-button--active" : ""
              }`}
              aria-label={t("recommend_like", {
                defaultValue: "I like this recommendation",
              })}
              aria-pressed={feedback === "like"}
              onClick={(event) => handleFeedback(event, "like")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  handleFeedback(event, "like");
                }
              }}
            >
              <ThumbsupIcon size={13} />
            </span>
            <span
              role="button"
              tabIndex={0}
              className={`game-card__feedback-button${
                feedback === "dislike"
                  ? " game-card__feedback-button--active-dislike"
                  : ""
              }`}
              aria-label={t("recommend_dislike", {
                defaultValue: "I don't like this — show me fewer games like it",
              })}
              aria-pressed={feedback === "dislike"}
              onClick={(event) => handleFeedback(event, "dislike")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  handleFeedback(event, "dislike");
                }
              }}
            >
              <ThumbsdownIcon size={13} />
            </span>
            <span
              role="button"
              tabIndex={0}
              className={`game-card__feedback-button${
                feedback === "ignore"
                  ? " game-card__feedback-button--active-ignore"
                  : ""
              }`}
              aria-label={t("recommend_ignore", {
                defaultValue:
                  "Don't recommend this specific game again (no effect on other recommendations)",
              })}
              title={t("recommend_ignore", {
                defaultValue:
                  "Don't recommend this specific game again (no effect on other recommendations)",
              })}
              aria-pressed={feedback === "ignore"}
              onClick={(event) => handleFeedback(event, "ignore")}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  handleFeedback(event, "ignore");
                }
              }}
            >
              <EyeClosedIcon size={13} />
            </span>
          </div>
        )}

        {game.recommendationReason && (
          <div className="game-card__reason">
            {/* Not a <button> — the card root already is one, and buttons can't
                nest. A role=button span with stopPropagation shows the "why"
                without triggering navigation. */}
            <span
              role="button"
              tabIndex={0}
              className="game-card__reason-toggle"
              aria-label={t("why_recommended", {
                defaultValue: "Why is this recommended?",
              })}
              title={game.recommendationReason}
              aria-expanded={showReason}
              onClick={(event) => {
                event.stopPropagation();
                event.preventDefault();
                setShowReason((prev) => !prev);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.stopPropagation();
                  event.preventDefault();
                  setShowReason((prev) => !prev);
                }
              }}
              onMouseEnter={() => setShowReason(true)}
              onMouseLeave={() => setShowReason(false)}
            >
              <InfoIcon size={14} />
            </span>
            {showReason && (
              <span className="game-card__reason-popover" role="tooltip">
                {game.recommendationReason}
              </span>
            )}
          </div>
        )}

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
});
