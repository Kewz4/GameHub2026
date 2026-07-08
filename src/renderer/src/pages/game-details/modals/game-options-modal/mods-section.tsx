import { useCallback, useEffect, useState } from "react";
import { DownloadIcon, InfoIcon, PackageIcon } from "@primer/octicons-react";
import type { LibraryGame, ModManagerStatus } from "@types";
import { useToast } from "@renderer/hooks";
import { SettingToggle } from "@renderer/pages/settings/emulation/setting-toggle";
import { ModManagerModal } from "./mod-manager-modal";
import "./mods-section.scss";

interface Props {
  game: LibraryGame;
}

/**
 * Mods tab for a Wii U (Breath of the Wild) game. Powered by UKMM in the
 * background: a master enable switch, and a mod manager (browse GameBanana /
 * manage installed) launched into a modal.
 */
export function ModsSection({ game }: Readonly<Props>) {
  const { showErrorToast, showSuccessToast } = useToast();
  const [status, setStatus] = useState<ModManagerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const s = await window.electron.getModStatus(game.shop, game.objectId);
      setStatus(s);
    } catch {
      showErrorToast("Couldn't load mod status");
    }
  }, [game.shop, game.objectId, showErrorToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInstallUkmm = async () => {
    setBusy(true);
    try {
      const res = await window.electron.installUkmm();
      if (res.ok) {
        showSuccessToast("Mod support installed");
        await refresh();
      } else {
        showErrorToast(res.reason ?? "Couldn't install mod support");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    setStatus((s) => (s ? { ...s, modsEnabled: enabled } : s));
    const res = await window.electron.setModsEnabled(
      game.shop,
      game.objectId,
      enabled
    );
    if (!res.ok) {
      showErrorToast("Couldn't change mods state");
      refresh();
    }
  };

  if (!status) {
    return <p className="mods-section__muted">Loading…</p>;
  }

  if (!status.cemuInstalled) {
    return (
      <p className="mods-section__muted">
        <InfoIcon size={14} /> Set up Cemu for this game first — mods are
        deployed through Cemu.
      </p>
    );
  }

  return (
    <div className="mods-section">
      <div className="mods-section__header">
        <div>
          <h3 className="mods-section__title">Mods</h3>
          <p className="mods-section__subtitle">
            Install and manage {game.title} mods from GameBanana. Enable mods and
            press Play to launch the game modded — everything runs in the
            background through Cemu.
          </p>
        </div>
      </div>

      {!status.ukmmInstalled ? (
        <div className="mods-section__setup">
          <p className="mods-section__muted">
            <InfoIcon size={14} /> Mod support (UKMM) isn&apos;t installed yet.
          </p>
          <button
            type="button"
            className="mods-section__button mods-section__button--primary"
            disabled={busy}
            onClick={handleInstallUkmm}
          >
            <DownloadIcon size={14} />
            <span>{busy ? "Installing…" : "Install mod support"}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="mods-section__row">
            <div>
              <span className="mods-section__row-label">Enable mods</span>
              <span className="mods-section__row-hint">
                Applies your installed mods to Cemu on the next launch.
              </span>
            </div>
            <SettingToggle
              checked={status.modsEnabled}
              onChange={handleToggle}
              ariaLabel="Enable mods"
            />
          </div>

          <div className="mods-section__row">
            <div>
              <span className="mods-section__row-label">Mod manager</span>
              <span className="mods-section__row-hint">
                {status.installed.length} mod
                {status.installed.length === 1 ? "" : "s"} installed.
              </span>
            </div>
            <button
              type="button"
              className="mods-section__button"
              onClick={() => setManagerOpen(true)}
            >
              <PackageIcon size={14} />
              <span>Open mod manager</span>
            </button>
          </div>
        </>
      )}

      {managerOpen && (
        <ModManagerModal
          game={game}
          onClose={() => {
            setManagerOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
