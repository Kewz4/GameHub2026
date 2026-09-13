import {
  DownloadSimpleIcon,
  GearIcon,
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { LibraryGame, ShopDetailsWithAssets } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FocusOverrides,
  FocusOverrideTarget,
} from "src/big-picture/src/services/navigation.service";
import { resolvePreferredGameAssets } from "../../../../helpers";
import { useDominantColorStatus } from "../../../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import {
  AnimatedHeroImage,
  Button,
  Divider,
  HorizontalFocusGroup,
  Typography,
} from "../../../common";
import {
  GAME_HERO_ACTIONS_REGION_ID,
  GAME_HERO_DOWNLOAD_OPTIONS_ID,
  GAME_HERO_DESCRIPTION_TOGGLE_ID,
  GAME_HERO_OPEN_CLOUD_SAVE_ID,
  GAME_HERO_OPEN_SETTINGS_ID,
  GAME_HERO_PRIMARY_ACTION_ID,
  GAME_HERO_TOGGLE_FAVORITE_ID,
} from "../navigation";
import { HeroDescription } from "./hero-description";
import { BigPictureCloudSaveHeroButton } from "../cloud-save-v2";
import { useHeroBackgroundLayers } from "../../library/hero/use-hero-background-layers";
import cn from "classnames";

export interface HeroProps {
  shopDetails: ShopDetailsWithAssets;
  game: LibraryGame | null;
  isGameRunning: boolean;
  isFavorite: boolean;
  toggleFavorite: () => void;
  onPlay: () => void;
  onDownload: () => void;
  onAddToLibrary: () => void;
  onOpenDownloadOptions: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  isAddingToLibrary: boolean;
  canAddToLibrary: boolean;
  downNavigationTarget?: FocusOverrideTarget;
  sidebarEntryTarget?: FocusOverrideTarget;
  onReadyChange?: (isReady: boolean) => void;
}

