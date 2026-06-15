import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon } from "@primer/octicons-react";
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
import { SettingsEa } from "./settings-ea";
import { useAppSelector, useUserDetails } from "@renderer/hooks";

interface IntegrationItemProps {
  id: string;
  title: string;
  connected?: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}

function IntegrationItem({
  id,
  title,
  connected,
  expanded,
  onToggle,
  children,
}: Readonly<IntegrationItemProps>) {
  return (
    <div className="settings-integration-item">
      <button
        type="button"
        className="settings-integration-item__header"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon size={14} />
        ) : (
          <ChevronRightIcon size={14} />
        )}
        <span className="settings-integration-item__title">{title}</span>
        {connected !== undefined && (
          <span
            className={`settings-integration-item__chip ${connected ? "settings-integration-item__chip--connected" : ""}`}
          >
            {connected ? "Connected" : "Not connected"}
          </span>
        )}
      </button>
      {expanded && (
        <div className="settings-integration-item__body">{children}</div>
      )}
    </div>
  );
}

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");
  const { userDetails } = useUserDetails();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!userDetails) {
    return (
      <div className="settings-context-panel">
        <div className="settings-context-panel__group">
          <p style={{ opacity: 0.7 }}>{t("integrations_sign_in_required")}</p>
        </div>
      </div>
    );
  }

  // Wait for preferences to load from LevelDB before rendering — avoids the
  // brief "not connected" flash on every account section
  if (userPreferences === null) {
    return (
      <div className="settings-context-panel">
        <div className="settings-context-panel__group">
          <p style={{ opacity: 0.5 }}>Loading…</p>
        </div>
      </div>
    );
  }

  const libraries: Array<{
    id: string;
    title: string;
    connected?: boolean;
    content: React.ReactNode;
  }> = [
    {
      id: "steam",
      title: t("steam_account"),
      connected: Boolean(userPreferences.steamId),
      content: <SettingsSteamAccount />,
    },
    {
      id: "epic",
      title: t("epic_games"),
      connected: Boolean(userPreferences.epicAccountName),
      content: <SettingsEpicAccount />,
    },
    {
      id: "gog",
      title: t("gog_account"),
      connected: Boolean(userPreferences.gogRefreshToken),
      content: <SettingsGogAccount />,
    },
    {
      id: "battlenet",
      title: t("battlenet_account"),
      content: <SettingsBattleNet />,
    },
    {
      id: "xbox",
      title: t("xbox_game_pass"),
      connected: Boolean(userPreferences.xboxGamertag),
      content: <SettingsXbox />,
    },
    {
      id: "riot",
      title: "Riot Games",
      content: <SettingsRiot />,
    },
    {
      id: "ubisoft",
      title: "Ubisoft Connect",
      connected: Boolean(userPreferences.ubisoftTicket),
      content: <SettingsUbisoft />,
    },
    {
      id: "ea",
      title: "EA app",
      connected: Boolean(userPreferences.eaAccessToken),
      content: <SettingsEa />,
    },
  ];

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>Libraries</h3>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.875em" }}>
          Connect your store accounts to import and sync your game libraries.
        </p>
        <div className="settings-integration-list">
          {libraries.map(({ id, title, connected, content }) => (
            <IntegrationItem
              key={id}
              id={id}
              title={title}
              connected={connected}
              expanded={expanded.has(id)}
              onToggle={toggle}
            >
              {content}
            </IntegrationItem>
          ))}
          <IntegrationItem
            id="exclusion-list"
            title="Excluded Games"
            expanded={expanded.has("exclusion-list")}
            onToggle={toggle}
          >
            <SettingsExclusionList />
          </IntegrationItem>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>Backups &amp; Imports</h3>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.875em" }}>
          Bring saves and playtime over from other tools.
        </p>
        <div className="settings-integration-list">
          <IntegrationItem
            id="ludusavi"
            title="Import Ludusavi Backup"
            expanded={expanded.has("ludusavi")}
            onToggle={toggle}
          >
            <SettingsLudusaviImport />
          </IntegrationItem>
          <IntegrationItem
            id="playnite"
            title="Import Playnite Playtime"
            expanded={expanded.has("playnite")}
            onToggle={toggle}
          >
            <SettingsPlayniteImport />
          </IntegrationItem>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>Premium Clients</h3>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "0.875em" }}>
          Debrid and download services.
        </p>
        <div className="settings-integration-list">
          <IntegrationItem
            id="debrid"
            title={t("debrid_services")}
            expanded={expanded.has("debrid")}
            onToggle={toggle}
          >
            <SettingsDebrid />
          </IntegrationItem>
        </div>
      </div>
    </div>
  );
}
