import {
  DownloadIcon,
  GearIcon,
  HeartFillIcon,
  HeartIcon,
  PinIcon,
  PinSlashIcon,
  PlayIcon,
  PlusCircleIcon,
  ShareAndroidIcon,
} from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { XCircle } from "lucide-react";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";

import "./hero-panel-actions.scss";
import { useEffect } from "react";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const { isGameDeleting } = useDownload();
  const { userDetails } = useUserDetails();

  const {
    game,
    repacks,
    isGameRunning,
    shop,
    objectId,
    gameTitle,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
    isTransferring,
    transferProgress,
  } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const { updateLibrary } = useLibrary();

  const { showSuccessToast, showErrorToast } = useToast();

  const { t } = useTranslation("game_details");

  useEffect(() => {
    const onFavoriteToggled = () => {
      updateLibrary();
      updateGame();
    };

    const onGameRemoved = () => {
      updateLibrary();
      updateGame();
    };

    const onFilesRemoved = () => {
      updateLibrary();
      updateGame();
    };

    window.addEventListener(
      "hydra:game-favorite-toggled",
      onFavoriteToggled as EventListener
    );
    window.addEventListener(
      "hydra:game-removed-from-library",
      onGameRemoved as EventListener
    );
    window.addEventListener(
      "hydra:game-files-removed",
      onFilesRemoved as EventListener
    );

    return () => {
      window.removeEventListener(
        "hydra:game-favorite-toggled",
        onFavoriteToggled as EventListener
      );
      window.removeEventListener(
        "hydra:game-removed-from-library",
        onGameRemoved as EventListener
      );
      window.removeEventListener(
        "hydra:game-files-removed",
        onFilesRemoved as EventListener
      );
    };
  }, [updateLibrary, updateGame]);

  const addGameToLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      await window.electron.addGameToLibrary(shop, objectId!, gameTitle);

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGameFavorite = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.favorite && objectId) {
        await window.electron
          .removeGameFromFavorites(shop, objectId)
          .then(() => {
            showSuccessToast(t("game_removed_from_favorites"));
          });
      } else {
        if (!objectId) return;

        await window.electron.addGameToFavorites(shop, objectId).then(() => {
          showSuccessToast(t("game_added_to_favorites"));
        });
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGamePinned = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.isPinned && objectId) {
        await window.electron.toggleGamePin(shop, objectId, false).then(() => {
          showSuccessToast(t("game_removed_from_pinned"));
        });
      } else {
        if (!objectId) return;

        await window.electron.toggleGamePin(shop, objectId, true).then(() => {
          showSuccessToast(t("game_added_to_pinned"));
        });
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const openGame = async () => {
    if (game) {
      if (game.executablePath) {
        window.electron.openGame(
          game.shop,
          game.objectId,
          game.executablePath,
          game.launchOptions
        );
        return;
      }

      const gameExecutablePath = await selectGameExecutable();
      if (gameExecutablePath)
        window.electron.openGame(
          game.shop,
          game.objectId,
          gameExecutablePath,
          game.launchOptions
        );
    }
  };

  const closeGame = () => {
    if (game) window.electron.closeGame(game.shop, game.objectId);
  };

  const handleShareGame = () => {
    const targetShop = shop;
    const targetObjectId = objectId;
    const targetTitle = gameTitle;
    if (!targetShop || !targetObjectId) return;
    const link = `hydralauncher://game?shop=${encodeURIComponent(targetShop)}&objectId=${encodeURIComponent(targetObjectId)}&title=${encodeURIComponent(targetTitle)}`;
    navigator.clipboard
      .writeText(link)
      .then(() => {
        showSuccessToast(
          t("share_link_copied", {
            defaultValue: "Game link copied to clipboard!",
          })
        );
      })
      .catch(() => {
        showErrorToast(
          t("share_link_failed", { defaultValue: "Failed to copy link" })
        );
      });
  };

  const deleting = game ? isGameDeleting(game?.id) : false;

  const addGameToLibraryButton = (
    <Button
      theme="outline"
      disabled={toggleLibraryGameDisabled}
      onClick={addGameToLibrary}
      className="hero-panel-actions__action"
    >
      <PlusCircleIcon />
      {t("add_to_library")}
    </Button>
  );

  const showDownloadOptionsButton = (
    <Button
      onClick={() => setShowRepacksModal(true)}
      theme="outline"
      disabled={deleting}
      className="hero-panel-actions__action"
    >
      {t("open_download_options")}
    </Button>
  );

  // Platform launcher URI schemes. A protocol-URI executablePath is stamped for
  // EVERY owned game by Steam/Xbox sync, so on its own it does NOT mean the game
  // is installed — only `isInstalledLocally` (or a real local file path) does.
  const PLATFORM_URI_RE =
    /^(steam|legendary|goggalaxy|goglauncher|msxbox|battlenet|origin2|uplay|riot):\/\//i;

  const shopDisplayName: Record<string, string> = {
    steam: "Steam",
    epic: "Epic Games",
    gog: "GOG",
    xbox: "Xbox",
    ea: "the EA app",
    ubisoft: "Ubisoft Connect",
    riot: "Riot Client",
    battlenet: "Battle.net",
  };

  const execIsProtocolUri =
    game?.executablePath != null && PLATFORM_URI_RE.test(game.executablePath);

  // "Sure it's installed": an explicit local-install confirmation, or a real
  // local-file executablePath (not a launcher protocol URI).
  const isConfirmedInstalled =
    game?.isInstalledLocally === true ||
    (game?.executablePath != null && !execIsProtocolUri);

  // A URI we can hand to the platform to install/launch an owned-but-not-yet-
  // installed game (Steam/Xbox/EA installs on demand when this fires).
  const ownedInstallUri = execIsProtocolUri
    ? game!.executablePath!
    : game?.shop === "steam"
      ? `steam://install/${game.objectId}`
      : null;

  const launchOwnedViaPlatform = () => {
    if (game && ownedInstallUri) {
      window.electron.openGame(
        game.shop,
        game.objectId,
        ownedInstallUri,
        game.launchOptions
      );
    }
  };

  const gameActionButton = () => {
    if (isTransferring) {
      const percent = Math.round(transferProgress * 100);
      return (
        <Button
          theme="outline"
          className="hero-panel-actions__action"
          onClick={() => {
            setGameOptionsInitialCategory("locations");
            setShowGameOptionsModal(true);
          }}
        >
          Transferring {percent}%
        </Button>
      );
    }

    if (isGameRunning) {
      return (
        <Button
          onClick={closeGame}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          <XCircle size={18} />
          {t("close")}
        </Button>
      );
    }

    // Confirmed installed → Play (local exe) or Launch (installed launcher game).
    if (game?.executablePath && isConfirmedInstalled) {
      return (
        <Button
          onClick={openGame}
          theme="outline"
          disabled={deleting || isGameRunning}
          className="hero-panel-actions__action"
        >
          <PlayIcon />
          {execIsProtocolUri
            ? t("launch", { defaultValue: "Launch" })
            : t("play")}
        </Button>
      );
    }

    // Owned on a platform but NOT confirmed installed → don't pretend it's
    // launchable. Offer to install/launch it through the platform instead.
    if (ownedInstallUri) {
      const platform = shopDisplayName[game!.shop] ?? game!.shop;
      return (
        <Button
          onClick={launchOwnedViaPlatform}
          theme="outline"
          disabled={deleting || isGameRunning}
          className="hero-panel-actions__action hero-panel-actions__action--owned"
          title={t("you_own_this_game", {
            defaultValue: "You own this game",
          })}
        >
          <DownloadIcon />
          {t("install_via", {
            defaultValue: `Install via ${platform}`,
            platform,
          })}
        </Button>
      );
    }

    return (
      <Button
        onClick={() => setShowRepacksModal(true)}
        theme="outline"
        disabled={isGameDownloading}
        className={`hero-panel-actions__action ${repacks.length === 0 ? "hero-panel-actions__action--disabled" : ""}`}
      >
        <DownloadIcon />
        {t("download")}
      </Button>
    );
  };

  if (repacks.length && !game) {
    return (
      <>
        {addGameToLibraryButton}
        {showDownloadOptionsButton}
      </>
    );
  }

  const alternativeShopLaunchButtons = game?.alternativeShops
    ?.filter((alt) => alt.executablePath)
    .map((alt) => {
      const shopLabel: Record<string, string> = {
        epic: "Epic",
        gog: "GOG",
        xbox: "Xbox",
        steam: "Steam",
        battlenet: "Battle.net",
      };
      return (
        <Button
          key={`${alt.shop}:${alt.objectId}`}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
          onClick={() =>
            window.electron.openGame(
              alt.shop,
              alt.objectId,
              alt.executablePath!,
              undefined
            )
          }
        >
          <PlayIcon />
          {`Launch via ${shopLabel[alt.shop] ?? alt.shop}`}
        </Button>
      );
    });

  if (game) {
    // Show "Download options" for library games that launch via a platform protocol
    // (steam://, legendary://, etc.) so users can still access catalogue repacks
    const isProtocolLaunch =
      game.executablePath != null &&
      /^(steam|legendary|goggalaxy|msxbox|battlenet):\/\//.test(
        game.executablePath
      );
    const isSteamProtocol =
      game.executablePath?.startsWith("steam://") ?? false;
    const showRepackDownloadForLibraryGame =
      isProtocolLaunch && (repacks.length > 0 || isSteamProtocol);

    return (
      <div className="hero-panel-actions__container">
        {gameActionButton()}
        {showRepackDownloadForLibraryGame && showDownloadOptionsButton}
        {alternativeShopLaunchButtons}
        <div className="hero-panel-actions__separator" />
        <Button
          onClick={toggleGameFavorite}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          {game.favorite ? <HeartFillIcon /> : <HeartIcon />}
        </Button>

        {userDetails && game.shop !== "custom" && (
          <Button
            onClick={toggleGamePinned}
            theme="outline"
            disabled={deleting}
            className="hero-panel-actions__action"
          >
            {game.isPinned ? <PinSlashIcon /> : <PinIcon />}
          </Button>
        )}

        <Button
          onClick={handleShareGame}
          theme="outline"
          disabled={!objectId}
          className="hero-panel-actions__action"
          title={t("share_game", { defaultValue: "Share game" })}
        >
          <ShareAndroidIcon />
        </Button>

        <Button
          onClick={() => {
            setGameOptionsInitialCategory("general");
            setShowGameOptionsModal(true);
          }}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          <GearIcon />
          {t("options")}
        </Button>
      </div>
    );
  }

  // Even without a library entry, show share if we have an objectId
  if (objectId) {
    return (
      <>
        {addGameToLibraryButton}
        <Button
          onClick={handleShareGame}
          theme="outline"
          className="hero-panel-actions__action"
          title={t("share_game", { defaultValue: "Share game" })}
        >
          <ShareAndroidIcon />
        </Button>
      </>
    );
  }

  return addGameToLibraryButton;
}
