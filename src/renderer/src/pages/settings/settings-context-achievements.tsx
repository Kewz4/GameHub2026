import { SectionHeading } from "@renderer/components";
import { SettingsExophase } from "./settings-exophase";

export function SettingsContextAchievements() {
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <SectionHeading
          title="Exophase"
          hint="GameHub uses your Exophase account as the single source for achievements across every store. Sign in once and your unlocked achievements are matched to the games in your library."
        />
        <SettingsExophase />
      </div>
    </div>
  );
}
