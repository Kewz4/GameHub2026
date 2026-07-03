import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { DeviceDesktopIcon } from "@primer/octicons-react";

import type { EmulatorSystem } from "@types";

import { Button } from "@renderer/components";
import { RetroAchievementsSection } from "./retroachievements-section";
import { MinervaCatalogueSection } from "./minerva-catalogue-section";
import { EmulationManagerModal } from "./emulation-manager-modal";
import {
  ClassicsOnboardingModal,
  hasDismissedClassicsOnboarding,
} from "@renderer/components/classics-onboarding-modal/classics-onboarding-modal";

import "./settings-context-emulation.scss";

export function SettingsContextEmulation() {
  const { t } = useTranslation("settings");
  const [searchParams] = useSearchParams();

  const [managerOpen, setManagerOpen] = useState(false);
  const [deepLinkSystem, setDeepLinkSystem] = useState<EmulatorSystem | null>(
    null
  );
  const deepLinkAppliedRef = useRef(false);

  const [showClassicsOnboarding, setShowClassicsOnboarding] = useState(false);
  const classicsOnboardingTriggeredRef = useRef(false);

  useEffect(() => {
    if (
      !classicsOnboardingTriggeredRef.current &&
      !hasDismissedClassicsOnboarding()
    ) {
      classicsOnboardingTriggeredRef.current = true;
      setShowClassicsOnboarding(true);
    }
  }, []);

  // Deep-link (?system=n64) opens the manager on that console's emulator.
  useEffect(() => {
    if (deepLinkAppliedRef.current) return;
    const system = searchParams.get("system");
    if (system) {
      deepLinkAppliedRef.current = true;
      setDeepLinkSystem(system as EmulatorSystem);
      setManagerOpen(true);
    }
  }, [searchParams]);

  return (
    <div className="settings-emulation">
      <ClassicsOnboardingModal
        visible={showClassicsOnboarding}
        onClose={() => setShowClassicsOnboarding(false)}
      />

      <header className="settings-emulation__header">
        <div className="settings-emulation__title-row">
          <h2 className="settings-emulation__title">{t("emulation")}</h2>
          <span className="settings-emulation__new-badge">
            {t("new_badge")}
          </span>
        </div>
        <p className="settings-emulation__description">
          {t("emulation_description")}
        </p>
        <p className="settings-emulation__disclaimer">
          {t("emulation_disclaimer")}
        </p>
      </header>

      <div className="settings-emulation__manager-launcher">
        <div className="settings-emulation__manager-text">
          <h3>{t("emulation_manager_title", { defaultValue: "Emulators" })}</h3>
          <p>
            {t("emulation_manager_launcher_description", {
              defaultValue:
                "Manage every emulator, its platforms, controls, ROM folders and library in one place.",
            })}
          </p>
        </div>
        <Button
          theme="primary"
          onClick={() => {
            setDeepLinkSystem(null);
            setManagerOpen(true);
          }}
        >
          <DeviceDesktopIcon size={16} />
          {t("open_emulation_manager", {
            defaultValue: "Open emulator manager",
          })}
        </Button>
      </div>

      <RetroAchievementsSection />
      <MinervaCatalogueSection />

      <EmulationManagerModal
        visible={managerOpen}
        initialSystem={deepLinkSystem}
        onClose={() => setManagerOpen(false)}
      />
    </div>
  );
}
