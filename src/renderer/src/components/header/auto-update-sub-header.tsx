import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { ChevronRightIcon, DownloadIcon } from "@primer/octicons-react";
import { Link } from "../link/link";
import "./auto-update-header.scss";
import type { AppUpdaterEvent } from "@types";

export const releasesPageUrl =
  "https://github.com/Kewz4/GameHub2026/releases/latest";

export function AutoUpdateSubHeader() {
  const [isReadyToInstall, setIsReadyToInstall] = useState(false);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [isAutoInstallAvailable, setIsAutoInstallAvailable] = useState(false);

  const { t } = useTranslation("header");

  const handleClickInstallUpdate = () => {
    window.electron.restartAndInstallUpdate();
  };

  useEffect(() => {
    const unsubscribe = window.electron.onAutoUpdaterEvent(
      (event: AppUpdaterEvent) => {
        if (event.type == "update-available") {
          setNewVersion(event.info.version);
        }

        if (event.type == "update-downloaded") {
          setIsReadyToInstall(true);
        }
      }
    );

    window.electron.checkForUpdates().then((isAutoInstallAvailable) => {
      setIsAutoInstallAvailable(isAutoInstallAvailable);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!newVersion) return null;

  const content = (description: string) => (
    <>
      <DownloadIcon
        className="auto-update-sub-header__new-version-icon"
        size={18}
      />
      <span className="auto-update-sub-header__copy">
        <strong>
          {t("update_available_title", {
            version: newVersion,
            defaultValue: "GameHub {{version}} is available",
          })}
        </strong>
        <span>{description}</span>
      </span>
      <ChevronRightIcon className="auto-update-sub-header__chevron" size={16} />
    </>
  );

  if (!isAutoInstallAvailable) {
    return (
      <header className="auto-update-sub-header">
        <Link
          to={releasesPageUrl}
          className="auto-update-sub-header__new-version-link"
        >
          {content(
            t("view_release", {
              defaultValue: "View the release and download the update",
            })
          )}
        </Link>
      </header>
    );
  }

  if (isReadyToInstall) {
    return (
      <header className="auto-update-sub-header">
        <button
          type="button"
          className="auto-update-sub-header__new-version-button"
          onClick={handleClickInstallUpdate}
        >
          {content(
            t("restart_to_install", {
              defaultValue: "Restart to install the update",
            })
          )}
        </button>
      </header>
    );
  }

  return null;
}
