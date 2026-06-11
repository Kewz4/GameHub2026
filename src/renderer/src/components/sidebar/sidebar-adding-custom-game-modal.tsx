import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FileDirectoryIcon } from "@primer/octicons-react";

import { Modal, TextField, Button } from "@renderer/components";
import { useLibrary, useToast } from "@renderer/hooks";
import {
  buildGameDetailsPath,
  generateRandomGradient,
} from "@renderer/helpers";
import type { GameShop } from "@types";

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
  const resolvedInfoRef = useRef<ResolvedInfo | null>(null);

  const handleSelectExecutable = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: t("custom_game_modal_executable"),
          extensions: ["exe", "msi", "app", "deb", "rpm", "dmg"],
        },
      ],
    });

    if (!filePaths || filePaths.length === 0) return;

    const selectedPath = filePaths[0];
    setExecutablePath(selectedPath);
    resolvedInfoRef.current = null;

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
        info?.libraryImageUrl ?? undefined
      );

      showSuccessToast(t("custom_game_modal_success"));
      updateLibrary();

      navigate(
        buildGameDetailsPath({
          shop: "custom",
          objectId: newGame.objectId,
          title: newGame.title,
        })
      );

      setGameName("");
      setExecutablePath("");
      resolvedInfoRef.current = null;
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
