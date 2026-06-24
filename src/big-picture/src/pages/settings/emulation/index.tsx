import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { EmulatorConfig, EmulatorConfigMap, EmulatorSystem } from "@types";

import {
  Button,
  FocusItem,
  GridFocusGroup,
  VerticalFocusGroup,
} from "../../../components";
import { useNavigationActions } from "../../../hooks";
import {
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_CLOUD_SAVES_REGION_ID,
  EMULATION_DETAIL_MEMORY_CARDS_REGION_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_OVERVIEW_CARD_FOCUS_IDS,
  EMULATION_OVERVIEW_REGION_ID,
} from "../settings-navigation";
import { CloudSavesSection } from "./cloud-saves-section";
import { MemoryCardsSection } from "./memory-cards-section";
import "./styles.scss";

const SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

const SYSTEM_LABELS: Record<EmulatorSystem, string> = {
  ps1: "PlayStation 1",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
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

  const isPs3 = config.system === "ps3";
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

        {!isPs3 && (
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

        {isPs3 && (
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
        {detected && (
          <span className="emulation-settings__console-badge">Configured</span>
        )}
      </button>
    </FocusItem>
  );
}

export function EmulationSettingsSection() {
  const { t } = useTranslation("settings");
  const { setFocus } = useNavigationActions();
  const [configs, setConfigs] = useState<EmulatorConfigMap | null>(null);
  const [activeSystem, setActiveSystem] = useState<EmulatorSystem | null>(null);

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

  const handleBack = useCallback(async () => {
    setActiveSystem(null);
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

      <GridFocusGroup regionId={EMULATION_OVERVIEW_REGION_ID}>
        {cardItems.map(({ system, config, focusId }) => (
          <ConsoleOverviewCard
            key={system}
            system={system}
            config={config}
            focusId={focusId}
            onSelect={() => setActiveSystem(system)}
          />
        ))}
      </GridFocusGroup>
    </div>
  );
}
