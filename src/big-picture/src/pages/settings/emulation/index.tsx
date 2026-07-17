import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  EmulatorBinary,
  EmulatorConfig,
  EmulatorConfigMap,
  EmulatorSystem,
} from "@types";

import {
  Button,
  FocusItem,
  GridFocusGroup,
  Input,
  VerticalFocusGroup,
} from "../../../components";
import { useNavigationActions, useUserPreferences } from "../../../hooks";
import {
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_CLOUD_SAVES_REGION_ID,
  EMULATION_DETAIL_MEMORY_CARDS_REGION_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  EMULATION_OVERVIEW_REGION_ID,
} from "../settings-navigation";
import { CloudSavesSection } from "./cloud-saves-section";
import { ControllerMapperModal } from "./controller/controller-mapper-modal";
import { MemoryCardsSection } from "./memory-cards-section";
import { EmulatorSetupModal } from "./setup/emulator-setup-modal";
import "./styles.scss";

const SYSTEMS: EmulatorSystem[] = [
  "ps1",
  "ps2",
  "ps3",
  "psp",
  "n3ds",
  "nds",
  "dsi",
  "n64",
  "gb",
  "gbc",
  "gba",
  "wiiu",
  "wii",
  "gc",
];

const SYSTEM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  psp: "PSP",
  n3ds: "Nintendo 3DS",
  nds: "Nintendo DS",
  dsi: "Nintendo DSi",
  n64: "Nintendo 64",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  wiiu: "Wii U",
  wii: "Wii",
  gc: "GameCube",
  switch: "Nintendo Switch",
};

interface EmulationDetailProps {
  config: EmulatorConfig;
  onBack: () => void;
}

function EmulationDetail({ config, onBack }: Readonly<EmulationDetailProps>) {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigationActions();

  useEffect(() => {
    setFocus(EMULATION_DETAIL_BACK_BUTTON_ID);
  }, [setFocus]);

  const hasMemcards = config.system === "ps1" || config.system === "ps2";
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);

  return (
    <VerticalFocusGroup regionId={EMULATION_DETAIL_REGION_ID}>
      <div className="emulation-settings__detail">
        <div className="emulation-settings__detail-header">
          <FocusItem
            id={EMULATION_DETAIL_BACK_BUTTON_ID}
            actions={{ primary: onBack }}
          >
            <Button
              variant="secondary"
              onClick={onBack}
              className="emulation-settings__back-button"
            >
              ← {t("back", "Back")}
            </Button>
          </FocusItem>

          <h2 className="emulation-settings__detail-title">
            {SYSTEM_LABELS[config.system]}
          </h2>
        </div>

        {hasMemcards && (
          <>
            <VerticalFocusGroup
              regionId={EMULATION_DETAIL_MEMORY_CARDS_REGION_ID}
            >
              <MemoryCardsSection
                config={config}
                upTargetId={EMULATION_DETAIL_BACK_BUTTON_ID}
                downTargetId={EMULATION_DETAIL_CLOUD_SAVES_REGION_ID}
                onUploaded={() => setCloudRefreshKey((k) => k + 1)}
              />
            </VerticalFocusGroup>

            <VerticalFocusGroup
              regionId={EMULATION_DETAIL_CLOUD_SAVES_REGION_ID}
            >
              <CloudSavesSection
                config={config}
                refreshKey={cloudRefreshKey}
                upTargetId={EMULATION_DETAIL_MEMORY_CARDS_REGION_ID}
              />
            </VerticalFocusGroup>
          </>
        )}

        {!hasMemcards && (
          <p className="emulation-settings__ps3-note">
            {t("ps3_cloud_saves_coming_soon", "PS3 cloud saves coming soon.")}
          </p>
        )}
      </div>
    </VerticalFocusGroup>
  );
}

interface ConsoleOverviewCardProps {
  system: EmulatorSystem;
  config: EmulatorConfig;
  focusId: string;
  onSelect: () => void;
}

function ConsoleOverviewCard({
  system,
  config,
  focusId,
  onSelect,
}: Readonly<ConsoleOverviewCardProps>) {
  const detected = config.detectedAt !== null;

  return (
    <FocusItem id={focusId} actions={{ primary: onSelect }}>
      <button
        className={`emulation-settings__console-card ${detected ? "emulation-settings__console-card--detected" : ""}`}
        onClick={onSelect}
        type="button"
      >
        <span className="emulation-settings__console-label">
          {SYSTEM_LABELS[system]}
        </span>
        <span className="emulation-settings__console-badge">
          {detected ? "Configured ✓ · Manage" : "Set up"}
        </span>
      </button>
    </FocusItem>
  );
}

const RA_USERNAME_FOCUS_ID = "emulation-ra-username";
const RA_APIKEY_FOCUS_ID = "emulation-ra-apikey";
const RA_SAVE_FOCUS_ID = "emulation-ra-save";

function RetroAchievementsBpSection() {
  const userPreferences = useUserPreferences();
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!userPreferences) return;
    setUsername(userPreferences.retroAchievementsUsername ?? "");
    setApiKey(userPreferences.retroAchievementsApiKey ?? "");
  }, [userPreferences]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await globalThis.window.electron.updateUserPreferences({
        retroAchievementsUsername: username.trim() || undefined,
        retroAchievementsApiKey: apiKey.trim() || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <VerticalFocusGroup regionId="emulation-retroachievements-region" asChild>
      <div className="emulation-settings__retroachievements">
        <h2 className="emulation-settings__title">RetroAchievements</h2>
        <p className="emulation-settings__description">
          Enter your RetroAchievements username and web API key so unlocks pop
          up as notifications while you play.
        </p>
        <Input
          label="Username"
          value={username}
          placeholder="RetroAchievements username"
          focusId={RA_USERNAME_FOCUS_ID}
          autoComplete="off"
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          label="Web API key"
          type="password"
          value={apiKey}
          placeholder="Web API key"
          focusId={RA_APIKEY_FOCUS_ID}
          autoComplete="off"
          onChange={(e) => setApiKey(e.target.value)}
        />
        <FocusItem id={RA_SAVE_FOCUS_ID} actions={{ primary: handleSave }}>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !username.trim() || !apiKey.trim()}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </FocusItem>
      </div>
    </VerticalFocusGroup>
  );
}

