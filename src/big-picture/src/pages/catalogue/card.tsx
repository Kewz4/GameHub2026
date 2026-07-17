import type { CatalogueSearchResult, EmulatorSystem } from "@types";
import { QuestionIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { FocusItem, SourceAnchor, Typography } from "../../components";
import { getBigPictureGameDetailsPath } from "../../helpers";
import type { FocusOverrides } from "../../services";
import { getCatalogueCardFocusId } from "./navigation";
import { PlatformLogo } from "@renderer/pages/settings/emulation/platform-logo";
import { PLATFORM_LABELS } from "@renderer/assets/emulation/platform-logos";

/** Console/classics results are shop "launchbox" with objectId minerva:<system>:… */
function systemForResult(game: CatalogueSearchResult): EmulatorSystem | null {
  if (game.shop !== "launchbox") return null;
  if (!game.objectId.startsWith("minerva:")) return null;
  const seg = game.objectId.split(":")[1];
  return seg in PLATFORM_LABELS ? (seg as EmulatorSystem) : null;
}

interface CardProps {
  game: CatalogueSearchResult;
  navigationOverrides?: FocusOverrides;
}

export function CatalogueCard({
  game,
  navigationOverrides,
}: Readonly<CardProps>) {
  const navigate = useNavigate();

  const uniqueDownloadSources = useMemo(() => {
    return Array.from(new Set(game.downloadSources));
  }, [game.downloadSources]);

  const platformSystem = useMemo(() => systemForResult(game), [game]);

  const gamePath = getBigPictureGameDetailsPath({
    shop: game.shop,
    objectId: game.objectId,
    title: game.title,
  });

  return (
    <FocusItem
      id={getCatalogueCardFocusId(game.id)}
      actions={{
        primary: () => navigate(gamePath),
      }}
      navigationOverrides={navigationOverrides}
      asChild
    >
      <div className="catalogue-card">
        <button
          type="button"
          className="catalogue-card__image"
          onClick={() => navigate(gamePath)}
        >
          {game.libraryImageUrl ? (
            <img src={game.libraryImageUrl} alt={game.title} loading="lazy" />
          ) : (
            <div className="catalogue-card__image-placeholder">
              <QuestionIcon size={28} />
            </div>
          )}
        </button>

        <div className="catalogue-card__body">
          <div className="catalogue-card__content">
            <div className="catalogue-card__content__title">
              <Typography
                variant="label"
                className="catalogue-card__content__title-text"
              >
                {game.title}
              </Typography>
            </div>

            <div className="catalogue-card__content__genres">
              <Typography
                variant="body"
                className="catalogue-card__content__genres-text"
              >
                {game.genres.slice(0, 3).join(", ")}
              </Typography>
            </div>
          </div>

          <div className="catalogue-card__download-sources">
            {uniqueDownloadSources.slice(0, 3).map((source) => (
              <SourceAnchor key={source} title={source} />
            ))}

            {uniqueDownloadSources.length > 3 ? (
              <SourceAnchor title={`+${uniqueDownloadSources.length - 3}`} />
            ) : null}

            {platformSystem ? (
              <span
                className="catalogue-card__platform-chip"
                title={PLATFORM_LABELS[platformSystem]}
              >
                <PlatformLogo
                  system={platformSystem}
                  className="catalogue-card__platform-chip-logo"
                />
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </FocusItem>
  );
}
