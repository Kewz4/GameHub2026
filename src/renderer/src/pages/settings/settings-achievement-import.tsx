import { useState } from "react";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-logo.svg?react";
import GogLogo from "@renderer/assets/gog-logo.svg?react";
import XboxLogo from "@renderer/assets/xbox-logo.svg?react";

type Platform = "steam" | "epic" | "gog" | "xbox";

const PLATFORMS: Array<{
  id: Platform;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "steam", label: "Steam", icon: <SteamLogo width={16} height={16} /> },
  {
    id: "epic",
    label: "Epic Games",
    icon: <EpicLogo width={16} height={16} />,
  },
  { id: "gog", label: "GOG", icon: <GogLogo width={16} height={16} /> },
  { id: "xbox", label: "Xbox", icon: <XboxLogo width={16} height={16} /> },
];

export function SettingsAchievementImport() {
  const { showSuccessToast, showErrorToast } = useToast();
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);

  const handleImport = async (platform: Platform, label: string) => {
    setBusyPlatform(platform);
    try {
      const result = await window.electron.importPlatformAchievements(platform);
      if (result.totalUnlocked === 0) {
        showSuccessToast(
          `${label} Achievements`,
          `No unlocked achievements found (${result.gamesProcessed} games checked).`
        );
      } else {
        showSuccessToast(
          `${label} Achievements`,
          `Imported ${result.totalUnlocked} achievements across ${result.gamesWithAchievements} games.`
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      showErrorToast(`${label} Achievements`, msg);
    } finally {
      setBusyPlatform(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.7 }}>
        Pull your unlocked achievements from each connected platform into
        GameHub. Achievements are matched to the games in your library.
      </p>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {PLATFORMS.map((platform) => (
          <Button
            key={platform.id}
            type="button"
            theme="outline"
            disabled={busyPlatform !== null}
            onClick={() => handleImport(platform.id, platform.label)}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            {platform.icon}
            {busyPlatform === platform.id
              ? "Importing…"
              : `Import from ${platform.label}`}
          </Button>
        ))}
      </div>
    </div>
  );
}