export function EmulationSettingsSection() {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigationActions();
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [activeSystem, setActiveSystem] = useState<EmulatorSystem | null>(null);
  const [setupSystem, setSetupSystem] = useState<EmulatorSystem | null>(null);
  const [controllerTarget, setControllerTarget] = useState<{
    binary: EmulatorBinary;
    label: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    const next = await globalThis.window.electron.getEmulatorConfigs();
    setConfigs(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const initial = await globalThis.window.electron.getEmulatorConfigs();
      if (cancelled) return;
      setConfigs(initial);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeSystem) {
      setFocus(EMULATION_OVERVIEW_CARD_FOCUS_IDS.ps1);
    }
  }, [activeSystem, setFocus]);

  const cardItems = useMemo(() => {
    if (!configs) return [];
    return SYSTEMS.map((system) => ({
      system,
      config: configs[system],
      focusId:
        EMULATION_OVERVIEW_CARD_FOCUS_IDS[
          system as keyof typeof EMULATION_OVERVIEW_CARD_FOCUS_IDS
        ],
    }));
  }, [configs]);

  // One controller-mapper entry per configured emulator (deduped by binary,
  // since several systems can share one emulator binary).
  const configuredEmulators = useMemo(() => {
    if (!configs) return [];
    const seen = new Set<EmulatorBinary>();
    const out: { binary: EmulatorBinary; label: string }[] = [];
    for (const system of SYSTEMS) {
      const config = configs[system];
      if (config?.detectedAt == null) continue;
      if (seen.has(config.binary)) continue;
      seen.add(config.binary);
      out.push({ binary: config.binary, label: SYSTEM_LABELS[system] });
    }
    return out;
  }, [configs]);

  const handleBack = useCallback(async () => {
    setActiveSystem(null);
    await refresh();
  }, [refresh]);

  const handleSelectSystem = useCallback(
    (system: EmulatorSystem) => {
      const config = configs?.[system];
      const detected = config?.detectedAt != null;
      // Configured PS1/PS2 have a dedicated management view (memory cards +
      // cloud saves); everything else opens the guided setup/manage wizard.
      if (detected && (system === "ps1" || system === "ps2")) {
        setActiveSystem(system);
      } else {
        setSetupSystem(system);
      }
    },
    [configs]
  );

  const handleSetupClose = useCallback(async () => {
    setSetupSystem(null);
    await refresh();
  }, [refresh]);

  const handleSetupComplete = useCallback(async () => {
    setSetupSystem(null);
    await refresh();
  }, [refresh]);

  if (activeSystem && configs) {
    return (
      <EmulationDetail config={configs[activeSystem]} onBack={handleBack} />
    );
  }

  if (!configs) {
    return (
      <div className="emulation-settings__loading">
        {t("loading", "Loading…")}
      </div>
    );
  }

  return (
    <div className="emulation-settings">
      <header className="emulation-settings__header">
        <h2 className="emulation-settings__title">
          {t("emulation", "Emulation")}
        </h2>
        <p className="emulation-settings__description">
          {t(
            "emulation_description",
            "Manage emulator settings, memory cards, and cloud saves."
          )}
        </p>
      </header>

      <RetroAchievementsBpSection />

      <GridFocusGroup regionId={EMULATION_OVERVIEW_REGION_ID}>
        {cardItems.map(({ system, config, focusId }) => (
          <ConsoleOverviewCard
            key={system}
            system={system}
            config={config}
            focusId={focusId}
            onSelect={() => handleSelectSystem(system)}
          />
        ))}
      </GridFocusGroup>

      {configuredEmulators.length > 0 && (
        <section className="emulation-settings__controllers">
          <h2 className="emulation-settings__title">
            {t("controllers", "Controllers")}
          </h2>
          <p className="emulation-settings__description">
            {t(
              "controllers_description",
              "Configure your controller mapping for each installed emulator."
            )}
          </p>
          <VerticalFocusGroup regionId="emulation-controllers-region">
            {configuredEmulators.map(({ binary, label }) => (
              <Button
                key={binary}
                focusId={`emulation-controller-${binary}`}
                variant="secondary"
                onClick={() => setControllerTarget({ binary, label })}
              >
                {label} controller
              </Button>
            ))}
          </VerticalFocusGroup>
        </section>
      )}

      <ControllerMapperModal
        visible={controllerTarget !== null}
        binary={controllerTarget?.binary ?? "ralibretro"}
        emulatorLabel={controllerTarget?.label ?? ""}
        onClose={() => setControllerTarget(null)}
      />

      <EmulatorSetupModal
        visible={setupSystem !== null}
        system={setupSystem}
        systemLabel={setupSystem ? SYSTEM_LABELS[setupSystem] : ""}
        initialConfig={setupSystem ? (configs[setupSystem] ?? null) : null}
        onClose={handleSetupClose}
        onComplete={handleSetupComplete}
      />
    </div>
  );
}
