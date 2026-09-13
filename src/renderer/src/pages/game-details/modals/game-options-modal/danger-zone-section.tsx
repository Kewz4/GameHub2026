import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import type { LibraryGame, UserDetails } from "@types";

interface DangerZoneSectionProps {
  game: LibraryGame;
  deleting: boolean;
  isDeletingAchievements: boolean;
  hasAchievements: boolean;
  isGameDownloading: boolean;
  userDetails: UserDetails | null;
  onOpenRemoveFromLibrary: () => void;
  onOpenResetAchievements: () => void;
  onOpenChangePlaytime: () => void;
  onOpenRemoveFiles: () => void;
  onUninstall: () => void;
}

export function DangerZoneSection({
  game,
  deleting,
  isDeletingAchievements,
  hasAchievements,
  isGameDownloading,
  userDetails,
  onOpenRemoveFromLibrary,
  onOpenResetAchievements,
  onOpenChangePlaytime,
  onOpenRemoveFiles,
  onUninstall,
}: Readonly<DangerZoneSectionProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="game-options-modal__danger-zone">
      <div className="game-options-modal__header">
        <h2>{t("danger_zone_section_title")}</h2>
        <h4 className="game-options-modal__danger-zone-description">
          {t("danger_zone_section_description")}
        </h4>
      </div>

      <div className="game-options-modal__danger-zone-buttons">
        <Button
          onClick={onOpenRemoveFromLibrary}
          theme="danger"
          disabled={deleting}
        >
          {t("remove_from_library")}
        </Button>

        {game.shop !== "custom" && hasAchievements && userDetails && (
          <Button
            onClick={onOpenResetAchievements}
            theme="danger"
            disabled={deleting || isDeletingAchievements}
          >
            {t("reset_achievements")}
          </Button>
        )}

        <Button onClick={onOpenChangePlaytime} theme="danger">
          {t("update_game_playtime")}
        </Button>

        {game.shop !== "custom" && game.download?.downloadPath && (
          <Button
            onClick={onOpenRemoveFiles}
            theme="danger"
            disabled={isGameDownloading || deleting}
          >
            {t("remove_files")}
          </Button>
        )}

        {(game.executablePath || game.download?.downloadPath) && (
          <Button
            onClick={onUninstall}
            theme="danger"
            disabled={deleting || isGameDownloading}
          >
            {t("uninstall_game", { defaultValue: "Uninstall Game" })}
          </Button>
        )}
      </div>
    </div>
  );
}
