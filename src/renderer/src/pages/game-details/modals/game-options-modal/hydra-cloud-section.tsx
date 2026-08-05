import type { LibraryGame } from "@types";
import { CloudSyncPanel } from "../../cloud-sync/cloud-sync-panel";

interface HydraCloudSettingsSectionProps {
  game: LibraryGame;
  automaticCloudSync: boolean;
  onToggleAutomaticCloudSync: (
    event: React.ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
}

export function HydraCloudSettingsSection({
  game: _game,
  automaticCloudSync,
  onToggleAutomaticCloudSync,
}: Readonly<HydraCloudSettingsSectionProps>) {
  return (
    <div className="game-options-modal__cloud-panel">
      <CloudSyncPanel
        automaticCloudSync={automaticCloudSync}
        onToggleAutomaticCloudSync={onToggleAutomaticCloudSync}
      />
    </div>
  );
}
