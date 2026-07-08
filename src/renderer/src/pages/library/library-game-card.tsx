import { LibraryGame } from "@types";
import { useGameCard } from "@renderer/hooks";
import { memo, useEffect, useState } from "react";
import {
  ClockIcon,
  AlertFillIcon,
  TrophyIcon,
  ImageIcon,
  HistoryIcon,
  DownloadIcon,
} from "@primer/octicons-react";
import "./library-game-card.scss";
import { logger } from "@renderer/logger";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import BattleNetLogo from "@renderer/assets/battlenet-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";
import RiotLogo from "@renderer/assets/riot-logo.svg?react";
import UbisoftLogo from "@renderer/assets/ubisoft-logo.svg?react";
import EaLogo from "@renderer/assets/ea-logo.svg?react";
import GameHubLogo from "@renderer/assets/gamehub-logo.svg?react";
import { getGameOrigin } from "@renderer/helpers/game-origin";

const shopIcon: Record<string, JSX.Element> = {
  steam: <SteamLogo className="library-game-card__shop-icon" />,
  epic: <EpicLogo className="library-game-card__shop-icon" />,
  gog: <GogLogo className="library-game-card__shop-icon" />,
  battlenet: <BattleNetLogo className="library-game-card__shop-icon" />,
  xbox: <XboxLogo className="library-game-card__shop-icon" />,
  riot: <RiotLogo className="library-game-card__shop-icon" />,
  ubisoft: <UbisoftLogo className="library-game-card__shop-icon" />,
  ea: <EaLogo className="library-game-card__shop-icon" />,
};

interface LibraryGameCardProps {
  game: LibraryGame;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu: (
    game: LibraryGame,
    position: { x: number; y: number }
  ) => void;
  onShowTooltip?: (gameId: string) => void;
  onHideTooltip?: () => void;
}

export const LibraryGameCard = memo(function LibraryGameCard({
  game,
  onMouseEnter,
  onMouseLeave,
  onContextMenu,
}: Readonly<LibraryGameCardProps>) {
  const { formatPlayTime, handleCardClick, handleContextMenuClick } =
    useGameCard(game, onContextMenu);

  const lastPlayedLabel = (() => {
    if (!game.lastTimePlayed) return null;
    const date = new Date(game.lastTimePlayed);
    const time = date.getTime();
    if (Number.isNaN(time)) return null;
    const diffMs = Date.now() - time;
    // A last-played timestamp in the future is bad data — don't show it.
    if (diffMs < 0) return null;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  })();

  const sources = [
    game.customIconUrl, // Level 0
    game.coverImageUrl, // Level 1
    game.libraryImageUrl, // Level 2
    game.iconUrl, // Level 3
  ].filter((url) => url && url.trim() !== "");

  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  const resolveImageSource = (imageUrl: string | null | undefined): string => {
    if (!imageUrl) return "";

    const trimmedImageUrl = imageUrl.trim();
    if (!trimmedImageUrl) return "";

    if (
      trimmedImageUrl.startsWith("http://") ||
      trimmedImageUrl.startsWith("https://") ||
      trimmedImageUrl.startsWith("data:") ||
      trimmedImageUrl.startsWith("blob:")
    ) {
      return trimmedImageUrl;
    }

    if (trimmedImageUrl.startsWith("local:")) {
      const normalizedLocalPath = trimmedImageUrl
        .slice("local:".length)
        .replaceAll("\\", "/");
      return `local:${normalizedLocalPath}`;
    }

    const normalizedPath = trimmedImageUrl.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("/")) {
      return `local:${normalizedPath}`;
    }

    return normalizedPath;
  };

  const activeImageSource = resolveImageSource(sources[fallbackIndex]);

  const handleImageError = () => {
    logger.warn(`Image failed to load for ${game.title}`, {
      failedUrl: sources[fallbackIndex],
      level: fallbackIndex,
    });

    if (fallbackIndex < sources.length - 1) {
      setFallbackIndex((prevIndex) => prevIndex + 1);
    } else {
      setImageError(true);
    }
  };

  useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [game.id]);

  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="library-game-card__wrapper"
      title={game.title}
      onClick={handleCardClick}
      onContextMenu={handleContextMenuClick}
    >
      <div className="library-game-card__overlay">
        <div className="library-game-card__top-section">
          <div className="library-game-card__shop-badge">
            <GameHubLogo className="library-game-card__shop-icon library-game-card__shop-icon--gamehub" />
            {getGameOrigin(game) === "sync" && shopIcon[game.shop]}
            {game.alternativeShops?.map((alt) =>
              shopIcon[alt.shop] ? (
                <span key={`${alt.shop}:${alt.objectId}`}>
                  {shopIcon[alt.shop]}
                </span>
              ) : null
            )}
          </div>
          <div className="library-game-card__playtime">
            {game.isInstalledLocally === true && (
              <span
                className="library-game-card__installed-badge"
                title="Installed"
              >
                <DownloadIcon size={11} />
              </span>
            )}
            {game.hasManuallyUpdatedPlaytime ? (
              <AlertFillIcon
                size={11}
                className="library-game-card__manual-playtime"
              />
            ) : (
              <ClockIcon size={11} />
            )}
            <span className="library-game-card__playtime-long">
              {formatPlayTime(game.playTimeInMilliseconds)}
            </span>
            <span className="library-game-card__playtime-short">
              {formatPlayTime(game.playTimeInMilliseconds, true)}
            </span>
          </div>
        </div>

        {lastPlayedLabel && (
          <div
            className="library-game-card__cloud-save"
            title={`Last played: ${new Date(game.lastTimePlayed!).toLocaleString()}`}
          >
            <HistoryIcon size={10} />
            <span>{lastPlayedLabel}</span>
          </div>
        )}

        {(game.achievementCount ?? 0) > 0 && (
          <div
            className={`library-game-card__achievements${
              (game.unlockedAchievementCount ?? 0) >=
                (game.achievementCount ?? 0) && (game.achievementCount ?? 0) > 0
                ? " library-game-card__achievements--platinum"
                : ""
            }`}
          >
            <div className="library-game-card__achievement-header">
              <div className="library-game-card__achievements-gap">
                <TrophyIcon
                  size={13}
                  className="library-game-card__achievement-trophy"
                />
                <span className="library-game-card__achievement-count">
                  {game.unlockedAchievementCount ?? 0} /{" "}
                  {game.achievementCount ?? 0}
                </span>
              </div>
              <span className="library-game-card__achievement-percentage">
                {Math.round(
                  ((game.unlockedAchievementCount ?? 0) /
                    (game.achievementCount ?? 1)) *
                    100
                )}
                %
              </span>
            </div>
            <div className="library-game-card__achievement-progress">
              <div
                className="library-game-card__achievement-bar"
                style={{
                  width: `${((game.unlockedAchievementCount ?? 0) / (game.achievementCount ?? 1)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {imageError || !activeImageSource ? (
        <div className="library-game-card__cover-placeholder">
          <ImageIcon size={48} />
        </div>
      ) : (
        <img
          src={activeImageSource}
          alt={game.title}
          className="library-game-card__game-image"
          loading="lazy"
          onError={handleImageError}
        />
      )}
    </button>
  );
});
