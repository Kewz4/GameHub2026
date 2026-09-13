import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FileDirectoryIcon, XIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import {
  buildGameDetailsPath,
  generateRandomGradient,
} from "@renderer/helpers";
import type { GameShop } from "@types";
import { LINUX_GAME_EXECUTABLE_EXTENSIONS } from "@shared";
import {
  useSteamMatchSearch,
  type SteamMatchSuggestion,
} from "@renderer/hooks/use-steam-match-search";

import "./sidebar-adding-custom-game-modal.scss";

export interface SidebarAddingCustomGameModalProps {
  visible: boolean;
  onClose: () => void;
}

interface ResolvedInfo {
  objectId: string | null;
  shop: GameShop | null;
  iconUrl: string | null;
  coverImageUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  libraryImageUrl: string | null;
}

export function SidebarAddingCustomGameModal({
  visible,
  onClose,
}: Readonly<SidebarAddingCustomGameModalProps>) {
  const { t } = useTranslation("sidebar");
  const { updateLibrary } = useLibrary();
  const { showSuccessToast, showErrorToast } = useToast();
  const navigate = useNavigate();

  const [gameName, setGameName] = useState("");
  const [executablePath, setExecutablePath] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [matchedGame, setMatchedGame] = useState<SteamMatchSuggestion | null>(
    null
  );
  const resolvedInfoRef = useRef<ResolvedInfo | null>(null);
  const {
    suggestions: steamSuggestions,
    isSearching: isSearchingSteam,
    clearSuggestions,
  } = useSteamMatchSearch(gameName, visible && !matchedGame && !isAdding);

  const handleSelectExecutable = async () => {
    const filters =
      window.electron.platform === "linux"
        ? [
            {
              name: t("custom_game_modal_executable"),
              extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS,
            },
            { name: t("all_files", { ns: "game_details" }), extensions: ["*"] },
          ]
        : [
            {
              name: t("custom_game_modal_executable"),
              extensions: [
                "exe",
                "msi",
                "bat",
                "cmd",
                "app",
                "deb",
                "rpm",
                "dmg",
              ],
            },
          ];

    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters,
    });

    if (!filePaths || filePaths.length === 0) return;

    const selectedPath = filePaths[0];
    setExecutablePath(selectedPath);
    resolvedInfoRef.current = null;
    setMatchedGame(null);

    // Don't overwrite a name the user already typed
    if (!gameName.trim()) {
      setIsResolving(true);
      try {
        const info = await window.electron.resolveCustomGameInfo(selectedPath);
        setGameName(info.title);
        resolvedInfoRef.current = {
          objectId: info.objectId,
          shop: info.shop,
          iconUrl: info.iconUrl,
          coverImageUrl: info.coverImageUrl,
          libraryHeroImageUrl: info.libraryHeroImageUrl,
          logoImageUrl: info.logoImageUrl,
          libraryImageUrl: info.libraryImageUrl,
        };
        if (info.shop === "steam" && info.objectId) {
          setMatchedGame({
            title: info.title,
            objectId: info.objectId,
            shop: "steam",
            iconUrl: info.iconUrl,
          });
          clearSuggestions();
        }
      } catch {
        const fileName = selectedPath.split(/[\\/]/).pop() || "";
        setGameName(fileName.replace(/\.[^/.]+$/, ""));
      } finally {
        setIsResolving(false);
      }
    }
  };

  const handleGameNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGameName(event.target.value);
    // Name was edited manually — clear catalogue match so we don't use stale assets
    resolvedInfoRef.current = null;
    setMatchedGame(null);
  };

  const handleSelectSteamMatch = async (suggestion: SteamMatchSuggestion) => {
    setMatchedGame(suggestion);
    setGameName(suggestion.title);
    clearSuggestions();
    setIsResolving(true);

    try {
      const assets = await window.electron.getGameAssets(
        suggestion.objectId,
        "steam",
        suggestion.title
      );
      resolvedInfoRef.current = {
        objectId: suggestion.objectId,
        shop: "steam",
        iconUrl: assets?.iconUrl ?? suggestion.iconUrl,
        coverImageUrl: assets?.coverImageUrl ?? null,
        libraryHeroImageUrl: assets?.libraryHeroImageUrl ?? null,
        logoImageUrl: assets?.logoImageUrl ?? null,
        libraryImageUrl: assets?.libraryImageUrl ?? null,
      };
    } catch {
      resolvedInfoRef.current = {
        objectId: suggestion.objectId,
        shop: "steam",
        iconUrl: suggestion.iconUrl,
        coverImageUrl: null,
        libraryHeroImageUrl: null,
        logoImageUrl: null,
        libraryImageUrl: null,
      };
    } finally {
      setIsResolving(false);
    }
  };

  const handleClearSteamMatch = () => {
    setMatchedGame(null);
    resolvedInfoRef.current = null;
  };

  const handleAddGame = async () => {
    if (!gameName.trim() || !executablePath.trim()) {
      showErrorToast(t("custom_game_modal_fill_required"));
      return;
    }

    setIsAdding(true);

    try {
      const info = resolvedInfoRef.current;
      const heroUrl = info?.libraryHeroImageUrl ?? generateRandomGradient();

      const newGame = await window.electron.addCustomGameToLibrary(
        gameName.trim(),
        executablePath,
        info?.iconUrl ?? "",
        info?.logoImageUrl ?? "",
        heroUrl,
        info?.coverImageUrl ?? undefined,
        info?.libraryImageUrl ?? undefined,
        matchedGame?.objectId ?? null
      );

      showSuccessToast(t("custom_game_modal_success"));
      await updateLibrary();

      navigate(
        buildGameDetailsPath({
          shop: newGame.shop,
          objectId: newGame.objectId,
          title: newGame.title,
        })
      );

      setGameName("");
      setExecutablePath("");
      resolvedInfoRef.current = null;
      setMatchedGame(null);
      onClose();
    } catch (error) {
      console.error("Failed to add custom game:", error);
      showErrorToast(
        error instanceof Error ? error.message : t("custom_game_modal_failed")
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleClose = () => {
    if (!isAdding && !isResolving) {
      setGameName("");
      setExecutablePath("");
      resolvedInfoRef.current = null;
      setMatchedGame(null);
      onClose();
    }
  };

  const isBusy = isAdding || isResolving;
  const isFormValid = gameName.trim() && executablePath.trim();

  return (
    <Modal
      visible={visible}
      title={t("custom_game_modal")}
      description={t("custom_game_modal_description")}
      onClose={handleClose}
    >
      <div className="sidebar-adding-custom-game-modal__container">
        <div className="sidebar-adding-custom-game-modal__form">
          <TextField
            label={t("custom_game_modal_executable_path")}
            placeholder={t("custom_game_modal_select_executable")}
            value={executablePath}
            readOnly
            theme="dark"
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleSelectExecutable}
                disabled={isBusy}
              >
                <FileDirectoryIcon />
                {t("custom_game_modal_browse")}
              </Button>
            }
          />

          <TextField
            label={t("custom_game_modal_title")}
            placeholder={
              isResolving
                ? "Detecting game name…"
                : t("custom_game_modal_enter_title")
            }
            value={gameName}
            onChange={handleGameNameChange}
            theme="dark"
            disabled={isBusy}
          />

          {matchedGame ? (
            <div className="sidebar-adding-custom-game-modal__match">
              {matchedGame.iconUrl ? (
                <img
                  src={matchedGame.iconUrl}
                  alt=""
                  className="sidebar-adding-custom-game-modal__match-icon"
                />
              ) : null}
              <span className="sidebar-adding-custom-game-modal__match-label">
                {t("custom_game_modal_match_selected", {
                  title: matchedGame.title,
                })}
              </span>
              <button
                type="button"
                className="sidebar-adding-custom-game-modal__match-clear"
                onClick={handleClearSteamMatch}
                disabled={isBusy}
                aria-label={t("custom_game_modal_match_clear")}
              >
                <XIcon size={14} />
              </button>
            </div>
          ) : (
            (isSearchingSteam || steamSuggestions.length > 0) && (
              <div className="sidebar-adding-custom-game-modal__suggestions">
                <span className="sidebar-adding-custom-game-modal__suggestions-title">
                  {isSearchingSteam
                    ? t("custom_game_modal_match_searching")
                    : t("custom_game_modal_match_steam_title")}
                </span>
                <ul className="sidebar-adding-custom-game-modal__suggestions-list">
                  {steamSuggestions.map((suggestion) => (
                    <li key={suggestion.objectId}>
                      <button
                        type="button"
                        className="sidebar-adding-custom-game-modal__suggestion"
                        onClick={() => {
                          void handleSelectSteamMatch(suggestion);
                        }}
                        disabled={isBusy}
                      >
                        {suggestion.iconUrl ? (
                          <img src={suggestion.iconUrl} alt="" />
                        ) : null}
                        <span>{suggestion.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        <div className="sidebar-adding-custom-game-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isBusy}
          >
            {t("custom_game_modal_cancel")}
          </Button>
          <Button
            type="button"
            theme="primary"
            onClick={handleAddGame}
            disabled={!isFormValid || isBusy}
          >
            {isResolving
              ? "Detecting…"
              : isAdding
                ? t("custom_game_modal_adding")
                : t("custom_game_modal_add")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