function getFavoriteLeftTargetId(
  shouldShowCloudSaveButton: boolean,
  shouldShowFavoriteButton: boolean,
  shouldShowCatalogActions: boolean,
  hasPrimaryAction: boolean
): string {
  if (shouldShowCloudSaveButton) return GAME_HERO_OPEN_CLOUD_SAVE_ID;
  if (shouldShowFavoriteButton) return GAME_HERO_OPEN_SETTINGS_ID;
  if (shouldShowCatalogActions && hasPrimaryAction)
    return GAME_HERO_DOWNLOAD_OPTIONS_ID;
  if (hasPrimaryAction) return GAME_HERO_PRIMARY_ACTION_ID;
  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

function getSettingsLeftTargetId(
  shouldShowCatalogActions: boolean,
  hasPrimaryAction: boolean
): string {
  if (shouldShowCatalogActions) return GAME_HERO_DOWNLOAD_OPTIONS_ID;
  if (hasPrimaryAction) return GAME_HERO_PRIMARY_ACTION_ID;
  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

export function Hero({
  shopDetails,
  game,
  isGameRunning,
  isFavorite,
  toggleFavorite,
  onPlay,
  onDownload,
  onAddToLibrary,
  onOpenDownloadOptions,
  onOpenSettings,
  onClose,
  isAddingToLibrary,
  canAddToLibrary,
  downNavigationTarget,
  sidebarEntryTarget,
  onReadyChange,
}: Readonly<HeroProps>) {
  const { t } = useTranslation("game_details");
  const preferredAssets = useMemo(
    () => resolvePreferredGameAssets(game, shopDetails.assets),
    [game, shopDetails.assets]
  );
  const heroSrc = preferredAssets.heroSrc || null;
  const { dominantColor, isResolved: isDominantColorResolved } =
    useDominantColorStatus(heroSrc);
  const { backgroundLayers, getLayerEventHandlers } =
    useHeroBackgroundLayers(heroSrc);
  const [loadedHeroSrc, setLoadedHeroSrc] = useState<string | null>(null);
  const isHeroImageReady = !heroSrc || loadedHeroSrc === heroSrc;
  const isHeroPresentationReady = isHeroImageReady && isDominantColorResolved;

  useEffect(() => {
    onReadyChange?.(isHeroPresentationReady);
  }, [isHeroPresentationReady, onReadyChange]);
  const heroDownNavigationTarget = useMemo<FocusOverrideTarget>(
    () => downNavigationTarget ?? { type: "block" },
    [downNavigationTarget]
  );
  const isPlayableClassicsGame =
    game?.shop === "launchbox" && (game.discs?.length ?? 0) > 0;
  const hasPrimaryAction =
    isGameRunning ||
    Boolean(game?.executablePath) ||
    isPlayableClassicsGame ||
    Boolean(game) ||
    canAddToLibrary;
  const shouldShowCatalogActions = !game && canAddToLibrary;
  const shouldShowFavoriteButton = Boolean(game);
  const shouldShowCloudSaveButton = Boolean(game);
  const [canExpandHeroDescription, setCanExpandHeroDescription] =
    useState(false);
  const [isHeroDescriptionExpanded, setIsHeroDescriptionExpanded] =
    useState(false);
  const lastActionRightTarget = useMemo<FocusOverrideTarget>(
    () => sidebarEntryTarget ?? { type: "block" },
    [sidebarEntryTarget]
  );
  const favoriteLeftTargetId = getFavoriteLeftTargetId(
    shouldShowCloudSaveButton,
    shouldShowFavoriteButton,
    shouldShowCatalogActions,
    hasPrimaryAction
  );
  const heroActionUpNavigationTarget = useMemo<FocusOverrideTarget>(
    () =>
      canExpandHeroDescription
        ? {
            type: "item",
            itemId: GAME_HERO_DESCRIPTION_TOGGLE_ID,
          }
        : { type: "block" },
    [canExpandHeroDescription]
  );
  const heroActionEntryTarget = useMemo<FocusOverrideTarget>(
    () =>
      hasPrimaryAction
        ? {
            type: "item",
            itemId: GAME_HERO_PRIMARY_ACTION_ID,
          }
        : { type: "block" },
    [hasPrimaryAction]
  );

  const toggleFavoriteNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: favoriteLeftTargetId,
    },
    right: lastActionRightTarget,
    up: heroActionUpNavigationTarget,
    down: heroDownNavigationTarget,
  };
  const cloudSaveNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: GAME_HERO_OPEN_SETTINGS_ID,
    },
    right: shouldShowFavoriteButton
      ? { type: "item", itemId: GAME_HERO_TOGGLE_FAVORITE_ID }
      : lastActionRightTarget,
    up: heroActionUpNavigationTarget,
    down: heroDownNavigationTarget,
  };

  const { primaryActionButton, downloadOptionsButton, settingsButton } =
    useMemo(() => {
      const primaryActionRightTarget = shouldShowCatalogActions
        ? {
            type: "item" as const,
            itemId: GAME_HERO_DOWNLOAD_OPTIONS_ID,
          }
        : shouldShowFavoriteButton
          ? {
              type: "item" as const,
              itemId: GAME_HERO_OPEN_SETTINGS_ID,
            }
          : lastActionRightTarget;
      const primaryActionNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: BIG_PICTURE_SIDEBAR_ITEM_IDS.home,
        },
        right: primaryActionRightTarget,
        up: heroActionUpNavigationTarget,
        down: heroDownNavigationTarget,
      };
      const downloadOptionsNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: GAME_HERO_PRIMARY_ACTION_ID,
        },
        right: shouldShowFavoriteButton
          ? {
              type: "item",
              itemId: GAME_HERO_OPEN_SETTINGS_ID,
            }
          : lastActionRightTarget,
        up: heroActionUpNavigationTarget,
        down: heroDownNavigationTarget,
      };
      const settingsLeftTargetId = getSettingsLeftTargetId(
        shouldShowCatalogActions,
        hasPrimaryAction
      );
      const settingsNavigationOverrides: FocusOverrides = {
        left: {
          type: "item",
          itemId: settingsLeftTargetId,
        },
        right: shouldShowCloudSaveButton
          ? {
              type: "item" as const,
              itemId: GAME_HERO_OPEN_CLOUD_SAVE_ID,
            }
          : shouldShowFavoriteButton
            ? {
                type: "item" as const,
                itemId: GAME_HERO_TOGGLE_FAVORITE_ID,
              }
            : lastActionRightTarget,
        up: heroActionUpNavigationTarget,
        down: heroDownNavigationTarget,
      };

      if (isGameRunning) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              icon={<XCircleIcon size={24} />}
              onClick={onClose}
            >
              Close Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: shouldShowFavoriteButton ? (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ) : null,
        };
      }

      if (game?.executablePath || isPlayableClassicsGame) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              color={dominantColor ?? undefined}
              iconPosition="right"
              icon={<PlayIcon size={24} weight="fill" />}
              onClick={onPlay}
            >
              Launch Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: shouldShowFavoriteButton ? (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ) : null,
        };
      }

      if (game) {
        return {
          primaryActionButton: (
            <Button
              focusId={GAME_HERO_PRIMARY_ACTION_ID}
              focusNavigationOverrides={primaryActionNavigationOverrides}
              variant="primary"
              color={dominantColor ?? undefined}
              icon={<DownloadSimpleIcon size={24} />}
              onClick={onDownload}
            >
              Download Game
            </Button>
          ),
          downloadOptionsButton: null,
          settingsButton: (
            <Button
              focusId={GAME_HERO_OPEN_SETTINGS_ID}
              focusNavigationOverrides={settingsNavigationOverrides}
              variant="secondary"
              aria-label={t("options")}
              icon={<GearIcon size={24} />}
              onClick={onOpenSettings}
            >
              {t("options")}
            </Button>
          ),
        };
      }

      if (!canAddToLibrary) {
        return {
          primaryActionButton: null,
          downloadOptionsButton: null,
          settingsButton: null,
        };
      }

      return {
        primaryActionButton: (
          <Button
            focusId={GAME_HERO_PRIMARY_ACTION_ID}
            focusNavigationOverrides={primaryActionNavigationOverrides}
            variant="primary"
            color={dominantColor ?? undefined}
            icon={<PlusCircleIcon size={24} />}
            onClick={onAddToLibrary}
            loading={isAddingToLibrary}
          >
            Add to Library
          </Button>
        ),
        downloadOptionsButton: (
          <Button
            focusId={GAME_HERO_DOWNLOAD_OPTIONS_ID}
            focusNavigationOverrides={downloadOptionsNavigationOverrides}
            variant="secondary"
            icon={<DownloadSimpleIcon size={24} />}
            onClick={onOpenDownloadOptions}
          >
            Download Game
          </Button>
        ),
        settingsButton: null,
      };
    }, [
      canAddToLibrary,
      dominantColor,
      game,
      hasPrimaryAction,
      heroActionUpNavigationTarget,
      heroDownNavigationTarget,
      isAddingToLibrary,
      isGameRunning,
      isPlayableClassicsGame,
      onAddToLibrary,
      onClose,
      onDownload,
      onOpenDownloadOptions,
      onOpenSettings,
      onPlay,
      shouldShowCatalogActions,
      shouldShowCloudSaveButton,
      shouldShowFavoriteButton,
      lastActionRightTarget,
      t,
    ]);

  return (
    <section
      className={cn(
        "game-page__hero-shell",
        !isHeroPresentationReady && "game-page__hero-shell--loading"
      )}
      data-description-expanded={isHeroDescriptionExpanded}
      data-hero-ready={isHeroPresentationReady}
    >
      {backgroundLayers.map((layer) => {
        const layerHandlers = getLayerEventHandlers(layer);

        return (
          <div
            key={layer.key}
            className={cn(
              `game-page__hero-bg-layer game-page__hero-bg-layer--${layer.role}`,
              layer.isVisible && "game-page__hero-bg-layer--visible"
            )}
            onTransitionEnd={layerHandlers.onTransitionEnd}
          >
            <AnimatedHeroImage
              className="game-page__hero"
              imageUrl={layer.imageUrl}
              onLoad={() => {
                setLoadedHeroSrc(layer.imageUrl);
                layerHandlers.onLoad();
              }}
              onError={() => {
                setLoadedHeroSrc(layer.imageUrl);
                layerHandlers.onError();
              }}
            />
          </div>
        );
      })}

      {!isHeroPresentationReady ? (
        <div className="game-page__hero-loading" role="status">
          <span className="game-page__hero-loading-logo" />
          <span className="game-page__hero-loading-copy" />
          <span className="game-page__hero-loading-copy game-page__hero-loading-copy--short" />
          <span className="game-page__hero-loading-action" />
          <span className="sr-only">Preparing game artwork and theme…</span>
        </div>
      ) : null}

      <div className="game-page__hero-overlay">
        {preferredAssets.logoSrc ? (
          <img
            src={preferredAssets.logoSrc}
            alt={preferredAssets.title}
            className="game-page__hero-logo"
          />
        ) : (
          <Typography variant="h1" className="game-page__hero-title-fallback">
            {preferredAssets.title}
          </Typography>
        )}

        <HeroDescription
          descriptionHtml={
            shopDetails.short_description ||
            shopDetails.detailed_description ||
            ""
          }
          actionEntryTarget={heroActionEntryTarget}
          sidebarEntryTarget={sidebarEntryTarget}
          onCanExpandChange={setCanExpandHeroDescription}
          onExpandedChange={setIsHeroDescriptionExpanded}
        />

        <HorizontalFocusGroup
          regionId={GAME_HERO_ACTIONS_REGION_ID}
          className="game-page__hero-actions"
        >
          {primaryActionButton}
          {downloadOptionsButton}

          {primaryActionButton && settingsButton && (
            <div className="game-page__hero-action-divider">
              <Divider orientation="vertical" color="var(--text-secondary)" />
            </div>
          )}

          {settingsButton}

          {shouldShowCloudSaveButton && (
            <BigPictureCloudSaveHeroButton
              focusNavigationOverrides={cloudSaveNavigationOverrides}
            />
          )}

          {shouldShowFavoriteButton && (
            <Button
              variant="secondary"
              size="icon"
              aria-label={
                isFavorite ? "Remove from favorites" : "Add to favorites"
              }
              onClick={() => toggleFavorite()}
              focusId={GAME_HERO_TOGGLE_FAVORITE_ID}
              focusNavigationOverrides={toggleFavoriteNavigationOverrides}
            >
              {isFavorite ? (
                <HeartIcon size={24} weight="fill" />
              ) : (
                <HeartIcon size={24} />
              )}
            </Button>
          )}
        </HorizontalFocusGroup>
      </div>
    </section>
  );
}
