import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SyncIcon, SearchIcon, FileDirectoryIcon, XIcon } from "@primer/octicons-react";

import { Button, Modal } from "@renderer/components";

import "./scan-games-modal.scss";

interface FoundGame {
  title: string;
  executablePath: string;
}

interface ScanResult {
  foundGames: FoundGame[];
  total: number;
}

interface ScanProgress {
  scanned: number;
  total: number;
  foundCount: number;
  currentTitle: string;
}

export interface ScanGamesModalProps {
  visible: boolean;
  onClose: () => void;
  isScanning: boolean;
  scanProgress?: ScanProgress | null;
  scanResult: ScanResult | null;
  onStartScan: (mode: "deep" | "selective", paths?: string[]) => void;
  onClearResult: () => void;
}

export function ScanGamesModal({
  visible,
  onClose,
  isScanning,
  scanProgress,
  scanResult,
  onStartScan,
  onClearResult,
}: Readonly<ScanGamesModalProps>) {
  const { t } = useTranslation("header");
  const [scanMode, setScanMode] = useState<"deep" | "selective">("deep");
  const [folderPaths, setFolderPaths] = useState<string[]>([]);

  const handleClose = () => {
    onClose();
  };

  const handleStartScan = () => {
    onStartScan(scanMode, scanMode === "selective" ? folderPaths : undefined);
  };

  const handleScanAgain = () => {
    onClearResult();
  };

  const handleAddFolder = async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      setFolderPaths((prev) => {
        const next = [...prev];
        for (const p of result.filePaths) {
          if (!next.includes(p)) next.push(p);
        }
        return next;
      });
    }
  };

  const handleRemoveFolder = (p: string) => {
    setFolderPaths((prev) => prev.filter((f) => f !== p));
  };

  return (
    <Modal
      visible={visible}
      title={t("scan_games_title")}
      onClose={handleClose}
      clickOutsideToClose={!isScanning}
    >
      <div className="scan-games-modal">
        {!scanResult && !isScanning && (
          <>
            <div className="scan-mode-cards">
              <button
                type="button"
                className={`scan-mode-card${scanMode === "deep" ? " scan-mode-card--selected" : ""}`}
                onClick={() => setScanMode("deep")}
              >
                <span className="scan-mode-card__icon">
                  <SearchIcon size={24} />
                </span>
                <span className="scan-mode-card__label">Deep Scan</span>
                <span className="scan-mode-card__desc">
                  Scans all default directories automatically
                </span>
              </button>
              <button
                type="button"
                className={`scan-mode-card${scanMode === "selective" ? " scan-mode-card--selected" : ""}`}
                onClick={() => setScanMode("selective")}
              >
                <span className="scan-mode-card__icon">
                  <FileDirectoryIcon size={24} />
                </span>
                <span className="scan-mode-card__label">Selective Scan</span>
                <span className="scan-mode-card__desc">
                  Choose specific folders to scan
                </span>
              </button>
            </div>

            {scanMode === "selective" && (
              <>
                <div className="scan-folder-list">
                  {folderPaths.map((p) => (
                    <div key={p} className="scan-folder-item">
                      <span className="scan-folder-item__path">{p}</span>
                      <button
                        type="button"
                        className="scan-folder-item__remove"
                        onClick={() => handleRemoveFolder(p)}
                        title="Remove folder"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="scan-add-folder-btn"
                  onClick={handleAddFolder}
                >
                  + Add Folder
                </button>
              </>
            )}

            {scanMode === "deep" && (
              <p className="scan-games-modal__description">
                {t("scan_games_description")}
              </p>
            )}
          </>
        )}

        {isScanning && !scanResult && (
          <div className="scan-games-modal__scanning">
            <SyncIcon size={24} className="scan-games-modal__spinner" />
            <p className="scan-games-modal__scanning-text">
              {t("scan_games_in_progress")}
            </p>
            {scanProgress && scanProgress.total > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    height: "4px",
                    background: "rgba(255,255,255,0.12)",
                    borderRadius: "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.round((scanProgress.scanned / scanProgress.total) * 100)}%`,
                      background: "var(--color-primary, #8c67ef)",
                      borderRadius: "2px",
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    opacity: 0.6,
                    textAlign: "center",
                  }}
                >
                  {scanProgress.scanned}/{scanProgress.total} —{" "}
                  {scanProgress.currentTitle} ({scanProgress.foundCount} found)
                </span>
              </div>
            )}
          </div>
        )}

        {scanResult && (
          <div className="scan-games-modal__results">
            {scanResult.foundGames.length > 0 ? (
              <>
                <p className="scan-games-modal__result">
                  {t("scan_games_result", {
                    found: scanResult.foundGames.length,
                    total: scanResult.total,
                  })}
                </p>

                <ul className="scan-games-modal__games-list">
                  {scanResult.foundGames.map((game) => (
                    <li
                      key={game.executablePath}
                      className="scan-games-modal__game-item"
                    >
                      <span className="scan-games-modal__game-title">
                        {game.title}
                      </span>
                      <span className="scan-games-modal__game-path">
                        {game.executablePath}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="scan-games-modal__no-results">
                {t("scan_games_no_results")}
              </p>
            )}
          </div>
        )}

        <div className="scan-games-modal__actions">
          <Button theme="outline" onClick={handleClose}>
            {scanResult ? t("scan_games_close") : t("scan_games_cancel")}
          </Button>
          {!scanResult && (
            <Button
              onClick={handleStartScan}
              disabled={
                isScanning ||
                (scanMode === "selective" && folderPaths.length === 0)
              }
            >
              {t("scan_games_start")}
            </Button>
          )}
          {scanResult && (
            <Button onClick={handleScanAgain}>
              {t("scan_games_scan_again")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
