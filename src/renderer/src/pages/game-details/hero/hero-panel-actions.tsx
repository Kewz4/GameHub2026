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
import { Button, Modal } from "@renderer/components";
import { PauseCircle, PlayCircle, XCircle } from "lucide-react";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { gameDetailsContext } from "@renderer/context";
import { getGameOrigin } from "@renderer/helpers/game-origin";
import { getClassicsLaunchErrorCode } from "@renderer/helpers";
import { systemForGame } from "@renderer/pages/library/console-filter";
import type { EmulatorSystem, GameProcessControlState } from "@types";

import "./hero-panel-actions.scss";

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

  const navigate = useNavigate();

  const { t } = useTranslation("game_details");
  const [gameProcessState, setGameProcessState] =
    useState<GameProcessControlState | null>(null);
  const [gameProcessBusy, setGameProcessBusy] = useState(false);

  useEffect(() => {
    if (!isGameRunning || !game) {
      setGameProcessState(null);
      return;
    }

    let active = true;
    const applyState = (state: GameProcessControlState) => {
      if (
        active &&
        state.shop === game.shop &&
        state.objectId === game.objectId
      ) {
        setGameProcessState(state);
      }
    };
    void window.electron
      .getActiveGameProcessState()
      .then(applyState)
      .catch(() => undefined);
    const unsubscribe = window.electron.onGameProcessControlState(applyState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [game, isGameRunning]);

  // For console/emulated games, track whether the emulator is installed so the
  // action button can say "Set up emulator" and the download can warn first.
  // This must run for CATALOGUE console games too (objectId "minerva:…"), not
  // only games already in the library — otherwise the gate is skipped exactly
  // when the user is about to download a ROM whose emulator isn't set up.
  const isConsoleGame =
    game?.shop === "launchbox" ||
    shop === "launchbox" ||
    Boolean(objectId?.startsWith("minerva:"));

  // The console this game runs on, so "Set up emulator" can deep-link straight
  // to that emulator in the emulation manager (not just general settings).
  const consoleSystem =
    (game ? systemForGame(game) : null) ??
    (objectId?.startsWith("minerva:")
      ? (objectId.split(":")[1] as EmulatorSystem)
      : null);
  const emulatorSetupPath = consoleSystem
    ? `/settings?tab=emulation&system=${consoleSystem}`
    : "/settings?tab=emulation";

  const [emulatorReady, setEmulatorReady] = useState<boolean | null>(null);
  const [showEmulatorSetupPrompt, setShowEmulatorSetupPrompt] = useState(false);
  useEffect(() => {
    const consoleObjectId = game?.objectId ?? objectId;
    if (!isConsoleGame || !consoleObjectId) {
      setEmulatorReady(null);
      return;
    }
    let cancelled = false;
    window.electron
      .isEmulatorReady("launchbox", consoleObjectId)
      .then((ready) => {
        if (!cancelled) setEmulatorReady(ready);
      })
      .catch(() => {
        if (!cancelled) setEmulatorReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isConsoleGame, game?.objectId, objectId, isGameRunning]);

  // Open the download options — but for a console game whose emulator isn't
  // installed, warn first so the user knows they'll need to set it up to play.
  const openDownloadOptions = () => {
    if (isConsoleGame && emulatorReady === false) {
      setShowEmulatorSetupPrompt(true);
      return;
    }
    setShowRepacksModal(true);
  };

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

  // Launch a console/emulated (launchbox) game through its emulator, gating on
  // emulator setup: if the emulator for this console isn't configured yet, tell
  // the user to set it up and route them to Settings instead of failing silently.
  const openClassicsGame = async () => {
    if (!game) return;
    try {
      await window.electron.openClassicsGame(game.shop, game.objectId);
      await updateGame();
    } catch (error) {
      const code = getClassicsLaunchErrorCode(error);

      if (
        code === "EMULATOR_NOT_CONFIGURED" ||
        code === "BIOS_NOT_CONFIGURED"
      ) {
        showErrorToast(
          t("emulator_not_configured_title", {
            defaultValue: "Set up the emulator first",
          }),
          t("emulator_not_configured_message", {
            defaultValue:
              "Configure the emulator for this console in Settings before playing.",
          })
        );
        navigate(emulatorSetupPath);
        return;
      }

      if (code === "NO_DISC") {
        showErrorToast(
          t("classics_no_disc", { defaultValue: "Game files not found" }),
          t("classics_no_disc_message", {
            defaultValue:
              "The downloaded game files could not be located. Try re-downloading.",
          })
        );
        return;
      }

      if (code === "PLATFORM_UNKNOWN") {
        showErrorToast(
          t("classics_platform_unknown", {
            defaultValue: "Console not supported",
          })
        );
        return;
      }

      showErrorToast(
        t("classics_launch_failed", { defaultValue: "Launch failed" })
      );
    }
  };

  const closeGame = () => {
    if (game) window.electron.closeGame(game.shop, game.objectId);
  };

  const toggleGamePaused = () => {
    if (!gameProcessState || gameProcessBusy) return;
    setGameProcessBusy(true);
    const request =
      gameProcessState.status === "paused"
        ? window.electron.resumeActiveGame()
        : window.electron.pauseActiveGame();
    void request
      .then(setGameProcessState)
      .catch(() =>
        showErrorToast(
          gameProcessState.status === "paused"
            ? "Could not resume the game"
            : "Could not pause the game"
        )
      )
      .finally(() => setGameProcessBusy(false));
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
      onClick={openDownloadOptions}
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

  const execIsProtocolUri =
    game?.executablePath != null && PLATFORM_URI_RE.test(game.executablePath);

  // "Sure it's installed": an explicit local-install confirmation, or a real
  // local-file executablePath (not a launcher protocol URI).
  const isConfirmedInstalled =
    game?.isInstalledLocally === true ||
    (game?.executablePath != null && !execIsProtocolUri);

  // Launchable right now: installed AND we have a path to launch with.
  const isLaunchable = Boolean(game?.executablePath) && isConfirmedInstalled;

  // Console/emulated (launchbox) games launch via an emulator and never have an
  // executablePath; they're launchable once the downloaded ROM has been bound
  // as a disc. The emulator-setup gate is enforced on click (openClassicsGame).
  const isClassicsLaunchable =
    game?.shop === "launchbox" &&
    Boolean(game.selectedDiscPath || (game.discs && game.discs.length > 0));

  // Owned on a platform (synced from the platform account) — NOT a catalogue /
  // repack entry that merely reuses the steam shop for assets (Retigga).
  const isOwnedOnPlatform = game != null && getGameOrigin(game) === "sync";

  // Whether the download-options modal has anything to show: catalogue repacks
  // and/or the official "you own this game — download via <platform>" link.
  const hasDownloadOptions = repacks.length > 0 || isOwnedOnPlatform;

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
        <>
          <Button
            onClick={toggleGamePaused}
            theme="outline"
            disabled={
              deleting ||
              gameProcessBusy ||
              (!gameProcessState?.canPause && !gameProcessState?.canResume)
            }
            className="hero-panel-actions__action"
            title={
              gameProcessState?.status === "paused"
                ? "Resume the suspended game process"
                : "Pause the game process"
            }
          >
            {gameProcessState?.status === "paused" ? (
              <PlayCircle size={18} />
            ) : (
              <PauseCircle size={18} />
            )}
            {gameProcessState?.status === "paused" ? "Resume" : "Pause"}
          </Button>
          <Button
            onClick={closeGame}
            theme="outline"
            disabled={deleting}
            className="hero-panel-actions__action"
          >
            <XCircle size={18} />
            {t("close")}
          </Button>
        </>
      );
    }

    // Console/emulated game with its ROM downloaded. If the emulator isn't
    // installed yet, the button routes to setup ("Set up emulator") instead of
    // offering a Play that would fail; once ready it becomes Play.
    if (isClassicsLaunchable) {
      if (emulatorReady === false) {
        return (
          <Button
            onClick={() => navigate(emulatorSetupPath)}
            theme="outline"
            disabled={deleting}
            className="hero-panel-actions__action"
          >
            <GearIcon />
            {t("setup_emulator", { defaultValue: "Set up emulator" })}
          </Button>
        );
      }
      return (
        <Button
          onClick={openClassicsGame}
          theme="outline"
          disabled={deleting || isGameRunning}
          className="hero-panel-actions__action"
        >
          <PlayIcon />
          {t("play")}
        </Button>
      );
    }

    // Confirmed installed → Play (local exe) or Launch (installed launcher game).
    if (isLaunchable) {
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

    // Not installed — whether the game is owned-on-platform (Steam/EA/Xbox/…) or
    // a catalogue repack (Retigga), the single entry point is the download
    // options modal. It lists the official "you own this game — download via
    // <platform>" link AND every available repack, so a separate "Install via
    // <platform>" button would be redundant.
    return (
      <Button
        onClick={openDownloadOptions}
        theme="outline"
        disabled={isGameDownloading || deleting}
        className={`hero-panel-actions__action ${!hasDownloadOptions ? "hero-panel-actions__action--disabled" : ""}`}
      >
        <DownloadIcon />
        {hasDownloadOptions ? t("open_download_options") : t("download")}
      </Button>
    );
  };

  // Warns before downloading a console ROM whose emulator isn't set up yet.
  // Included in every return branch so it works whether or not the game is in
  // the library.
  const emulatorSetupPrompt = (
    <Modal
      visible={showEmulatorSetupPrompt}
      title={t("emulator_setup_required_title", {
        defaultValue: "Emulator not set up",
      })}
      description={t("emulator_setup_required_description", {
        defaultValue:
          "You'll need to set up the emulator for this console before you can play. You can download the game now and set it up anytime from Settings → Emulation.",
      })}
      onClose={() => setShowEmulatorSetupPrompt(false)}
    >
      <div className="hero-panel-actions__prompt-actions">
        <Button
          theme="outline"
          onClick={() => {
            setShowEmulatorSetupPrompt(false);
            navigate(emulatorSetupPath);
          }}
        >
          <GearIcon />
          {t("setup_emulator", { defaultValue: "Set up emulator" })}
        </Button>
        <Button
          theme="primary"
          onClick={() => {
            setShowEmulatorSetupPrompt(false);
            setShowRepacksModal(true);
          }}
        >
          <DownloadIcon />
          {t("download_anyway", { defaultValue: "Download anyway" })}
        </Button>
      </div>
    </Modal>
  );

  if (repacks.length && !game) {
    return (
      <>
        {emulatorSetupPrompt}
        {addGameToLibraryButton}
        {showDownloadOptionsButton}
      </>
    );
  }

  const alternativeShopLaunchButtons = game?.alternativeShops
    ?.filter(
      (alt) =>
        alt.executablePath &&
        // Only show a launch button when the alt-shop executable is a real
        // local path OR when the platform confirms it's installed. Protocol
        // URIs (origin2://, msxbox://, …) are stamped for every OWNED game
        // regardless of install state — don't show "Launch via X" for those.
        !PLATFORM_URI_RE.test(alt.executablePath)
    )
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
    // The secondary "Open download options" button is only useful once the game
    // is launchable (the primary button is Play/Launch). When the game isn't
    // installed the primary button is ALREADY the download-options entry, so we
    // must not duplicate it here.
    const showRepackDownloadForLibraryGame = isLaunchable && hasDownloadOptions;

    return (
      <div className="hero-panel-actions__container">
        {emulatorSetupPrompt}
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
