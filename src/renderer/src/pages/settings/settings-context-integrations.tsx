import { useTranslation } from "react-i18next";
import { SettingsDebrid } from "./settings-debrid";
import { SettingsSteamAccount } from "./settings-steam-account";
import { SettingsEpicAccount } from "./settings-epic-account";
import { SettingsGogAccount } from "./settings-gog-account";
import { SettingsBattleNet } from "./settings-battlenet";
import { SettingsXbox } from "./settings-xbox";
import { SettingsLudusaviImport } from "./settings-ludusavi-import";
import { SettingsPlayniteImport } from "./settings-playnite-import";
import { SettingsExclusionList } from "./settings-exclusion-list";
import { SettingsRiot } from "./settings-riot";
import { SettingsUbisoft } from "./settings-ubisoft";
import { SettingsAchievementImport } from "./settings-achievement-import";
import { useUserDetails } from "@renderer/hooks";

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");
  const { userDetails } = useUserDetails();

  if (!userDetails) {
    return (
      <div className="settings-context-panel">
        <div className="settings-context-panel__group">
          <p style={{ opacity: 0.7 }}>{t("integrations_sign_in_required")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("steam_account")}</h3>
        <SettingsSteamAccount />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("epic_games")}</h3>
        <SettingsEpicAccount />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gog_account")}</h3>
        <SettingsGogAccount />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("battlenet_account")}</h3>
        <SettingsBattleNet />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("xbox_game_pass")}</h3>
        <SettingsXbox />
      </div>

      <div className="settings-context-panel__group">
        <h3>Riot Games</h3>
        <SettingsRiot />
      </div>

      <div className="settings-context-panel__group">
        <h3>Ubisoft Connect</h3>
        <SettingsUbisoft />
      </div>

      <div className="settings-context-panel__group">
        <h3>Achievement Import</h3>
        <SettingsAchievementImport />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("debrid_services")}</h3>
        <SettingsDebrid />
      </div>

      <div className="settings-context-panel__group">
        <h3>Import Ludusavi Backup</h3>
        <SettingsLudusaviImport />
      </div>

      <div className="settings-context-panel__group">
        <h3>Import Playnite Playtime</h3>
        <SettingsPlayniteImport />
      </div>

      <div className="settings-context-panel__group">
        <h3>Excluded Games</h3>
        <SettingsExclusionList />
      </div>
    </div>
  );
}
