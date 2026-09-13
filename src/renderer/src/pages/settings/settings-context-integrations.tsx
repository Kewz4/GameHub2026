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
import { SettingsSpotify } from "./settings-spotify";
import { useAppSelector } from "@renderer/hooks";
import { HelperText, SectionHeading } from "@renderer/components";

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
  const { t } = useTranslation("settings");
  const triggerId = `settings-integration-trigger-${id}`;
  const panelId = `settings-integration-panel-${id}`;

  return (
    <div className="settings-integration-item" data-settings-integration={id}>
      <button
        id={triggerId}
        type="button"
        className="settings-integration-item__header"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        {expanded ? (
          <ChevronDownIcon size={14} aria-hidden="true" />
        ) : (
          <ChevronRightIcon size={14} aria-hidden="true" />
        )}
        <span className="settings-integration-item__title">{title}</span>
        {connected !== undefined && (
          <span
            className={`settings-integration-item__chip ${connected ? "settings-integration-item__chip--connected" : ""}`}
          >
            {connected
              ? t("connected", { defaultValue: "Connected" })
              : t("not_connected", { defaultValue: "Not connected" })}
          </span>
        )}
      </button>
      {expanded && (
        <div
          id={panelId}
          className="settings-integration-item__body"
          role="region"
          aria-labelledby={triggerId}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function SettingsContextIntegrations() {
  const { t } = useTranslation("settings");
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

  // NOTE: no Hydra sign-in gate here. Library sync talks to each store
  // directly (Steam/Epic/GOG/...) and never needs a Hydra account — gating on
  // userDetails made every "Sync Library" unreachable for signed-out users.

  // Wait for preferences to load from LevelDB before rendering — avoids the
  // brief "not connected" flash on every account section
  if (userPreferences === null) {
    return (
      <div className="settings-context-panel">
        <div className="settings-context-panel__group">
          <HelperText tone="faint">
            {t("loading", { defaultValue: "Loading…" })}
          </HelperText>
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
        <SectionHeading
          title={t("music_providers", { defaultValue: "Music providers" })}
          hint={t("music_providers_hint", {
            defaultValue:
              "Choose an optional music source while GameHub Music remains the default.",
          })}
        />
        <div className="settings-integration-list">
          <IntegrationItem
            id="spotify"
            title="Spotify Connect"
            expanded={expanded.has("spotify")}
            onToggle={toggle}
          >
            <SettingsSpotify />
          </IntegrationItem>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading
          title={t("libraries", { defaultValue: "Libraries" })}
          hint={t("libraries_hint", {
            defaultValue:
              "Connect your store accounts to import and sync your game libraries.",
          })}
        />
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
            title={t("excluded_games", { defaultValue: "Excluded games" })}
            expanded={expanded.has("exclusion-list")}
            onToggle={toggle}
          >
            <SettingsExclusionList />
          </IntegrationItem>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading
          title={t("backups_and_imports", {
            defaultValue: "Backups & Imports",
          })}
          hint={t("backups_and_imports_hint", {
            defaultValue: "Bring saves and playtime over from other tools.",
          })}
        />
        <div className="settings-integration-list">
          <IntegrationItem
            id="ludusavi"
            title={t("import_ludusavi_backup", {
              defaultValue: "Import Ludusavi backup",
            })}
            expanded={expanded.has("ludusavi")}
            onToggle={toggle}
          >
            <SettingsLudusaviImport />
          </IntegrationItem>
          <IntegrationItem
            id="playnite"
            title={t("import_playnite_playtime", {
              defaultValue: "Import Playnite playtime",
            })}
            expanded={expanded.has("playnite")}
            onToggle={toggle}
          >
            <SettingsPlayniteImport />
          </IntegrationItem>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <SectionHeading
          title={t("premium_clients", { defaultValue: "Premium clients" })}
          hint={t("premium_clients_hint", {
            defaultValue: "Debrid and download services.",
          })}
        />
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
