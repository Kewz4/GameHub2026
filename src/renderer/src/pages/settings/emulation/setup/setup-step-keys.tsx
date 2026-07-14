import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";

interface Props {
  onSkip: () => void;
  onComplete: () => void;
}

export function SetupStepKeys({ onSkip, onComplete }: Readonly<Props>) {
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
      if (res.keys && res.firmware) {
        showSuccessToast(
          "prod.keys and firmware installed successfully. Eden is ready to play Switch games!"
        );
        onComplete();
      } else if (res.keys || res.firmware) {
        showSuccessToast(
          `Partial success: ${res.keys ? "keys" : "firmware"} installed. ${
            res.keys ? "Firmware" : "Keys"
          } failed — you can retry or install manually.`
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
        <h3>{t("setup_step_keys_title", { defaultValue: "Switch Keys & Firmware" })}</h3>
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
              <strong>prod.keys:</strong>{" "}
              {result.keys ? "Installed" : "Failed"}
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
        <Button theme="outline" onClick={onSkip}>
          {t("skip", { defaultValue: "Skip for now" })}
        </Button>
      </div>
    </div>
  );
}
