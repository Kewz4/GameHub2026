import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";

interface Props {
  onSkip: () => void;
  onComplete: () => void;
  /** Report whether keys are installed, so the wizard can enable Continue. */
  onKeysStatusChange?: (installed: boolean) => void;
}

export function SetupStepKeys({
  onSkip,
  onComplete,
  onKeysStatusChange,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast, showSuccessToast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{
    keys: boolean;
    firmware: boolean;
    error?: string;
  } | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await window.electron.downloadSwitchKeys();
      setResult(res);
      // Keys are the hard requirement; firmware is strongly recommended but a
      // few games boot without full firmware. Enable Continue once keys land.
      onKeysStatusChange?.(res.keys);
      if (res.keys && res.firmware) {
        showSuccessToast(
          "prod.keys and firmware installed successfully. Eden is ready to play Switch games!"
        );
        onComplete();
      } else if (res.keys) {
        showSuccessToast(
          "prod.keys installed. Firmware failed — you can retry, but you can continue now."
        );
      } else if (res.firmware) {
        showErrorToast(
          "Firmware installed but prod.keys failed. Retry — keys are required."
        );
      } else if (res.error) {
        showErrorToast(res.error);
      }
    } catch (err) {
      showErrorToast((err as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="setup-step">
      <div className="setup-step__header">
        <h3>
          {t("setup_step_keys_title", {
            defaultValue: "Switch Keys & Firmware",
          })}
        </h3>
        <p>
          {t("setup_step_keys_desc", {
            defaultValue:
              "Eden needs prod.keys and system firmware to boot Switch games. Click below to download and install them automatically.",
          })}
        </p>
      </div>

      <div className="setup-step__body">
        {result && (
          <div className="setup-step__status">
            <p>
              <strong>prod.keys:</strong> {result.keys ? "Installed" : "Failed"}
            </p>
            <p>
              <strong>Firmware:</strong>{" "}
              {result.firmware ? "Installed" : "Failed"}
            </p>
          </div>
        )}
      </div>

      <div className="setup-step__actions">
        <Button onClick={handleDownload} disabled={downloading}>
          {downloading
            ? t("downloading", { defaultValue: "Downloading…" })
            : t("setup_keys_download", {
                defaultValue: "Download Keys & Firmware",
              })}
        </Button>
        <Button theme="outline" onClick={onSkip} disabled={downloading}>
          {t("skip", { defaultValue: "Skip for now" })}
        </Button>
      </div>
    </div>
  );
}
