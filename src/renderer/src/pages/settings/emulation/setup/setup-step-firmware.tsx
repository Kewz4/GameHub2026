import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  CheckCircleFillIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig } from "@types";

import { firmwarePageUrl } from "./ps-firmware-url";

interface Props {
  config: EmulatorConfig;
  systemLabel: string;
  onFirmwareStatusChange: (installed: boolean) => void;
  onSkip: () => void;
}

export function SetupStepFirmware({
  config,
  systemLabel,
  onFirmwareStatusChange,
  onSkip,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation("settings");
  const { showErrorToast } = useToast();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);

  const probe = async () => {
    setChecking(true);
    try {
      const result = await window.electron.checkPs3Firmware(
        config.executablePath
      );
      setInstalled(result.installed);
      onFirmwareStatusChange(result.installed);
    } finally {
      setChecking(false);
    }
  };

  // In-wizard automatic firmware install (RPCS3 --installfw), awaited with
  // progress, then re-probe so Continue enables on success.
  const autoDownload = async () => {
    if (!config.executablePath) {
      showErrorToast(t("bios_download_needs_emulator"));
      return;
    }
    setDownloading(true);
    setDownloadStatus(t("bios_download_starting"));
    const unsubscribe = window.electron.onBiosDownloadProgress((payload) => {
      if (payload.system !== config.system) return;
      const pct =
        payload.progress >= 0 ? ` ${Math.round(payload.progress * 100)}%` : "";
      setDownloadStatus(t(`bios_download_stage_${payload.stage}`) + pct);
    });
    try {
      const result = await window.electron.downloadEmulatorBios(config.system);
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

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_step_firmware", { system: systemLabel })}
      </h3>
      <div>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_firmware_intro_1", { name: systemLabel })}
        </p>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_firmware_intro_2")}
        </p>
      </div>

      <div className="setup-modal__numbered-list">
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">1</span>
          <span className="setup-modal__numbered-text">
            {t("setup_firmware_step_1")}
          </span>
        </div>
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">2</span>
          <span className="setup-modal__numbered-text">
            {t("setup_firmware_step_2")}
          </span>
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
              : t("setup_firmware_auto_download", {
                  defaultValue: "Download & install firmware automatically",
                })}
          </Button>
        </div>
      )}

      <div className="setup-modal__hint">
        <button
          type="button"
          className="setup-modal__link-button"
          onClick={() =>
            window.electron.openExternal(firmwarePageUrl(i18n.language))
          }
        >
          {t("setup_firmware_guide")}
        </button>
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
            {installed
              ? t("setup_firmware_found")
              : t("setup_firmware_not_yet")}
          </span>
          <span className="setup-modal__alert-note">
            {installed
              ? t("setup_firmware_found_note")
              : t("setup_firmware_recheck_note")}
          </span>
        </div>
        {!installed && (
          <Button theme="primary" onClick={probe} disabled={checking}>
            <SyncIcon size={14} />
            <span>{t("setup_firmware_check_again")}</span>
          </Button>
        )}
      </div>
    </>
  );
}
