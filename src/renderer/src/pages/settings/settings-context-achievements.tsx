import { SettingsExophase } from "./settings-exophase";

export function SettingsContextAchievements() {
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>Exophase</h3>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.875em" }}>
          GameHub uses your Exophase account as the single source for
          achievements across every store. Sign in once and your unlocked
          achievements are matched to the games in your library.
        </p>
        <div style={{ marginTop: 16 }}>
          <SettingsExophase />
        </div>
      </div>
    </div>
  );
}
