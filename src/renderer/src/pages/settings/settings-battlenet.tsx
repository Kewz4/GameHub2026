import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useCachedDetection, useToast } from "@renderer/hooks";
import {
  AlertIcon,
  CheckCircleFillIcon,
  DownloadIcon,
  PlusIcon,
} from "@primer/octicons-react";

interface BattleNetGameDef {
  productCode: string;
  title: string;
  iconUrl: string;
  launchUri: string;
}

interface BattleNetDetection {
  installed: boolean;
  detected: BattleNetGameDef[];
  all: BattleNetGameDef[];
}

export function SettingsBattleNet() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();

  const { data, refresh } = useCachedDetection<BattleNetDetection>(
    "battlenet-games",
    () => window.electron.getBattleNetGames()
  );

  const bnetInstalled = data?.installed ?? null;
  const allGames = data?.all ?? [];
  const detected = data?.detected ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [isInstallingBnet, setIsInstallingBnet] = useState(false);
  const [bnetInstallProgress, setBnetInstallProgress] = useState(0);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (data) {
      setSelected((prev) =>
        prev.size > 0
          ? prev
          : new Set(data.detected.map((g) => g.productCode))
      );
    }
  }, [data]);

  useEffect(() => {
    const unsub = window.electron.onBattleNetInstallProgress(
      setBnetInstallProgress
    );
    unsubRef.current = unsub;
    return () => unsub();
  }, []);

  const handleInstallBattleNet = async () => {
    setIsInstallingBnet(true);
    setBnetInstallProgress(0);
    try {
      await window.electron.installBattleNet();
      showSuccessToast(t("battlenet_installer_launched"));
      // Re-check after a short delay to pick up the install
      setTimeout(refresh, 5000);
    } catch (err: any) {
      showErrorToast(err?.message ?? t("battlenet_install_failed"));
    } finally {
      setIsInstallingBnet(false);
      setBnetInstallProgress(0);
    }
  };

  const toggleGame = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const handleAddToLibrary = async () => {
    if (selected.size === 0) return;
    setIsAdding(true);
    try {
      const result = await window.electron.addBattleNetGamesToLibrary(
        Array.from(selected)
      );
      showSuccessToast(t("battlenet_games_added", { count: result.added }));
    } catch {
      showErrorToast(t("battlenet_add_failed"));
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="settings-account">
      <p className="settings-account__description">
        {t("battlenet_description")}
      </p>

      {bnetInstalled === false && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="settings-account__warning">
            <AlertIcon size={16} />
            <span>{t("battlenet_not_installed")}</span>
          </div>
          <Button
            type="button"
            onClick={handleInstallBattleNet}
            disabled={isInstallingBnet}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              width: "fit-content",
            }}
          >
            <DownloadIcon size={14} />
            {isInstallingBnet
              ? bnetInstallProgress > 0
                ? t("downloading_pct", { pct: bnetInstallProgress })
                : t("downloading")
              : t("install_battlenet")}
          </Button>
        </div>
      )}

      {bnetInstalled && (
        <>
          <p className="settings-account__hint">
            {t("battlenet_select_games")}
          </p>

          <div className="settings-account__game-grid">
            {allGames.map((game) => {
              const isDetected = detected.some(
                (d) => d.productCode === game.productCode
              );
              const isChecked = selected.has(game.productCode);

              return (
                <button
                  key={game.productCode}
                  type="button"
                  onClick={() => toggleGame(game.productCode)}
                  className={`settings-account__game-tile${isChecked ? " settings-account__game-tile--selected" : ""}`}
                >
                  <img
                    src={game.iconUrl}
                    alt={game.title}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 4,
                      objectFit: "contain",
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="settings-account__game-title">
                      {game.title}
                    </div>
                    {isDetected && (
                      <div className="settings-account__game-status">
                        <CheckCircleFillIcon size={10} />
                        {t("installed")}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            <Button
              type="button"
              onClick={handleAddToLibrary}
              disabled={selected.size === 0 || isAdding}
              style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
              <PlusIcon size={14} />
              {t("battlenet_add_selected", { count: selected.size })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
