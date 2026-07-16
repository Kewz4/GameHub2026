import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  CheckCircleFillIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig, EmulatorSystem } from "@types";

interface Props {
  system: EmulatorSystem;
  systemLabel: string;
  config: EmulatorConfig;
  onBiosStatusChange: (installed: boolean) => void;
  onSkip: () => void;
}

export function SetupStepBios({
  system,
  systemLabel,
  config,
  onBiosStatusChange,
  onSkip,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const probe = async () => {
    setChecking(true);
    try {
      const result = await window.electron.checkEmulatorBios(
        system,
        config.executablePath
      );
      setInstalled(result.installed);
      onBiosStatusChange(result.installed);
    } finally {
      setChecking(false);
    }
  };

  // In-wizard automatic BIOS download, awaited with progress, then re-probe.
  const autoDownload = async () => {
    if (!config.executablePath) {
      showErrorToast(t("bios_download_needs_emulator"));
      return;
    }
    setDownloading(true);
    setDownloadStatus(t("bios_download_starting"));
    const unsubscribe = window.electron.onBiosDownloadProgress((payload) => {
      if (payload.system !== system) return;
      const pct =
        payload.progress >= 0 ? ` ${Math.round(payload.progress * 100)}%` : "";
      setDownloadStatus(t(`bios_download_stage_${payload.stage}`) + pct);
    });
    try {
      const result = await window.electron.downloadEmulatorBios(system);
      if (result.ok) {
        setDownloadStatus(null);
        await probe();
      } else {
        showErrorToast(
          t("bios_download_failed", { error: result.error ?? "" })
        );
        setDownloadStatus(null);
      }
    } catch (error) {
      showErrorToast(
        t("bios_download_failed", {
          error: error instanceof Error ? error.message : "",
        })
      );
      setDownloadStatus(null);
    } finally {
      unsubscribe();
      setDownloading(false);
    }
  };

  useEffect(() => {
    probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepTwo =
    system === "ps1" ? t("setup_bios_step_2_ps1") : t("setup_bios_step_2_ps2");

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_step_bios", { system: systemLabel })}
      </h3>
      <div>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_bios_intro_1", { name: systemLabel })}
        </p>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_bios_intro_2")}
        </p>
      </div>

      <div className="setup-modal__numbered-list">
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">1</span>
          <span className="setup-modal__numbered-text">
            {t("setup_bios_step_1")}
          </span>
        </div>
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">2</span>
          <span className="setup-modal__numbered-text">{stepTwo}</span>
        </div>
      </div>

      {!installed && (
        <div className="setup-modal__auto-download">
          <Button
            theme="primary"
            onClick={autoDownload}
            disabled={downloading || checking}
          >
            {downloading
              ? (downloadStatus ??
                t("downloading", { defaultValue: "Downloading…" }))
              : t("setup_bios_auto_download", {
                  defaultValue: "Download & install BIOS automatically",
                })}
          </Button>
        </div>
      )}

      <div className="setup-modal__hint" style={{ justifyContent: "flex-end" }}>
        <button
          type="button"
          className="setup-modal__ghost-button"
          onClick={onSkip}
          disabled={downloading}
        >
          {t("setup_skip_later")}
        </button>
      </div>

      <div
        className="setup-modal__alert setup-modal__alert--neutral"
        style={{ marginTop: "auto" }}
      >
        <div
          className={`setup-modal__row-icon ${
            installed
              ? "setup-modal__row-icon--found"
              : "setup-modal__row-icon--neutral"
          }`}
          style={{ width: 36, height: 36 }}
        >
          {installed ? (
            <CheckCircleFillIcon size={16} />
          ) : (
            <ClockIcon size={16} />
          )}
        </div>
        <div className="setup-modal__alert-text">
          <span className="setup-modal__alert-title">
            {installed ? t("setup_bios_found") : t("setup_bios_not_yet")}
          </span>
          <span className="setup-modal__alert-note">
            {installed
              ? t("setup_bios_found_note")
              : t("setup_bios_recheck_note")}
          </span>
        </div>
        {!installed && (
          <Button theme="primary" onClick={probe} disabled={checking}>
            <SyncIcon size={14} />
            <span>{t("setup_bios_check_again")}</span>
          </Button>
        )}
      </div>
    </>
  );
}
