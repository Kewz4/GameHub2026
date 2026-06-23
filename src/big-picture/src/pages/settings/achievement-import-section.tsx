import { useState } from "react";
import { Button, HorizontalFocusGroup } from "../../components";
import { useBigPictureToast } from "../../hooks";
import { SettingsSection } from "./settings-section";
import {
  INTEGRATIONS_ACHIEVEMENT_IMPORT_STEAM_ID,
  INTEGRATIONS_ACHIEVEMENT_IMPORT_EPIC_ID,
  INTEGRATIONS_ACHIEVEMENT_IMPORT_GOG_ID,
  INTEGRATIONS_ACHIEVEMENT_IMPORT_XBOX_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import type { FocusOverrideTarget } from "../../services";

type Platform = "steam" | "epic" | "gog" | "xbox";

const PLATFORMS: Array<{ id: Platform; label: string; focusId: string }> = [
  {
    id: "steam",
    label: "Steam",
    focusId: INTEGRATIONS_ACHIEVEMENT_IMPORT_STEAM_ID,
  },
  {
    id: "epic",
    label: "Epic",
    focusId: INTEGRATIONS_ACHIEVEMENT_IMPORT_EPIC_ID,
  },
  {
    id: "gog",
    label: "GOG",
    focusId: INTEGRATIONS_ACHIEVEMENT_IMPORT_GOG_ID,
  },
  {
    id: "xbox",
    label: "Xbox",
    focusId: INTEGRATIONS_ACHIEVEMENT_IMPORT_XBOX_ID,
  },
];

interface Props {
  upTarget: FocusOverrideTarget;
  downTarget: FocusOverrideTarget;
}

export function AchievementImportSection({ upTarget, downTarget }: Readonly<Props>) {
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [busyPlatform, setBusyPlatform] = useState<Platform | null>(null);

  const handleImport = async (platform: Platform, label: string) => {
    setBusyPlatform(platform);
    try {
      const result =
        await globalThis.window.electron.importPlatformAchievements(platform);
      if (result.totalUnlocked === 0) {
        showSuccessToast(`${label} achievements`, {
          fallbackVisual: "settings",
          message: `No unlocked achievements found (${result.gamesProcessed} games checked).`,
        });
      } else {
        showSuccessToast(`${label} achievements imported`, {
          fallbackVisual: "settings",
          message: `Imported ${result.totalUnlocked} achievements across ${result.gamesWithAchievements} games.`,
        });
      }
    } catch {
      showErrorToast(`${label} import failed`, { fallbackVisual: "settings" });
    } finally {
      setBusyPlatform(null);
    }
  };

  return (
    <SettingsSection
      title="Achievement Import"
      description="Pull your unlocked achievements from each connected platform into GameHub."
    >
      <HorizontalFocusGroup asChild>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {PLATFORMS.map((platform, index) => {
            const prev = PLATFORMS[index - 1];
            const next = PLATFORMS[index + 1];

            return (
              <Button
                key={platform.id}
                variant="secondary"
                disabled={busyPlatform !== null}
                loading={busyPlatform === platform.id}
                focusId={platform.focusId}
                focusNavigationOverrides={{
                  up: upTarget,
                  down: downTarget,
                  left: prev
                    ? { type: "item", itemId: prev.focusId }
                    : { type: "block" },
                  right: next
                    ? { type: "item", itemId: next.focusId }
                    : { type: "block" },
                }}
                onClick={() => void handleImport(platform.id, platform.label)}
              >
                {busyPlatform === platform.id
                  ? "Importing…"
                  : `Import from ${platform.label}`}
              </Button>
            );
          })}
        </div>
      </HorizontalFocusGroup>
    </SettingsSection>
  );
}
